// Conversa com o Asaas (cobrança PIX e repasses) e com o banco. Arquivo com "_" não vira rota.
// Variáveis na Vercel: ASAAS_API_KEY, ASAAS_ENV (sandbox | production), ASAAS_WEBHOOK_TOKEN.
import { admin, env } from './_lib.js'

export const asaasConfigured = () => !!env('ASAAS_API_KEY')
const BASE = () => (env('ASAAS_ENV') === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3')

export async function asaas<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${env('ASAAS_BASE_URL') || BASE()}${path}`, {
    ...init,
    headers: { access_token: env('ASAAS_API_KEY'), 'content-type': 'application/json', 'user-agent': 'Krata/1.6 (Vercel)', ...(init.headers || {}) },
  })
  const text = await r.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 300) } }
  if (!r.ok) {
    const errs = (body as { errors?: { description?: string }[] } | null)?.errors
    throw new Error(errs?.map((e) => e.description).filter(Boolean).join(' ') || `Asaas respondeu ${r.status}`)
  }
  return body as T
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await admin(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
  const text = await r.text()
  if (!r.ok) {
    let msg = text
    try { msg = (JSON.parse(text) as { message?: string }).message || text } catch { /* texto puro */ }
    throw new Error(msg.slice(0, 300))
  }
  return (text ? JSON.parse(text) : null) as T
}

const PIX_TYPE: Record<string, string> = { cpf: 'CPF', cnpj: 'CNPJ', email: 'EMAIL', phone: 'PHONE', evp: 'EVP' }
interface Payout { id: string; kind: string; pix_key: string; pix_type: string; cents: number; order_id: string }

/** Envia os repasses que acabaram de nascer (97% artista, 3% Krata). Cada um sai uma vez só. */
export async function sendPayouts(payouts: Payout[]) {
  for (const p of payouts) {
    const mine = await rpc<boolean>('store_payout_claim', { p_id: p.id }).catch(() => false)
    if (!mine) continue
    try {
      const t = await asaas<{ id: string; status?: string }>('/transfers', {
        method: 'POST',
        body: JSON.stringify({
          value: p.cents / 100, operationType: 'PIX', pixAddressKey: p.pix_key, pixAddressKeyType: PIX_TYPE[p.pix_type] || 'EVP',
          description: p.kind === 'artist' ? 'Krata: venda de bundle na loja' : 'Krata: taxa da loja (3%)', externalReference: p.id,
        }),
      })
      await rpc('store_payout_set', { p_id: p.id, p_status: t.status === 'DONE' ? 'done' : 'sent', p_provider_id: t.id, p_error: '' })
    } catch (e) {
      await rpc('store_payout_set', { p_id: p.id, p_status: 'failed', p_provider_id: null, p_error: (e as Error).message }).catch(() => {})
    }
  }
}

/** Confere no Asaas se a cobrança foi paga; se foi, entrega o bundle e faz os repasses. */
export async function settle(orderId: string, providerId: string, priceCents: number): Promise<boolean> {
  const pay = await asaas<{ status?: string; value?: number; externalReference?: string }>(`/payments/${encodeURIComponent(providerId)}`)
  const paid = pay.status === 'RECEIVED' || pay.status === 'CONFIRMED' || pay.status === 'RECEIVED_IN_CASH'
  if (!paid) return false
  if (pay.externalReference && pay.externalReference !== orderId) return false
  if (typeof pay.value === 'number' && Math.round(pay.value * 100) < priceCents) return false // pagou menos: não entrega
  const out = await rpc<{ payouts: Payout[] } | null>('store_mark_paid', { p_order: orderId, p_manual: false })
  if (out?.payouts?.length) await sendPayouts(out.payouts)
  return true
}

export const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10) // dia em Brasília
