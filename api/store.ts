// Loja do Krata.
// POST /api/store { bundleId, cpf? }   → abre o pedido e devolve o PIX (copia e cola + QR Code)
// GET  /api/store?order=ID             → situação do pedido (confere no Asaas se já foi pago)
// GET  /api/store                      → se os pagamentos reais estão ligados
import { SERVICE_KEY, admin, asUser, authUser, json } from './_lib.js'
import { asaas, asaasConfigured, rpc, sendPayouts, settle, today } from './_asaas.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false
  const d = cpf.split('').map(Number)
  const dig = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r }
  return dig(9) === d[9] && dig(10) === d[10]
}

interface Order { id: string; status: string; price_cents: number; provider_id: string | null; pix_payload: string | null; pix_image: string | null; expires_at: string; buyer_id: string; bundle_id: string; reused?: boolean; bundle_name?: string }
const publicOrder = (o: Order, test = false) => ({
  id: o.id, status: o.status, price_cents: o.price_cents, pix_payload: o.pix_payload, pix_image: o.pix_image, expires_at: o.expires_at, bundle_id: o.bundle_id, test,
})

export async function GET(request: Request) {
  const user = await authUser(request)
  if (!user) return json(401, { error: 'login' })
  const id = new URL(request.url).searchParams.get('order') || ''
  if (!id) return json(200, { payments: asaasConfigured() && !!SERVICE_KEY() })
  if (!UUID.test(id)) return json(400, { error: 'order' })
  const r = await admin(`store_orders?id=eq.${id}&select=*`)
  const o = ((await r.json().catch(() => [])) as Order[])[0]
  if (!o || o.buyer_id !== user.id) return json(404, { error: 'order' })
  if (o.status === 'pending' && o.provider_id && asaasConfigured()) {
    try { if (await settle(o.id, o.provider_id, o.price_cents)) o.status = 'paid' } catch { /* tenta de novo na próxima consulta */ }
  }
  return json(200, { order: publicOrder(o, !o.provider_id) })
}

export async function POST(request: Request) {
  const user = await authUser(request)
  if (!user) return json(401, { error: 'login' })
  if (!SERVICE_KEY()) return json(503, { error: 'not_configured', message: 'A loja ainda não foi configurada no servidor (falta a chave de serviço do Supabase).' })
  let body: { bundleId?: string; cpf?: string; action?: string }
  try { body = await request.json() } catch { return json(400, { error: 'json' }) }
  // desenvolvedor: reenviar repasses que estavam com erro
  if (body.action === 'payouts') {
    const dev = await asUser(user.token, 'rpc/is_dev', { method: 'POST', body: '{}' }).then((r) => r.json()).catch(() => false)
    if (dev !== true) return json(403, { error: 'dev' })
    if (!asaasConfigured()) return json(200, { sent: 0, message: 'Pagamentos reais ainda não ligados.' })
    const r = await admin('store_payouts?status=eq.pending&select=*&limit=50')
    const list = (await r.json().catch(() => [])) as Parameters<typeof sendPayouts>[0]
    await sendPayouts(list)
    return json(200, { sent: list.length })
  }
  const bundleId = String(body.bundleId || '')
  if (!UUID.test(bundleId)) return json(400, { error: 'bundle' })

  // sem Asaas ainda: pedido de teste (o desenvolvedor confirma no painel)
  if (!asaasConfigured()) {
    try {
      const o = await rpc<Order>('store_begin', { p_buyer: user.id, p_bundle: bundleId })
      return json(200, { order: publicOrder(o, true) })
    } catch (e) { return json(400, { error: 'begin', message: (e as Error).message }) }
  }

  // cliente no Asaas (o CPF é pedido só na primeira compra e não fica guardado no Krata)
  let customer = ''
  const c = await admin(`store_customers?user_id=eq.${user.id}&select=provider_id`)
  customer = ((await c.json().catch(() => [])) as { provider_id: string }[])[0]?.provider_id || ''
  if (!customer) {
    const cpf = String(body.cpf || '').replace(/\D/g, '')
    if (!cpf) return json(400, { error: 'cpf_required' })
    if (!validCpf(cpf) && !/^\d{14}$/.test(cpf)) return json(400, { error: 'cpf_invalid', message: 'CPF inválido.' })
    try {
      const p = await admin(`profiles?id=eq.${user.id}&select=display_name`)
      const name = ((await p.json().catch(() => [])) as { display_name: string }[])[0]?.display_name || 'Cliente Krata'
      const made = await asaas<{ id: string }>('/customers', { method: 'POST', body: JSON.stringify({ name, cpfCnpj: cpf, externalReference: user.id, notificationDisabled: true }) })
      customer = made.id
      await admin('store_customers', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: user.id, provider_id: customer }) })
    } catch (e) { return json(400, { error: 'customer', message: (e as Error).message }) }
  }

  let o: Order
  try { o = await rpc<Order>('store_begin', { p_buyer: user.id, p_bundle: bundleId }) } catch (e) { return json(400, { error: 'begin', message: (e as Error).message }) }
  if (o.reused && o.pix_payload) return json(200, { order: publicOrder(o) })

  try {
    const pay = await asaas<{ id: string }>('/payments', {
      method: 'POST',
      body: JSON.stringify({ customer, billingType: 'PIX', value: o.price_cents / 100, dueDate: today(), description: `Krata · ${o.bundle_name || 'bundle'}`, externalReference: o.id }),
    })
    const qr = await asaas<{ encodedImage: string; payload: string; expirationDate?: string }>(`/payments/${pay.id}/pixQrCode`)
    const expires = new Date(Date.now() + 60 * 60_000).toISOString()
    await rpc('store_attach', { p_order: o.id, p_provider_id: pay.id, p_payload: qr.payload, p_image: qr.encodedImage, p_expires: expires })
    return json(200, { order: publicOrder({ ...o, provider_id: pay.id, pix_payload: qr.payload, pix_image: qr.encodedImage, expires_at: expires }) })
  } catch (e) {
    await admin(`store_orders?id=eq.${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'canceled' }) }).catch(() => {})
    return json(502, { error: 'charge', message: `Não foi possível gerar o PIX: ${(e as Error).message}` })
  }
}
