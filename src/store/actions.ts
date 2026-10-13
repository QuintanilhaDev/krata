import type { RealtimeChannel } from '@supabase/supabase-js'
import { dropChannel, errorText, openChannel as openRealtime, safeMediaUrl, supabase } from '../lib/supabase'
import { sounds } from '../lib/sound'
import type { Attachment, Channel, CustomEmoji, DmMember, Friendship, Member, Message, Profile, Reaction, Role, Server, Status } from '../lib/types'
import { appVisible, clearChannelNotifications, nativeNotify, unregisterDevice } from '../lib/appNotify'
import { desktopOn, dropPush, pingPush, preview as pushPreview, pushActive, showLocal } from '../lib/push'
import { MAX_FILE_BYTES, MAX_FILES, describeFile, uploadFile } from '../lib/upload'
import { fileSize } from '../lib/time'
import { channelTitle, get, initialState, set, toast, type MsgList, type Nav } from './app'
import { currentVoiceChannel, leaveVoice, startUserChannel, stopVoiceEverything } from '../voice/engine'

const PAGE = 50
const emptyList: MsgList = { items: [], hasMore: true, loaded: false, loading: false }

// ============================================================ sessão
let booted = false
export async function boot() {
  if (booted) return
  booted = true
  supabase.auth.onAuthStateChange((event, session) => {
    // Evita travar o cliente de auth: o trabalho pesado roda fora do callback.
    setTimeout(() => {
      const uid = session?.user?.id ?? null
      if (event === 'SIGNED_OUT' || !uid) { if (get().userId) void teardown() ; return }
      if (uid !== get().userId) void enter(uid)
    }, 0)
  })
  const { data } = await supabase.auth.getSession()
  if (data.session?.user) await enter(data.session.user.id)
  else set({ booting: false })
}

let entering: string | null = null
async function enter(uid: string) {
  if (entering === uid || get().userId === uid) return
  entering = uid
  try {
    set({ userId: uid })
    let me: Profile | null = null
    for (let i = 0; i < 4 && !me; i++) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
      if (error && i === 3) throw error
      me = data as Profile | null
      if (!me) await new Promise((r) => setTimeout(r, 500))
    }
    if (!me) throw new Error('Perfil não encontrado. Rode o arquivo supabase/schema.sql no seu projeto.')
    set((s) => ({ me, profiles: { ...s.profiles, [uid]: me } }))
    await startApp()
  } catch (e) {
    toast(errorText(e), 'error')
    await supabase.auth.signOut().catch(() => {})
    set({ ...initialState, booting: false })
  } finally {
    entering = null
    set({ booting: false })
  }
}

export async function startApp() {
  await loadStructure()
  await startRealtime()
  applyHash()
  window.addEventListener('hashchange', applyHash)
  window.addEventListener('online', resync)
  document.addEventListener('visibilitychange', onVisible)
}

async function teardown() {
  window.removeEventListener('hashchange', applyHash)
  window.removeEventListener('online', resync)
  document.removeEventListener('visibilitychange', onVisible)
  await stopVoiceEverything()
  await stopRealtime()
  set({ ...initialState, booting: false })
}

export async function signOut() {
  await unregisterDevice(get().userId)
  await dropPush(get().userId)
  await stopVoiceEverything()
  await supabase.auth.signOut().catch(() => {})
  if (get().userId) await teardown()
  history.replaceState(null, '', location.pathname)
}

function onVisible() {
  if (document.visibilityState !== 'visible' || !appVisible()) return
  const ch = get().nav.channelId
  if (ch && get().unread[ch]) void markRead(ch)
}

// ============================================================ navegação
const lastChannelKey = (serverId: string) => `krata-last-${serverId}`

export function navigate(nav: Nav, opts: { keepPanel?: boolean } = {}) {
  const s = get()
  let { serverId, channelId } = nav
  if (serverId && !channelId) {
    const list = s.channels.filter((c) => c.server_id === serverId && c.kind === 'text')
    const saved = localStorage.getItem(lastChannelKey(serverId))
    channelId = (list.find((c) => c.id === saved) || [...list].sort(byPosition)[0])?.id ?? null
  }
  const changedChannel = channelId !== s.nav.channelId
  set({ nav: { serverId, channelId }, editing: changedChannel ? null : s.editing, mobileNav: opts.keepPanel ? s.mobileNav : !channelId })
  if (serverId && channelId) localStorage.setItem(lastChannelKey(serverId), channelId)
  const hash = serverId ? `#/s/${serverId}${channelId ? `/${channelId}` : ''}` : channelId ? `#/@me/${channelId}` : '#/@me'
  if (location.hash !== hash) history.pushState(null, '', hash)
  if (serverId && !s.members[serverId]) void loadMembers(serverId)
  if (changedChannel) joinRoom(channelId)
  if (channelId) void openChannel(channelId)
}

function applyHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const s = get()
  if (parts[0] === 'invite' && parts[1]) {
    set({ modal: { type: 'joinServer', code: parts[1] } })
    history.replaceState(null, '', '#/@me')
    return navigate({ serverId: null, channelId: null }, { keepPanel: true })
  }
  if (parts[0] === 's' && s.servers.some((x) => x.id === parts[1])) {
    const ch = s.channels.find((c) => c.id === parts[2] && c.server_id === parts[1] && c.kind === 'text')
    return navigate({ serverId: parts[1], channelId: ch?.id ?? null }, { keepPanel: !ch })
  }
  const dm = s.channels.find((c) => c.id === parts[1] && !c.server_id)
  navigate({ serverId: null, channelId: dm?.id ?? null }, { keepPanel: true })
  if (!dm) set({ mobileNav: true })
}

export const byPosition = (a: Channel, b: Channel) => a.position - b.position || a.created_at.localeCompare(b.created_at)

// ============================================================ carregamento
export async function ensureProfiles(ids: string[]) {
  const known = get().profiles
  const missing = [...new Set(ids)].filter((id) => id && !known[id])
  if (!missing.length) return
  const found: Record<string, Profile> = {}
  for (let i = 0; i < missing.length; i += 150) {
    const { data } = await supabase.from('profiles').select('*').in('id', missing.slice(i, i + 150))
    for (const p of (data as Profile[] | null) || []) found[p.id] = p
  }
  set((s) => ({ profiles: { ...found, ...s.profiles } }))
}
function pick<T>(obj: Record<string, T>, keep: (k: string) => boolean) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keep(k)))
}

export async function loadStructure() {
  const uid = get().userId
  if (!uid) return
  const [servers, channels, dms, friends, emojis, unread, roles] = await Promise.all([
    supabase.from('servers').select('*').order('created_at'),
    supabase.from('channels').select('*'),
    supabase.from('dm_members').select('channel_id,user_id'),
    supabase.from('friendships').select('*'),
    supabase.from('emojis').select('*'),
    supabase.rpc('unread_counts'),
    supabase.from('server_members').select('server_id,role').eq('user_id', uid),
  ])
  const failed = [servers, channels, dms, friends, emojis, roles].find((r) => r.error)
  if (failed?.error) { toast(errorText(failed.error), 'error'); return }
  if (get().userId !== uid) return
  const dmMembers = (dms.data as DmMember[]) || []
  const friendList = (friends.data as Friendship[]) || []
  const counts: Record<string, number> = {}
  for (const r of (unread.data as { channel_id: string; unread: number }[] | null) || []) counts[r.channel_id] = Number(r.unread)
  const active = get().nav.channelId
  if (active && document.visibilityState === 'visible') delete counts[active]
  set({
    servers: (servers.data as Server[]) || [],
    channels: (channels.data as Channel[]) || [],
    dmMembers,
    friends: friendList,
    emojis: Object.fromEntries(((emojis.data as CustomEmoji[]) || []).map((e) => [e.id, e])),
    roles: Object.fromEntries(((roles.data as { server_id: string; role: Role }[]) || []).map((r) => [r.server_id, r.role])),
    unread: counts,
    structureLoaded: true,
  })
  await ensureProfiles([...dmMembers.map((m) => m.user_id), ...friendList.flatMap((f) => [f.requester_id, f.addressee_id])])
  // Se o lugar onde eu estava deixou de existir (canal apagado, expulsão…), volta para um lugar válido.
  const s = get()
  const { serverId, channelId } = s.nav
  if (serverId && !s.servers.some((x) => x.id === serverId)) {
    toast('Você não faz mais parte desse servidor.')
    navigate({ serverId: null, channelId: null })
  } else if (channelId && !s.channels.some((c) => c.id === channelId)) {
    navigate({ serverId, channelId: null })
  }
}

let structureTimer: ReturnType<typeof setTimeout> | null = null
function refreshStructureSoon() {
  if (structureTimer) clearTimeout(structureTimer)
  structureTimer = setTimeout(() => { structureTimer = null; void loadStructure() }, 250)
}

export async function loadMembers(serverId: string) {
  const { data, error } = await supabase.from('server_members').select('*').eq('server_id', serverId)
  if (error) return
  const list = (data as Member[]) || []
  set((s) => ({ members: { ...s.members, [serverId]: list } }))
  await ensureProfiles(list.map((m) => m.user_id))
}

function normalize(row: Record<string, unknown>): Message {
  let attachments = row.attachments as Attachment[] | string
  if (typeof attachments === 'string') { try { attachments = JSON.parse(attachments) } catch { attachments = [] } }
  // ignora anexos fora do formato ou fora do Storage do projeto
  const clean = (Array.isArray(attachments) ? attachments : []).filter((a): a is Attachment =>
    !!a && typeof a === 'object' && typeof a.url === 'string' && typeof a.name === 'string' && typeof a.type === 'string' &&
    typeof a.size === 'number' && !!safeMediaUrl(a.url))
  return { ...(row as unknown as Message), content: typeof row.content === 'string' ? row.content : '', attachments: clean, reactions: (row.reactions as Reaction[]) || [] }
}

async function loadReplies(msgs: Message[]) {
  const s = get()
  const have = new Set(Object.values(s.messages).flatMap((l) => l.items.map((m) => m.id)))
  const ids = [...new Set(msgs.map((m) => m.reply_to).filter((id): id is string => !!id && !have.has(id) && !(id in s.replyCache)))]
  if (!ids.length) return
  const { data } = await supabase.from('messages').select('*').in('id', ids)
  const rows = ((data as Record<string, unknown>[]) || []).map(normalize)
  await ensureProfiles(rows.map((r) => r.author_id))
  set((st) => ({ replyCache: { ...st.replyCache, ...Object.fromEntries(ids.map((id) => [id, rows.find((r) => r.id === id) || null])) } }))
}

export async function loadMessages(channelId: string, older = false) {
  const cur = get().messages[channelId] || emptyList
  if (cur.loading || (older && !cur.hasMore)) return
  set((s) => ({ messages: { ...s.messages, [channelId]: { ...cur, loading: true } } }))
  let q = supabase.from('messages').select('*, reactions(emoji,user_id)').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(PAGE)
  const oldest = cur.items.find((m) => !m.pending)
  if (older && oldest) q = q.lt('created_at', oldest.created_at)
  const { data, error } = await q
  if (error) {
    set((s) => ({ messages: { ...s.messages, [channelId]: { ...(s.messages[channelId] || emptyList), loading: false } } }))
    toast(errorText(error), 'error')
    return
  }
  const rows = ((data as Record<string, unknown>[]) || []).map(normalize).reverse()
  await ensureProfiles(rows.map((m) => m.author_id))
  set((s) => {
    const now = s.messages[channelId] || emptyList
    const fresh = new Set(rows.map((m) => m.id))
    // ao recarregar, mantém o que chegou em tempo real e o que ainda está sendo enviado
    const keep = older ? now.items : now.items.filter((m) => !fresh.has(m.id) && (m.pending || m.failed || (rows.length > 0 && m.created_at > rows[rows.length - 1].created_at)))
    const items = older ? [...rows.filter((m) => !now.items.some((x) => x.id === m.id)), ...keep] : [...rows, ...keep]
    return { messages: { ...s.messages, [channelId]: { items, hasMore: rows.length === PAGE, loaded: true, loading: false } } }
  })
  void loadReplies(rows)
}

export async function openChannel(channelId: string) {
  const list = get().messages[channelId]
  if (!list?.loaded) await loadMessages(channelId)
  if (get().nav.channelId === channelId && document.visibilityState === 'visible') void markRead(channelId)
}

export async function markRead(channelId: string) {
  clearChannelNotifications(channelId)
  if (get().unread[channelId]) set((s) => ({ unread: { ...s.unread, [channelId]: 0 } }))
  await supabase.rpc('mark_read', { p_channel: channelId })
}

// ============================================================ mensagens
/** Mensagens na ordem do servidor (horário de criação); as que ainda estão saindo ficam no fim. */
function ordered(items: Message[]): Message[] {
  let sorted = true
  for (let i = 1; i < items.length; i++) if (rank(items[i - 1], items[i]) > 0) { sorted = false; break }
  return sorted ? items : [...items].sort(rank)
}
function rank(a: Message, b: Message): number {
  const pa = a.pending || a.failed ? 1 : 0, pb = b.pending || b.failed ? 1 : 0
  if (pa !== pb) return pa - pb
  if (pa) return 0
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function patchList(channelId: string, fn: (items: Message[]) => Message[]) {
  set((s) => {
    const l = s.messages[channelId]
    if (!l) return s
    return { messages: { ...s.messages, [channelId]: { ...l, items: ordered(fn(l.items)) } } }
  })
}
function patchMessage(id: string, fn: (m: Message) => Message) {
  set((s) => {
    for (const [cid, l] of Object.entries(s.messages)) {
      if (l.items.some((m) => m.id === id))
        return { messages: { ...s.messages, [cid]: { ...l, items: ordered(l.items.map((m) => (m.id === id ? fn(m) : m))) } } }
    }
    return s
  })
}

export function checkFiles(files: File[], already = 0): File[] {
  const ok: File[] = []
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) { toast(`"${f.name}" tem ${fileSize(f.size)}. O limite é 200 MB por arquivo.`, 'error'); continue }
    if (f.size === 0) { toast(`"${f.name}" está vazio.`, 'error'); continue }
    if (already + ok.length >= MAX_FILES) { toast(`Cada mensagem aceita até ${MAX_FILES} arquivos.`, 'error'); break }
    ok.push(f)
  }
  return ok
}

export async function sendMessage(channelId: string, content: string, files: File[] = [], replyTo: string | null = null): Promise<boolean> {
  const s = get()
  const uid = s.userId
  if (!uid) return false
  const text = content.trim()
  if (!text && !files.length) return false
  if (text.length > 4000) { toast('A mensagem passa de 4.000 caracteres.', 'error'); return false }
  const id = crypto.randomUUID()
  let attachments: Attachment[] = []
  if (files.length) {
    const handles = files.map((file) => {
      const uploadId = crypto.randomUUID()
      const h = uploadFile('attachments', uid, file, (p) =>
        set((st) => ({ uploads: st.uploads.map((u) => (u.id === uploadId ? { ...u, progress: p } : u)) })))
      set((st) => ({ uploads: [...st.uploads, { id: uploadId, channelId, name: file.name, size: file.size, progress: 0, abort: h.abort }] }))
      return { file, uploadId, h }
    })
    const results = await Promise.allSettled(handles.map(async ({ file, h }) => describeFile(file, await h.promise)))
    const ids = new Set<string>(handles.map((h) => h.uploadId))
    set((st) => ({ uploads: st.uploads.filter((u) => !ids.has(u.id)) }))
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    const realFailure = failures.find((f) => f.reason?.name !== 'AbortError')
    if (realFailure) toast(errorText(realFailure.reason), 'error')
    attachments = results.filter((r): r is PromiseFulfilledResult<Attachment> => r.status === 'fulfilled').map((r) => r.value)
    if (realFailure) return false
    if (!attachments.length && !text) return false
  }
  const optimistic: Message = {
    id, channel_id: channelId, author_id: uid, content: text, attachments, reply_to: replyTo, pinned: false,
    edited_at: null, created_at: new Date().toISOString(), reactions: [], pending: true,
  }
  set((st) => {
    const l = st.messages[channelId] || { ...emptyList, loaded: true, hasMore: false }
    return { messages: { ...st.messages, [channelId]: { ...l, items: [...l.items, optimistic] } }, replyingTo: { ...st.replyingTo, [channelId]: null } }
  })
  return await deliver(optimistic)
}

async function deliver(m: Message): Promise<boolean> {
  const { data, error } = await supabase.from('messages')
    .insert({ id: m.id, channel_id: m.channel_id, author_id: m.author_id, content: m.content, attachments: m.attachments, reply_to: m.reply_to })
    .select('*').single()
  if (error) {
    patchMessage(m.id, (x) => ({ ...x, pending: false, failed: true }))
    toast(errorText(error), 'error')
    return false
  }
  const saved = normalize(data as Record<string, unknown>)
  patchMessage(m.id, (x) => ({ ...saved, reactions: x.reactions }))
  // avisa quem precisa (computador e celular dos outros), mesmo se o banco não chamar sozinho
  pingPush(saved, get().channels.find((c) => c.id === saved.channel_id))
  return true
}

export async function retryMessage(id: string) {
  const m = Object.values(get().messages).flatMap((l) => l.items).find((x) => x.id === id)
  if (!m) return
  patchMessage(id, (x) => ({ ...x, pending: true, failed: false }))
  await deliver(m)
}
export function discardMessage(m: Message) {
  patchList(m.channel_id, (items) => items.filter((x) => x.id !== m.id))
}

export async function editMessage(m: Message, content: string) {
  const text = content.trim()
  set({ editing: null })
  if (text === m.content) return
  if (!text && !m.attachments.length) return void deleteMessage(m)
  if (text.length > 4000) return toast('A mensagem passa de 4.000 caracteres.', 'error')
  patchMessage(m.id, (x) => ({ ...x, content: text, edited_at: new Date().toISOString() }))
  const { error } = await supabase.from('messages').update({ content: text }).eq('id', m.id)
  if (error) { patchMessage(m.id, (x) => ({ ...x, content: m.content, edited_at: m.edited_at })); toast(errorText(error), 'error') }
}

export async function deleteMessage(m: Message) {
  const { error } = await supabase.from('messages').delete().eq('id', m.id)
  if (error) return toast(errorText(error), 'error')
  patchList(m.channel_id, (items) => items.filter((x) => x.id !== m.id))
}

export async function toggleReaction(m: Message, emoji: string) {
  const uid = get().userId!
  const mine = m.reactions.some((r) => r.user_id === uid && r.emoji === emoji)
  if (!mine && new Set(m.reactions.map((r) => r.emoji)).size >= 20 && !m.reactions.some((r) => r.emoji === emoji))
    return toast('Esta mensagem já tem 20 reações diferentes.', 'error')
  patchMessage(m.id, (x) => ({ ...x, reactions: mine ? x.reactions.filter((r) => !(r.user_id === uid && r.emoji === emoji)) : [...x.reactions.filter((r) => !(r.user_id === uid && r.emoji === emoji)), { emoji, user_id: uid }] }))
  const { error } = mine
    ? await supabase.from('reactions').delete().match({ message_id: m.id, user_id: uid, emoji })
    : await supabase.from('reactions').insert({ message_id: m.id, user_id: uid, emoji })
  if (error && error.code !== '23505') {
    patchMessage(m.id, (x) => ({ ...x, reactions: m.reactions }))
    toast(errorText(error), 'error')
  }
  try {
    const recent = [emoji, ...JSON.parse(localStorage.getItem('krata-recent-emoji') || '[]').filter((e: string) => e !== emoji)].slice(0, 24)
    localStorage.setItem('krata-recent-emoji', JSON.stringify(recent))
  } catch { /* sem armazenamento */ }
}

export async function setPinned(m: Message, pinned: boolean) {
  const { error } = await supabase.rpc('set_pinned', { p_message: m.id, p_pinned: pinned })
  if (error) return toast(errorText(error), 'error')
  patchMessage(m.id, (x) => ({ ...x, pinned }))
  toast(pinned ? 'Mensagem fixada' : 'Mensagem desafixada', 'ok')
}

export async function fetchPins(channelId: string): Promise<Message[]> {
  const { data, error } = await supabase.from('messages').select('*, reactions(emoji,user_id)').eq('channel_id', channelId).eq('pinned', true).order('created_at', { ascending: false })
  if (error) { toast(errorText(error), 'error'); return [] }
  const rows = ((data as Record<string, unknown>[]) || []).map(normalize)
  await ensureProfiles(rows.map((r) => r.author_id))
  return rows
}
export async function searchMessages(channelId: string, query: string): Promise<Message[]> {
  const { data, error } = await supabase.rpc('search_messages', { p_channel: channelId, p_query: query })
  if (error) { toast(errorText(error), 'error'); return [] }
  const rows = ((data as Record<string, unknown>[]) || []).map(normalize)
  await ensureProfiles(rows.map((r) => r.author_id))
  return rows
}

// ============================================================ perfil
export async function updateProfile(patch: Partial<Profile>): Promise<boolean> {
  const uid = get().userId
  if (!uid) return false
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', uid).select('*').single()
  if (error) { toast(errorText(error), 'error'); return false }
  const me = data as Profile
  set((s) => ({ me, profiles: { ...s.profiles, [uid]: me } }))
  if ('status' in patch) void trackPresence()
  return true
}
export async function usernameAvailable(username: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('username_available', { p_username: username })
  return error ? null : !!data
}

// ============================================================ servidores
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) { toast(errorText(error), 'error'); return null }
  return data as T
}

export async function createServer(name: string, icon: string | null) {
  const id = await rpc<string>('create_server', { p_name: name, p_icon: icon })
  if (!id) return false
  await loadStructure()
  navigate({ serverId: id, channelId: null })
  return true
}
export async function joinServer(code: string) {
  const id = await rpc<string>('join_server', { p_code: code })
  if (!id) return false
  await loadStructure()
  navigate({ serverId: id, channelId: null })
  return true
}
export const inviteCodeFrom = (input: string) => (input.trim().split(/[/#?=]/).filter(Boolean).pop() || '').toLowerCase()
export async function invitePreview(code: string) {
  const { data } = await supabase.rpc('invite_preview', { p_code: code })
  return ((data as { id: string; name: string; icon_url: string | null; member_count: number; already_member: boolean }[]) || [])[0] || null
}
export async function updateServer(id: string, patch: Partial<Pick<Server, 'name' | 'icon_url'>>) {
  const { error } = await supabase.from('servers').update(patch).eq('id', id)
  if (error) { toast(errorText(error), 'error'); return false }
  set((s) => ({ servers: s.servers.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  return true
}
export async function regenerateInvite(id: string) {
  const code = await rpc<string>('regenerate_invite', { p_server: id })
  if (code) set((s) => ({ servers: s.servers.map((x) => (x.id === id ? { ...x, invite_code: code } : x)) }))
  return code
}
export async function deleteServer(id: string) {
  if (voiceServerId() === id) await leaveVoice()
  const { error } = await supabase.from('servers').delete().eq('id', id)
  if (error) return toast(errorText(error), 'error')
  set((s) => ({ servers: s.servers.filter((x) => x.id !== id), channels: s.channels.filter((c) => c.server_id !== id) }))
  if (get().nav.serverId === id) navigate({ serverId: null, channelId: null })
  toast('Servidor apagado', 'ok')
}
export async function leaveServer(id: string) {
  if (voiceServerId() === id) await leaveVoice()
  const { error } = await supabase.from('server_members').delete().match({ server_id: id, user_id: get().userId })
  if (error) return toast(errorText(error), 'error')
  set((s) => ({ servers: s.servers.filter((x) => x.id !== id), channels: s.channels.filter((c) => c.server_id !== id) }))
  if (get().nav.serverId === id) navigate({ serverId: null, channelId: null })
}
const voiceServerId = () => get().channels.find((c) => c.id === currentVoiceChannel())?.server_id ?? null
export async function kickMember(serverId: string, userId: string) {
  const { error } = await supabase.from('server_members').delete().match({ server_id: serverId, user_id: userId })
  if (error) return toast(errorText(error), 'error')
  set((s) => ({ members: { ...s.members, [serverId]: (s.members[serverId] || []).filter((m) => m.user_id !== userId) } }))
}
export async function setMemberRole(serverId: string, userId: string, role: 'admin' | 'member') {
  if ((await rpc('set_member_role', { p_server: serverId, p_user: userId, p_role: role })) === null) return
  set((s) => ({ members: { ...s.members, [serverId]: (s.members[serverId] || []).map((m) => (m.user_id === userId ? { ...m, role } : m)) } }))
}
export async function transferServer(serverId: string, userId: string) {
  if ((await rpc('transfer_server', { p_server: serverId, p_user: userId })) === null) return
  await Promise.all([loadStructure(), loadMembers(serverId)])
  toast('Servidor transferido', 'ok')
}

export async function saveChannel(serverId: string, existing: Channel | undefined, fields: { name: string; topic: string; category: string; kind: 'text' | 'voice' }) {
  const name = fields.kind === 'text' ? fields.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 60) : fields.name.trim().slice(0, 60)
  if (!name) { toast('Dê um nome ao canal.', 'error'); return false }
  if (existing) {
    const { error } = await supabase.from('channels').update({ name, topic: fields.topic.trim(), category: fields.category.trim() }).eq('id', existing.id)
    if (error) { toast(errorText(error), 'error'); return false }
  } else {
    const siblings = get().channels.filter((c) => c.server_id === serverId && c.kind === fields.kind)
    const position = siblings.reduce((max, c) => Math.max(max, c.position), -1) + 1
    const { data, error } = await supabase.from('channels').insert({ server_id: serverId, kind: fields.kind, name, topic: fields.topic.trim(), category: fields.category.trim(), position }).select('*').single()
    if (error) { toast(errorText(error), 'error'); return false }
    const c = data as Channel
    set((s) => ({ channels: s.channels.some((x) => x.id === c.id) ? s.channels : [...s.channels, c] }))
    if (c.kind === 'text') navigate({ serverId, channelId: c.id })
  }
  await loadStructure()
  return true
}
export async function deleteChannel(c: Channel) {
  const { error } = await supabase.from('channels').delete().eq('id', c.id)
  if (error) return toast(errorText(error), 'error')
  await loadStructure()
}

export async function addEmoji(serverId: string, name: string, file: File) {
  const uid = get().userId!
  try {
    const url = await uploadFile('avatars', uid, file).promise
    const { error } = await supabase.from('emojis').insert({ server_id: serverId, name, url, created_by: uid })
    if (error) throw error
    await loadStructure()
    return true
  } catch (e) { toast(errorText(e), 'error'); return false }
}
export async function removeEmoji(id: string) {
  const { error } = await supabase.from('emojis').delete().eq('id', id)
  if (error) return toast(errorText(error), 'error')
  set((s) => ({ emojis: pick(s.emojis, (k) => k !== id) }))
}

// ============================================================ amigos e conversas
export async function sendFriendRequest(username: string): Promise<boolean> {
  const r = await rpc<string>('send_friend_request', { p_username: username })
  if (!r) return false
  toast(r === 'accepted' ? 'Agora vocês são amigos' : 'Pedido de amizade enviado', 'ok')
  await loadStructure()
  return true
}
export async function acceptFriend(id: string) {
  if ((await rpc('accept_friend_request', { p_id: id })) === null) return
  set((s) => ({ friends: s.friends.map((f) => (f.id === id ? { ...f, status: 'accepted' } : f)) }))
}
export async function removeFriend(id: string) {
  const { error } = await supabase.from('friendships').delete().eq('id', id)
  if (error) return toast(errorText(error), 'error')
  set((s) => ({ friends: s.friends.filter((f) => f.id !== id) }))
}
/** Id da conversa privada com alguém (cria se ainda não existe), sem sair da tela atual. */
export async function dmWith(userId: string, quiet = false): Promise<string | null> {
  const s = get()
  const key = [s.userId, userId].sort().join(':')
  const known = s.channels.find((c) => c.dm_key === key)?.id
  if (known) return known
  let id: string | null = null
  if (quiet) {
    const { data, error } = await supabase.rpc('open_dm', { p_other: userId })
    if (error || !data) return null
    id = data as string
  } else id = await rpc<string>('open_dm', { p_other: userId })
  if (!id) return null
  await loadStructure()
  return id
}
export async function openDm(userId: string) {
  const id = await dmWith(userId)
  if (!id) return
  set({ modal: null })
  navigate({ serverId: null, channelId: id })
}

export const inviteUrl = (code: string) => `${location.origin}${location.pathname}#/invite/${code}`
export type InviteResult = 'sent' | 'member' | 'blocked' | 'error'
/** Manda o convite do servidor no privado da pessoa (aparece como cartão com botão de entrar). */
export async function inviteToServer(serverId: string, userId: string): Promise<InviteResult> {
  const server = get().servers.find((x) => x.id === serverId)
  if (!server) return 'error'
  if (!get().members[serverId]) await loadMembers(serverId)
  if (get().members[serverId]?.some((m) => m.user_id === userId)) return 'member'
  const ch = await dmWith(userId, true)
  if (!ch) return 'blocked'
  const ok = await sendMessage(ch, `Bora pro **${server.name}**? Entra por aqui: ${inviteUrl(server.invite_code)}`)
  return ok ? 'sent' : 'error'
}
export async function createGroup(userIds: string[], name: string) {
  const id = await rpc<string>('create_group_dm', { p_users: userIds, p_name: name })
  if (!id) return false
  await loadStructure()
  navigate({ serverId: null, channelId: id })
  return true
}
export async function leaveGroup(channelId: string) {
  const { error } = await supabase.from('dm_members').delete().match({ channel_id: channelId, user_id: get().userId })
  if (error) return toast(errorText(error), 'error')
  if (get().nav.channelId === channelId) navigate({ serverId: null, channelId: null })
  await loadStructure()
}

// ============================================================ tempo real
let dbChannel: RealtimeChannel | null = null
let presenceChannel: RealtimeChannel | null = null
let roomChannel: RealtimeChannel | null = null
let roomId: string | null = null
let everSubscribed = false

type Change = { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Record<string, unknown>; old: Record<string, unknown> }

async function startRealtime() {
  const uid = get().userId
  if (!uid || dbChannel) return
  const db = await openRealtime('krata-db')
  const presence = await openRealtime('krata-presence', { config: { presence: { key: uid } } })
  if (get().userId !== uid || dbChannel) { void dropChannel(db); void dropChannel(presence); return }
  dbChannel = db
  const on = (table: string, fn: (p: Change) => void) =>
    db.on('postgres_changes' as never, { event: '*', schema: 'public', table } as never, fn as never)
  on('messages', onMessageChange)
  on('reactions', onReactionChange)
  on('profiles', (p) => {
    if (p.eventType !== 'UPDATE') return
    const prof = p.new as unknown as Profile
    set((s) => (s.profiles[prof.id] ? { profiles: { ...s.profiles, [prof.id]: prof }, me: prof.id === s.userId ? prof : s.me } : s))
  })
  // Eventos de exclusão chegam para todo mundo (o Supabase não aplica RLS neles):
  // só reage ao que pertence a este usuário.
  on('server_members', (p) => {
    const row = (p.eventType === 'DELETE' ? p.old : p.new) as unknown as Member
    const s = get()
    if (row.user_id === s.userId) return refreshStructureSoon()
    if (!s.servers.some((x) => x.id === row.server_id)) return
    if (s.members[row.server_id]) void loadMembers(row.server_id)
  })
  on('servers', (p) => {
    if (p.eventType === 'DELETE' && !get().servers.some((x) => x.id === p.old.id)) return
    refreshStructureSoon()
  })
  on('channels', (p) => {
    const s = get()
    if (p.eventType === 'UPDATE' && s.channels.some((c) => c.id === p.new.id)) {
      // a cada mensagem o canal só muda a data da última mensagem: atualiza aqui sem recarregar tudo
      const row = p.new as unknown as Channel
      set((st) => ({ channels: st.channels.map((c) => (c.id === row.id ? { ...c, ...row } : c)) }))
      return
    }
    if (p.eventType === 'DELETE' && !s.channels.some((c) => c.id === p.old.id)) return
    refreshStructureSoon()
  })
  on('dm_members', (p) => {
    const row = (p.eventType === 'DELETE' ? p.old : p.new) as unknown as DmMember
    if (p.eventType === 'DELETE' && !get().channels.some((c) => c.id === row.channel_id)) return
    refreshStructureSoon()
  })
  on('friendships', (p) => {
    if (p.eventType === 'DELETE' && !get().friends.some((f) => f.id === p.old.id)) return
    refreshStructureSoon()
  })
  on('emojis', (p) => {
    if (p.eventType === 'DELETE' && !get().emojis[p.old.id as string]) return
    refreshStructureSoon()
  })
  db.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      if (everSubscribed) void resync()
      everSubscribed = true
      set({ connection: 'ok' })
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (get().userId) set({ connection: 'reconnecting' })
    }
  })

  presenceChannel = presence
  presence.on('presence', { event: 'sync' }, () => {
    const state = presence.presenceState() as Record<string, { status?: Status; call?: boolean }[]>
    const online: Record<string, { status: Status; voice: boolean }> = {}
    for (const [id, metas] of Object.entries(state)) {
      const best = metas.find((m) => m.status && m.status !== 'invisible')
      if (best?.status) online[id] = { status: best.status, voice: metas.some((m) => m.call) }
    }
    set({ online })
  })
  presence.subscribe((status) => { if (status === 'SUBSCRIBED') void trackPresence() })
  startUserChannel(uid)
  joinRoom(get().nav.channelId)
}

async function stopRealtime() {
  everSubscribed = false
  roomToken++
  dbChannel = presenceChannel = roomChannel = null
  roomId = null
  await supabase.removeAllChannels().catch(() => {})
}

export async function trackPresence(voice?: string | null) {
  const me = get().me
  if (voice !== undefined) inCall = !!voice
  if (!presenceChannel || !me) return
  try {
    // invisível: não aparece na lista de quem está online
    if (me.status === 'invisible') await presenceChannel.untrack()
    else await presenceChannel.track({ status: me.status, call: inCall })
  } catch { /* reconectando */ }
}
let inCall = false

/** Depois de reconectar, busca o que pode ter sido perdido. */
async function resync() {
  if (!get().userId) return
  await loadStructure()
  const { serverId, channelId } = get().nav
  if (serverId) void loadMembers(serverId)
  if (channelId) void loadMessages(channelId)
  // listas de outros canais são descartadas para recarregar quando forem abertas
  set((s) => ({ messages: pick(s.messages, (k) => k === channelId) }))
}

function onMessageChange(p: Change) {
  const s = get()
  if (p.eventType === 'DELETE') {
    const id = p.old.id as string
    for (const [cid, l] of Object.entries(s.messages)) if (l.items.some((m) => m.id === id)) patchList(cid, (items) => items.filter((m) => m.id !== id))
    return
  }
  const m = normalize(p.new)
  if (p.eventType === 'UPDATE') return patchMessage(m.id, (x) => ({ ...m, reactions: x.reactions }))
  const list = s.messages[m.channel_id]
  if (list?.items.some((x) => x.id === m.id)) return patchMessage(m.id, (x) => ({ ...m, reactions: x.reactions }))
  void ensureProfiles([m.author_id]).then(() => notify(m))
  if (list?.loaded) { patchList(m.channel_id, (items) => [...items, m]); void loadReplies([m]) }
  set((st) => ({
    channels: st.channels.map((c) => (c.id === m.channel_id ? { ...c, last_message_at: m.created_at } : c)),
    typing: st.typing[m.channel_id]?.[m.author_id] ? { ...st.typing, [m.channel_id]: pick(st.typing[m.channel_id], (k) => k !== m.author_id) } : st.typing,
  }))
  if (m.author_id === s.userId) return
  const viewing = s.nav.channelId === m.channel_id && document.visibilityState === 'visible' && appVisible() && (document.hasFocus() || !!window.KrataNative)
  if (viewing) void markRead(m.channel_id)
  else set((st) => ({ unread: { ...st.unread, [m.channel_id]: (st.unread[m.channel_id] || 0) + 1 } }))
}

async function notify(m: Message) {
  let s = get()
  if (m.author_id === s.userId || s.me?.status === 'dnd') return
  let channel = s.channels.find((c) => c.id === m.channel_id)
  if (!channel) {
    // conversa nova (alguém puxou papo agora): carrega e avisa mesmo assim
    await loadStructure()
    s = get()
    channel = s.channels.find((c) => c.id === m.channel_id)
    if (!channel) return
    await ensureProfiles(s.dmMembers.filter((d) => d.channel_id === m.channel_id).map((d) => d.user_id))
    s = get()
  }
  const mentioned = !!s.me && new RegExp(`(^|\\s)@(${s.me.username.replace(/\./g, '\\.')}|todos)(?![a-z0-9_.])`, 'i').test(m.content)
  // responder uma mensagem sua também conta como menção (igual ao Discord)
  const repliedToMe = !!m.reply_to && Object.values(s.messages).some((l) => l.items.some((x) => x.id === m.reply_to && x.author_id === s.userId))
  if (channel.server_id && !mentioned && !repliedToMe) return
  if (window.KrataNative?.notify) {
    // app Android: notificação do sistema (com foto, nome e resposta rápida)
    if (s.nav.channelId === m.channel_id && appVisible()) return
    const server = s.servers.find((x) => x.id === channel.server_id)
    const members = channel.server_id ? 0 : s.dmMembers.filter((d) => d.channel_id === channel.id).length
    if (nativeNotify(m, channel, s.profiles[m.author_id], { title: channel.server_id ? channel.name : channelTitle(s, channel), serverName: server?.name, serverIcon: server?.icon_url, members })) return
  }
  const focused = document.visibilityState === 'visible' && document.hasFocus()
  const viewing = s.nav.channelId === m.channel_id && focused
  if (viewing) return
  if (localStorage.getItem('krata-sounds') !== 'off') sounds.message()
  // computador: com o Web Push ligado, o aviso vem do servidor (funciona até com a aba fechada);
  // sem ele, o próprio site avisa quando a janela não está em foco
  if (desktopOn() && !focused && !pushActive()) {
    const author = s.profiles[m.author_id]
    const server = s.servers.find((x) => x.id === channel.server_id)
    const who = author?.display_name || 'Alguém'
    const title = channel.server_id ? `${who} (#${channel.name}, ${server?.name || 'servidor'})` : channel.kind === 'group' ? `${who} · ${channelTitle(s, channel)}` : who
    const img = m.attachments.find((a) => a.type.startsWith('image/') && a.url.startsWith('https://'))?.url || null
    void showLocal({ t: title, b: pushPreview(m.content, m.attachments), who, au: author?.avatar_url || null, ac: author?.accent_color || '#00A86B', ch: channel.id, sv: channel.server_id, id: m.id, ts: Date.parse(m.created_at) || Date.now(), img, k: channel.server_id ? (repliedToMe && !mentioned ? 'reply' : 'mention') : channel.kind })
  }
}

function onReactionChange(p: Change) {
  const row = (p.eventType === 'DELETE' ? p.old : p.new) as { message_id: string; user_id: string; emoji: string }
  if (!row.message_id || !row.emoji) return
  patchMessage(row.message_id, (m) => {
    const rest = m.reactions.filter((r) => !(r.user_id === row.user_id && r.emoji === row.emoji))
    return { ...m, reactions: p.eventType === 'DELETE' ? rest : [...rest, { emoji: row.emoji, user_id: row.user_id }] }
  })
}

// ---- "digitando…" no canal aberto
let roomToken = 0
function joinRoom(channelId: string | null) {
  if (roomId === channelId) return
  const old = roomChannel
  roomChannel = null
  roomId = channelId
  const token = ++roomToken
  void dropChannel(old)
  if (!channelId || !get().userId) return
  void openRealtime(`krata-room-${channelId}`).then((ch) => {
    if (token !== roomToken) { void dropChannel(ch); return }
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const uid = (payload as { user_id?: string }).user_id
      if (!uid || uid === get().userId) return
      void ensureProfiles([uid])
      set((s) => ({ typing: { ...s.typing, [channelId]: { ...s.typing[channelId], [uid]: Date.now() } } }))
    })
    ch.subscribe()
    roomChannel = ch
  })
}
let lastTyping = 0
export function sendTyping() {
  if (!roomChannel || roomChannel.state !== 'joined' || Date.now() - lastTyping < 3000) return
  lastTyping = Date.now()
  void roomChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: get().userId } })
}
export function clearStaleTyping() {
  const now = Date.now()
  const t = get().typing
  let changed = false
  const next: typeof t = {}
  for (const [cid, users] of Object.entries(t)) {
    const alive = pick(users, (k) => now - users[k] < 6000)
    if (Object.keys(alive).length !== Object.keys(users).length) changed = true
    if (Object.keys(alive).length) next[cid] = alive
  }
  if (changed) set({ typing: next })
}

export { channelTitle }
