// Loja do Krata: compra por PIX, inventário, painel do artista e do desenvolvedor.
import type { Bundle } from './types'
import { errorText, supabase } from './supabase'
import { get, set, toast } from '../store/app'
import { uploadFile } from './upload'

// tamanhos das artes (o painel do artista confere antes de enviar)
export const AVATAR_FRAME = { w: 512, h: 512, hole: 340 } // a foto ocupa o círculo central de 340 px
export const CARD_FRAME = { w: 760, h: 1000, edge: 72 } // a borda decorada fica nos 72 px de fora (o miolo é ignorado)
export const MIN_CENTS = 500
export const MAX_CENTS = 100000
export const FEE_PERCENT = 3

export const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
/** "12,90" / "12.9" / "R$ 12" → centavos */
export function parseBrl(text: string): number | null {
  const t = text.replace(/[^\d,.]/g, '')
  if (!t) return null
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const v = Number(norm)
  return Number.isFinite(v) ? Math.round(v * 100) : null
}

async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token || '' }

export interface Order { id: string; status: 'pending' | 'paid' | 'expired' | 'canceled' | 'refunded'; price_cents: number; pix_payload: string | null; pix_image: string | null; expires_at: string; bundle_id: string; test: boolean }

export async function paymentsLive(): Promise<boolean> {
  try { const r = await fetch('/api/store', { headers: { authorization: `Bearer ${await token()}` } }); return !!((await r.json()) as { payments?: boolean }).payments } catch { return false }
}

export type BuyResult = { order: Order } | { error: 'cpf_required' | 'cpf_invalid' | string; message?: string }
export async function startPurchase(bundleId: string, cpf?: string): Promise<BuyResult> {
  try {
    const r = await fetch('/api/store', { method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify({ bundleId, cpf }) })
    const d = (await r.json().catch(() => ({}))) as { order?: Order; error?: string; message?: string }
    if (d.order) return { order: d.order }
    return { error: d.error || 'erro', message: d.message || (r.status === 404 ? 'A loja ainda não está disponível neste servidor.' : 'Não foi possível abrir a compra.') }
  } catch { return { error: 'rede', message: 'Sem conexão. Tente de novo.' } }
}

export async function checkOrder(id: string): Promise<Order | null> {
  try {
    const r = await fetch(`/api/store?order=${id}`, { headers: { authorization: `Bearer ${await token()}` } })
    return ((await r.json()) as { order?: Order }).order || null
  } catch { return null }
}

// ---------------------------------------------------------------- inventário
export async function loadInventory(): Promise<string[]> {
  const { data } = await supabase.from('inventory').select('bundle_id').eq('user_id', get().userId!)
  return ((data as { bundle_id: string }[]) || []).map((x) => x.bundle_id)
}
export async function equip(bundleId: string | null): Promise<boolean> {
  const { error } = await supabase.rpc('equip_bundle', { p_bundle: bundleId })
  if (error) { toast(errorText(error), 'error'); return false }
  set((s) => (s.me ? { me: { ...s.me, equipped_bundle: bundleId }, profiles: { ...s.profiles, [s.me.id]: { ...s.me, equipped_bundle: bundleId } } } : s))
  return true
}

// ---------------------------------------------------------------- artista
export type PixType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'evp'
export function validCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false
  const d = cpf.split('').map(Number)
  const dig = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r }
  return dig(9) === d[9] && dig(10) === d[10]
}
function validCnpj(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false
  const calc = (n: number) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = w.reduce((a, x, i) => a + x * Number(c[i]), 0); const r = s % 11; return r < 2 ? 0 : 11 - r }
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13])
}
/** Reconhece o tipo da chave PIX enquanto a pessoa digita e devolve a forma certa para guardar. */
export function detectPix(raw: string): { type: PixType | null; key: string; label: string; valid: boolean; pretty: string } {
  const t = raw.trim()
  if (!t) return { type: null, key: '', label: '', valid: false, pretty: '' }
  if (t.includes('@')) {
    const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)
    return { type: 'email', key: t.toLowerCase(), label: 'E-mail', valid: ok, pretty: t.toLowerCase() }
  }
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(t)) {
    const h = t.replace(/-/g, '').toLowerCase()
    const k = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    return { type: 'evp', key: k, label: 'Chave aleatória', valid: true, pretty: k }
  }
  const digits = t.replace(/\D/g, '')
  if (/^\d{3}\.\d{3}\.\d{3}-?\d{2}$/.test(t)) {
    return { type: 'cpf', key: digits, label: 'CPF', valid: validCpf(digits), pretty: `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}` }
  }
  const looksPhone = t.startsWith('+') || t.includes('(') || /^55\d{10,11}$/.test(digits)
  if (!looksPhone && digits.length === 11 && validCpf(digits)) {
    return { type: 'cpf', key: digits, label: 'CPF', valid: true, pretty: `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}` }
  }
  if (!looksPhone && digits.length === 14) {
    return { type: 'cnpj', key: digits, label: 'CNPJ', valid: validCnpj(digits), pretty: `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}` }
  }
  // celular: sempre do Brasil (+55 DDD 9XXXX-XXXX)
  let n = digits
  if (n.startsWith('55') && n.length >= 12) n = n.slice(2)
  if (n.length === 10 || n.length === 11) {
    const ok = /^[1-9][1-9]9?\d{8}$/.test(n) && (n.length === 10 || n[2] === '9')
    const pretty = n.length === 11 ? `+55 ${n.slice(0, 2)} ${n.slice(2, 7)}-${n.slice(7)}` : `+55 ${n.slice(0, 2)} ${n.slice(2, 6)}-${n.slice(6)}`
    return { type: 'phone', key: `+55${n}`, label: 'Celular', valid: ok, pretty }
  }
  if (digits.length === 11) return { type: 'cpf', key: digits, label: 'CPF', valid: false, pretty: t }
  return { type: null, key: t, label: digits.length ? 'Número incompleto' : 'Formato não reconhecido', valid: false, pretty: t }
}

export async function myPixKey(): Promise<{ pix_key: string; pix_type: PixType } | null> {
  const { data } = await supabase.from('artist_payout').select('pix_key,pix_type').eq('user_id', get().userId!).maybeSingle()
  return (data as { pix_key: string; pix_type: PixType } | null) || null
}
export async function savePixKey(key: string, type: PixType): Promise<boolean> {
  const { error } = await supabase.rpc('set_pix_key', { p_key: key, p_type: type })
  if (error) { toast(errorText(error), 'error'); return false }
  return true
}

/** Lê o tamanho de uma imagem escolhida. */
export function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { res({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { res(null); URL.revokeObjectURL(url) }
    img.src = url
  })
}
export async function uploadArt(file: File): Promise<string> {
  return await uploadFile('avatars', get().userId!, file).promise
}
export async function submitBundle(f: { id?: string; name: string; description: string; avatar_frame: string; card_frame: string; price_cents: number }): Promise<boolean> {
  const { error } = await supabase.rpc('submit_bundle', { p_name: f.name, p_description: f.description, p_avatar_frame: f.avatar_frame, p_card_frame: f.card_frame, p_price_cents: f.price_cents, p_id: f.id || null })
  if (error) { toast(errorText(error), 'error'); return false }
  return true
}
export async function archiveBundle(id: string) {
  const { error } = await supabase.rpc('archive_bundle', { p_id: id })
  if (error) toast(errorText(error), 'error')
}
export async function artistStats(): Promise<{ sales: number; gross_cents: number; earned_cents: number; paid_out_cents: number } | null> {
  const { data } = await supabase.rpc('artist_stats')
  return (data as { sales: number; gross_cents: number; earned_cents: number; paid_out_cents: number } | null) || null
}

// ---------------------------------------------------------------- desenvolvedor
export async function reviewBundle(id: string, approve: boolean, priceCents: number | null, note: string): Promise<boolean> {
  const { error } = await supabase.rpc('review_bundle', { p_id: id, p_approve: approve, p_price_cents: priceCents, p_note: note })
  if (error) { toast(errorText(error), 'error'); return false }
  return true
}
export async function setBundlePrice(id: string, priceCents: number): Promise<boolean> {
  const { error } = await supabase.rpc('set_bundle_price', { p_id: id, p_price_cents: priceCents })
  if (error) { toast(errorText(error), 'error'); return false }
  return true
}
export interface DevStats { pending_bundles: number; sales: number; gross_cents: number; krata_cents: number; failed_payouts: number }
export async function devStats(): Promise<DevStats | null> {
  const { data } = await supabase.rpc('dev_stats')
  return (data as DevStats | null) || null
}
export interface OrderRow { id: string; bundle_id: string; buyer_id: string; artist_id: string; price_cents: number; status: string; provider_id: string | null; created_at: string; paid_at: string | null; manual: boolean }
export interface PayoutRow { id: string; order_id: string; kind: 'artist' | 'krata'; user_id: string | null; pix_key: string; pix_type: string; cents: number; status: string; error: string; created_at: string }
export async function devOrders(): Promise<{ orders: OrderRow[]; payouts: PayoutRow[] }> {
  const [o, p] = await Promise.all([
    supabase.from('store_orders').select('id,bundle_id,buyer_id,artist_id,price_cents,status,provider_id,created_at,paid_at,manual').order('created_at', { ascending: false }).limit(60),
    supabase.from('store_payouts').select('*').order('created_at', { ascending: false }).limit(80),
  ])
  return { orders: (o.data as OrderRow[]) || [], payouts: (p.data as PayoutRow[]) || [] }
}
export async function devConfirm(orderId: string): Promise<boolean> {
  const { error } = await supabase.rpc('dev_confirm_order', { p_order: orderId })
  if (error) { toast(errorText(error), 'error'); return false }
  return true
}
export async function devRetryPayout(id: string) {
  const { error } = await supabase.rpc('dev_retry_payout', { p_id: id })
  if (error) return toast(errorText(error), 'error')
  const r = await fetch('/api/store', { method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'payouts' }) }).catch(() => null)
  const d = (await r?.json().catch(() => ({}))) as { message?: string } | undefined
  toast(d?.message || 'Repasse reenviado.', d?.message ? 'info' : 'ok')
}
export async function artistKeys(): Promise<Record<string, { pix_key: string; pix_type: string }>> {
  const { data } = await supabase.from('artist_payout').select('user_id,pix_key,pix_type')
  return Object.fromEntries(((data as { user_id: string; pix_key: string; pix_type: string }[]) || []).map((r) => [r.user_id, r]))
}

export const statusLabel: Record<Bundle['status'], string> = { pending: 'Esperando aprovação', approved: 'À venda', rejected: 'Recusado', archived: 'Fora da loja' }
