// Validação de saque do Asaas (Integrações → Mecanismos de segurança): o Asaas pergunta aqui antes
// de cada transferência feita pela API. Só aprova os repasses que a própria loja criou.
import { admin, env, json } from './_lib.js'

export async function POST(request: Request) {
  const token = env('ASAAS_WEBHOOK_TOKEN')
  if (!token || request.headers.get('asaas-access-token') !== token) return json(401, { error: 'token' })
  let body: { type?: string; transfer?: { id?: string; value?: number; bankAccount?: { pixAddressKey?: string | null } } }
  try { body = await request.json() } catch { return json(200, { status: 'REFUSED', refuseReason: 'Pedido inválido' }) }
  if (body.type !== 'TRANSFER' || !body.transfer?.id) return json(200, { status: 'REFUSED', refuseReason: 'Operação não reconhecida pelo Krata' })
  const t = body.transfer
  let r = await admin(`store_payouts?provider_id=eq.${encodeURIComponent(t.id!)}&select=id,cents,status`)
  let rows = (await r.json().catch(() => [])) as { id: string; cents: number; status: string }[]
  if (!rows.length && typeof t.value === 'number') {
    // a validação pode chegar antes de o Krata anotar o código: confere pelo valor de um repasse "enviando"
    r = await admin(`store_payouts?status=eq.sending&cents=eq.${Math.round(t.value * 100)}&select=id,cents,status`)
    rows = (await r.json().catch(() => [])) as { id: string; cents: number; status: string }[]
  }
  const ok = rows.some((p) => typeof t.value !== 'number' || p.cents === Math.round(t.value * 100))
  return json(200, ok ? { status: 'APPROVED' } : { status: 'REFUSED', refuseReason: 'Transferência não criada pela loja do Krata' })
}
