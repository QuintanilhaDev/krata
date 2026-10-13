// Notificações no computador (Web Push).
// GET  /api/push        → chave pública para o navegador assinar (ou null se não configurado)
// POST /api/push {id}   → avisa quem deve receber esta mensagem (chamada pelo banco e pelo app)
// Variáveis na Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (e opcional VAPID_SUBJECT).
import webpush from 'web-push'
import { SERVICE_KEY, admin, env, json } from './_lib.js'

interface Att { url?: string; name?: string; type?: string }
interface Msg {
  id: string; channel_id: string; server_id: string | null; kind: string; created_at: string; content: string; attachments: Att[]
  author: string; author_username: string; author_avatar: string | null; author_color: string | null
  channel_name: string | null; server_name: string | null; server_icon: string | null; group_name: string | null; reply_to_me: boolean
}
interface Sub { id: string; endpoint: string; p256dh: string; auth: string }

const configured = () => !!(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Texto curto e limpo da mensagem (sem marcações), como aparece no aviso. */
export function preview(content: string, attachments: Att[]): string {
  let t = (content || '').trim()
  if (/^https:\/\/(media[0-9]?\.tenor\.com|c\.tenor\.com|media[0-9]?\.giphy\.com|i\.giphy\.com)\/\S+$/i.test(t)) return 'Enviou um GIF'
  t = t.replace(/<:([a-z0-9_]+):[0-9a-f-]{36}>/gi, ':$1:')
    .replace(/https?:\/\/\S+#\/invite\/[a-z0-9]{6,16}/gi, '📨 Convite para um servidor')
    .replace(/```[\s\S]*?```/g, '[código]')
    .replace(/\|\|([\s\S]*?)\|\|/g, '▒▒▒')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$)/g, '$1$2')
    .replace(/\s+/g, ' ').trim()
  if (!t && attachments.length) {
    const a = attachments[0]
    const more = attachments.length > 1 ? ` (+${attachments.length - 1})` : ''
    if (a.type?.startsWith('image/')) return `📷 Foto${more}`
    if (a.type?.startsWith('video/')) return `🎬 Vídeo${more}`
    if (a.type?.startsWith('audio/')) return `🎵 Áudio${more}`
    return `📎 ${a.name || 'Arquivo'}${more}`
  }
  if (attachments.length) t += ` 📎`
  return t.length > 220 ? `${t.slice(0, 217)}…` : t
}

export function payloadFor(m: Msg) {
  const title = m.server_id
    ? `${m.author} (#${m.channel_name || 'canal'}, ${m.server_name || 'servidor'})`
    : m.kind === 'group' ? `${m.author} · ${m.group_name || 'Grupo'}` : m.author
  const img = m.attachments.find((a) => a.type?.startsWith('image/') && a.url?.startsWith('https://'))?.url || null
  return {
    t: title.slice(0, 120), b: preview(m.content, m.attachments), who: m.author, au: m.author_avatar, ac: m.author_color || '#00A86B',
    ch: m.channel_id, sv: m.server_id, id: m.id, ts: Date.parse(m.created_at) || Date.now(), img,
    k: m.server_id ? (m.reply_to_me && !/@/.test(m.content) ? 'reply' : 'mention') : m.kind,
  }
}

export async function GET() {
  return json(200, { publicKey: configured() ? env('VAPID_PUBLIC_KEY') : null })
}

export async function POST(request: Request) {
  let body: { id?: string }
  try { body = await request.json() } catch { return json(400, { error: 'json' }) }
  // vem do banco (pg_net) e do próprio app: sem chave, sem envio — e cada mensagem só sai uma vez
  if (!configured() || !SERVICE_KEY()) return json(200, { sent: 0, reason: 'not_configured' })
  const id = String(body.id || '')
  if (!UUID.test(id)) return json(400, { error: 'id' })
  const r = await admin('rpc/push_targets', { method: 'POST', body: JSON.stringify({ p_message: id }) })
  if (!r.ok) return json(502, { error: 'targets', detail: (await r.text()).slice(0, 200) })
  const data = (await r.json()) as { message: Msg; subs: Sub[] } | null
  if (!data || !data.subs?.length) return json(200, { sent: 0 })

  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'https://krata-henna.vercel.app', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))
  const payload = JSON.stringify(payloadFor(data.message))
  const topic = data.message.channel_id.replace(/-/g, '').slice(0, 32) // um aviso pendente por conversa
  let sent = 0
  const dead: string[] = []
  await Promise.all(data.subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: 'high', topic, timeout: 8000 })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) dead.push(s.id) // navegador desinstalou ou tirou a permissão
    }
  }))
  if (dead.length) await admin(`push_subscriptions?id=in.(${dead.join(',')})`, { method: 'DELETE' }).catch(() => {})
  return json(200, { sent, removed: dead.length })
}
