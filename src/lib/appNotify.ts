// Notificações do app Android: o site registra o aparelho (chave própria, que não expira com a
// sessão) e repassa as mensagens que chegam enquanto ele está aberto. Com o app fechado, o próprio
// Android busca as mensagens novas com essa chave.
import type { Channel, Message, Profile } from './types'
import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase'

const n = () => window.KrataNative
const keyFor = (uid: string) => `krata-device:${uid}`

export const appVisible = () => {
  try { const v = n()?.appVisible?.(); if (typeof v === 'boolean') return v } catch { /* app antigo */ }
  return document.visibilityState === 'visible'
}

/** Liga as notificações do app para esta conta. */
export async function registerDevice(me: Profile) {
  const bridge = n()
  if (!bridge?.setInbox) return
  let secret = ''
  try { secret = localStorage.getItem(keyFor(me.id)) || '' } catch { /* sem armazenamento */ }
  if (!secret) {
    const model = (/Android [\d.]+; ([^;)]+)/.exec(navigator.userAgent)?.[1] || 'Android').trim()
    const { data, error } = await supabase.rpc('register_device', { p_name: `App · ${model}` })
    if (error || typeof data !== 'string') return // tabela ainda não criada no Supabase
    secret = data
    try { localStorage.setItem(keyFor(me.id), secret) } catch { /* sem armazenamento */ }
  }
  bridge.setInbox(JSON.stringify({ url: SUPABASE_URL, key: SUPABASE_KEY, secret, userId: me.id, username: me.username, name: me.display_name }))
  try { if (bridge.notificationsAllowed && !bridge.notificationsAllowed()) bridge.requestNotifications?.() } catch { /* app antigo */ }
}

/** Saiu da conta: o aparelho para de receber as mensagens dela. */
export async function unregisterDevice(uid: string | null) {
  const bridge = n()
  if (!bridge || !uid) return
  let secret = ''
  try { secret = localStorage.getItem(keyFor(uid)) || ''; localStorage.removeItem(keyFor(uid)) } catch { /* sem armazenamento */ }
  try { bridge.clearInbox?.() } catch { /* app antigo */ }
  if (secret) await supabase.rpc('unregister_device', { p_secret: secret }).then(() => {}, () => {})
}

/** Mostra a mensagem como notificação do Android. */
export function nativeNotify(m: Message, channel: Channel, author: Profile | undefined, extra: { title: string; serverName?: string; serverIcon?: string | null; members?: number }) {
  const bridge = n()
  if (!bridge?.notify) return false
  bridge.notify(JSON.stringify({
    id: m.id, channel_id: channel.id, server_id: channel.server_id, created_at: m.created_at,
    content: m.content.slice(0, 400), files: m.attachments.length,
    author: author?.display_name || 'Alguém', author_username: author?.username || '', author_avatar: author?.avatar_url || null, author_color: author?.accent_color || null,
    kind: channel.kind, channel_name: extra.title, server_name: extra.serverName || null, server_icon: extra.serverIcon || null, members: extra.members || 0,
  }))
  return true
}

export function clearChannelNotifications(channelId: string) {
  try { n()?.clearChannel?.(channelId) } catch { /* app antigo */ }
}
