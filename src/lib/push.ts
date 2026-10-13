// Notificações no computador (e no Chrome do celular, pelo site).
// Com as notificações ligadas, o navegador assina o Web Push: o aviso chega mesmo com a aba
// fechada. Sem a chave configurada no servidor, o próprio site avisa enquanto estiver aberto.
import type { Channel, Message, Profile } from './types'
import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase'

const KEY_ON = 'krata-notify'
const KEY_PUSH = 'krata-push'
const deviceKey = (uid: string) => `krata-web-device:${uid}`
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }

export const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window && !window.KrataNative
export const pushSupported = () => desktopSupported() && 'serviceWorker' in navigator && 'PushManager' in window
export const desktopPermission = (): NotificationPermission | 'unsupported' => (desktopSupported() ? Notification.permission : 'unsupported')
export const desktopOn = () => desktopSupported() && Notification.permission === 'granted' && read(KEY_ON) === 'on'
/** O aviso chega pelo Web Push (o site não precisa mostrar nada sozinho). */
export const pushActive = () => desktopOn() && !!read(KEY_PUSH)

let reg: Promise<ServiceWorkerRegistration | null> | null = null
export function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || window.KrataNative) return Promise.resolve(null)
  if (!reg) {
    reg = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch(() => null)
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data as { type?: string; ch?: string; sv?: string | null; reply?: boolean }
      if (d?.type === 'krata-open' && d.ch) window.dispatchEvent(new CustomEvent('krata-open-chat', { detail: d }))
    })
  }
  return reg
}

const urlKey = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
const browserName = () => {
  const ua = navigator.userAgent
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : ''
  return `${b}${os ? ` · ${os}` : ''}`
}

/** Liga as notificações (precisa vir de um clique: o navegador pergunta a permissão). */
export async function enableDesktop(me: Profile): Promise<'on' | 'blocked' | 'unsupported'> {
  if (!desktopSupported()) return 'unsupported'
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (perm !== 'granted') return 'blocked'
  write(KEY_ON, 'on')
  await syncPush(me)
  return 'on'
}

export async function disableDesktop() {
  write(KEY_ON, 'off')
  await dropPush()
}

/** Garante a assinatura do Web Push desta conta neste navegador (roda ao abrir o Krata). */
export async function syncPush(me: Profile): Promise<boolean> {
  if (!desktopOn()) return false
  const r = await registerWorker()
  if (!r) return false
  // chave do "aparelho" para o botão "Marcar como lida" funcionar com a aba fechada
  try {
    let secret = read(deviceKey(me.id))
    if (!secret) {
      const { data } = await supabase.rpc('register_device', { p_name: browserName() })
      if (typeof data === 'string') { secret = data; write(deviceKey(me.id), secret) }
    }
    r.active?.postMessage({ type: 'config', config: secret ? { url: SUPABASE_URL, key: SUPABASE_KEY, secret } : null })
  } catch { /* tabela de aparelhos ainda não criada */ }
  if (!pushSupported()) return false
  let publicKey: string | null = null
  try { publicKey = ((await (await fetch('/api/push', { cache: 'no-store' })).json()) as { publicKey?: string | null }).publicKey || null } catch { publicKey = null }
  if (!publicKey) { write(KEY_PUSH, null); return false }
  try {
    let sub = await r.pushManager.getSubscription()
    const want = urlKey(publicKey)
    const have = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
    if (sub && (!have || have.length !== want.length || have.some((b, i) => b !== want[i]))) { await sub.unsubscribe().catch(() => {}); sub = null }
    // alguns navegadores demoram (ou travam) quando o serviço de push está fora do ar: desiste em 12 s
    if (!sub) sub = await Promise.race([r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want }), new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), 12000))])
    const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) return false
    const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_agent: browserName() })
    if (error) { write(KEY_PUSH, null); return false }
    write(KEY_PUSH, j.endpoint)
    return true
  } catch {
    write(KEY_PUSH, null)
    return false
  }
}

/** Saiu da conta (ou desligou): este navegador para de receber os avisos dela. */
export async function dropPush(uid?: string | null) {
  const endpoint = read(KEY_PUSH)
  write(KEY_PUSH, null)
  if (endpoint) await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint }).then(() => {}, () => {})
  const r = await (reg || Promise.resolve(null))
  r?.active?.postMessage({ type: 'config', config: null })
  if (uid) {
    const secret = read(deviceKey(uid))
    write(deviceKey(uid), null)
    if (secret) await supabase.rpc('unregister_device', { p_secret: secret }).then(() => {}, () => {})
  }
}

/** Pede ao servidor para avisar os outros (o banco também chama; a mensagem só sai uma vez). */
export function pingPush(m: Pick<Message, 'id' | 'content' | 'reply_to'>, channel: Channel | undefined) {
  if (!channel) return
  if (channel.server_id && !m.reply_to && !m.content.includes('@')) return
  void fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: m.id }), keepalive: true }).catch(() => {})
}

// ------------------------------------------------------------------ aviso feito pelo próprio site
export function preview(content: string, files: { type?: string; name?: string }[]): string {
  let t = (content || '').trim()
  if (/^https:\/\/(media[0-9]?\.tenor\.com|c\.tenor\.com|media[0-9]?\.giphy\.com|i\.giphy\.com)\/\S+$/i.test(t)) return 'Enviou um GIF'
  t = t.replace(/<:([a-z0-9_]+):[0-9a-f-]{36}>/gi, ':$1:').replace(/https?:\/\/\S+#\/invite\/[a-z0-9]{6,16}/gi, '📨 Convite para um servidor')
    .replace(/```[\s\S]*?```/g, '[código]').replace(/\|\|([\s\S]*?)\|\|/g, '▒▒▒').replace(/(\*\*|__|~~|`)/g, '').replace(/\s+/g, ' ').trim()
  if (!t && files.length) {
    const a = files[0]
    const more = files.length > 1 ? ` (+${files.length - 1})` : ''
    return a.type?.startsWith('image/') ? `📷 Foto${more}` : a.type?.startsWith('video/') ? `🎬 Vídeo${more}` : `📎 ${a.name || 'Arquivo'}${more}`
  }
  return t.length > 220 ? `${t.slice(0, 217)}…` : t
}

export interface LocalPayload { t: string; b: string; who: string; au: string | null; ac: string; ch: string; sv: string | null; id: string; ts: number; img: string | null; k: string }

/** Mostra o aviso pelo service worker (mesmo visual do Web Push); sem ele, uma notificação simples. */
export async function showLocal(p: LocalPayload) {
  const r = await registerWorker()
  if (r?.active) { r.active.postMessage({ type: 'show', payload: p }); return }
  try {
    const n = new Notification(p.t, { body: p.b, icon: p.au || '/icon-192.png', tag: `krata-${p.ch}`, badge: '/badge-96.png' })
    n.onclick = () => { window.focus(); window.dispatchEvent(new CustomEvent('krata-open-chat', { detail: { ch: p.ch, sv: p.sv } })); n.close() }
  } catch { /* indisponível */ }
}
