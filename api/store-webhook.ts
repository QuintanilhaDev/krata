// Avisos automáticos do Asaas (configure em Integrações → Webhooks, com o mesmo token de ASAAS_WEBHOOK_TOKEN):
// pagamento confirmado → entrega o bundle e repassa 97% ao artista e 3% ao Krata;
// transferência concluída/falhou → atualiza o repasse.
import { admin, env, json } from './_lib.js'
import { asaasConfigured, rpc, settle } from './_asaas.js'

interface Hook {
  event?: string
  payment?: { id?: string; externalReference?: string; status?: string }
  transfer?: { id?: string; externalReference?: string; status?: string; failReason?: string }
}

export async function POST(request: Request) {
  const token = env('ASAAS_WEBHOOK_TOKEN')
  if (!token || request.headers.get('asaas-access-token') !== token) return json(401, { error: 'token' })
  let body: Hook
  try { body = await request.json() } catch { return json(400, { error: 'json' }) }
  const ev = String(body.event || '')
  try {
    if ((ev === 'PAYMENT_RECEIVED' || ev === 'PAYMENT_CONFIRMED') && body.payment?.id && asaasConfigured()) {
      const ref = String(body.payment.externalReference || '')
      const r = await admin(`store_orders?provider_id=eq.${encodeURIComponent(body.payment.id)}&select=id,price_cents,status`)
      const o = ((await r.json().catch(() => [])) as { id: string; price_cents: number; status: string }[])[0]
      if (o && (!ref || ref === o.id)) await settle(o.id, body.payment.id, o.price_cents) // confere no Asaas antes de entregar
    } else if ((ev === 'PAYMENT_OVERDUE' || ev === 'PAYMENT_DELETED') && body.payment?.id) {
      await admin(`store_orders?provider_id=eq.${encodeURIComponent(body.payment.id)}&status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ status: 'expired' }) })
    } else if ((ev === 'PAYMENT_REFUNDED' || ev === 'PAYMENT_CHARGEBACK_REQUESTED') && body.payment?.id) {
      await admin(`store_orders?provider_id=eq.${encodeURIComponent(body.payment.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'refunded' }) })
    } else if (ev.startsWith('TRANSFER_') && body.transfer?.id) {
      const t = body.transfer
      const status = ev === 'TRANSFER_DONE' ? 'done' : ev === 'TRANSFER_FAILED' || ev === 'TRANSFER_CANCELLED' ? 'failed' : null
      if (status) {
        const r = await admin(`store_payouts?provider_id=eq.${encodeURIComponent(t.id!)}&select=id`)
        const p = ((await r.json().catch(() => [])) as { id: string }[])[0]
        if (p) await rpc('store_payout_set', { p_id: p.id, p_status: status, p_provider_id: t.id, p_error: status === 'failed' ? String(t.failReason || 'A transferência falhou no Asaas.') : '' })
      }
    }
  } catch (e) {
    // responde 200 mesmo assim: o Asaas pausa a fila de avisos depois de muitos erros; o comprador confere de novo sozinho
    return json(200, { ok: false, error: (e as Error).message })
  }
  return json(200, { ok: true })
}
