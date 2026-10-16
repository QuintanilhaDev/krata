// O "cérebro executivo" da Prisma: recebe o pedido (voz ou texto), entende, executa no app
// com animação e responde. Comandos são resolvidos pelo cérebro local; conversa livre e
// pedidos que ele não entendeu vão para a IA da Groq — e o que a Groq resolve vira exemplo
// para o cérebro local aprender.
import { searchGifs, gifUrl } from '../lib/gifs'
import { setMotion } from '../lib/motion'
import { supabase } from '../lib/supabase'
import type { Channel, Message, Profile } from '../lib/types'
import {
  acceptFriend, byPosition, createGroup, createServer, deleteChannel, deleteMessage, deleteServer, editMessage, inviteToServer, joinServer, kickMember, leaveServer,
  loadMembers, navigate, openDm, regenerateInvite, removeFriend, saveChannel, sendFriendRequest, sendMessage, setMemberRole, setPinned, signOut,
  toggleReaction, updateProfile, updateServer, usernameAvailable,
} from '../store/actions'
import { channelTitle, friendIds, get, openModal, presenceOf, set as setApp, toast } from '../store/app'
import { canShareScreen, joinVoice, leaveVoice, stopScreen, toggleCamera, toggleDeafen, toggleMute, useVoice } from '../voice/engine'
import { Brain, extractSlots, findEntity, fold, type Slots, type World } from './brain'
import { INTENTS, type Intent } from './dataset'
import { celebrate, goHome, shake, showOff, visit } from './fairy'
import { STATUS_LABEL, say, welcome, type Who } from './persona'
import { clearChat, pget, pset, pushChat } from './store'
import { attend, initVoice, isIOS, setListening, speak, stopSpeaking } from './voice'

const brain = new Brain()
let training: Promise<void> | null = null
let queue: Promise<unknown> = Promise.resolve()
let lastSaid = ''
/** Quando a Prisma foi chamada num canal, o que ela fala também vai escrito lá. */
let capture: string[] | null = null
type Pending =
  | { kind: 'slot'; intent: Intent; slots: Slots; need: 'name' | 'text' | 'user'; raw: string }
  | { kind: 'confirm'; run: () => Promise<string>; learn?: { text: string; intent: Intent } }
let pending: Pending | null = null

const me = (): Profile => get().me!
const who = (): Who => ({ name: me()?.display_name || '', pronoun: me()?.pronoun })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ início
export async function initPrisma() {
  initVoice((text) => {
    if (!text) { pset({ mood: 'listening' }); void respond(say.heard(), 'voice'); return }
    void handle(text, 'voice')
  })
  void refreshStatus()
  if (!pget().ready) {
    pset({ ready: true })
    training = (async () => {
      let shared: { text: string; intent: Intent }[] = []
      try {
        const { data } = await supabase.from('prisma_examples').select('text,intent').order('hits', { ascending: false }).limit(1500)
        shared = ((data as { text: string; intent: string }[] | null) || []).filter((x) => (INTENTS as readonly string[]).includes(x.intent)) as { text: string; intent: Intent }[]
      } catch { /* tabela ainda não criada */ }
      let local: { text: string; intent: Intent }[] = []
      try { local = JSON.parse(localStorage.getItem('krata-prisma-memory') || '[]') } catch { /* vazio */ }
      brain.load([...shared.slice(0, 600), ...local])
      if (!(await trainInWorker(shared))) await brain.train(shared)
    })()
  }
  // boas-vindas logo depois do cadastro
  let fresh: string | null = null
  try { fresh = sessionStorage.getItem('krata-welcome'); sessionStorage.removeItem('krata-welcome') } catch { /* sem armazenamento */ }
  if (fresh) setTimeout(() => void greetNewUser(fresh === 'ela' || fresh === 'ele' ? fresh : null), 1400)
}

/** Treina num Worker; se o navegador não deixar, volta falso e treina na página mesmo. */
function trainInWorker(extra: { text: string; intent: Intent }[]): Promise<boolean> {
  return new Promise((resolve) => {
    let worker: Worker
    try { worker = new Worker(new URL('./train.worker.ts', import.meta.url), { type: 'module' }) } catch { return resolve(false) }
    const timer = setTimeout(() => { worker.terminate(); resolve(false) }, 20000)
    worker.onmessage = (e: MessageEvent<{ W: Float32Array<ArrayBuffer>; b: Float32Array<ArrayBuffer>; idf: Float32Array<ArrayBuffer> }>) => { clearTimeout(timer); worker.terminate(); resolve(brain.adopt(e.data)) }
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); resolve(false) }
    worker.postMessage({ extra })
  })
}

/** Saiu da conta: para de ouvir e esquece a conversa deste aparelho. */
export function stopPrisma() {
  setListening(false, false)
  stopSpeaking()
  pending = null
  clearChat()
  pset({ panel: null, chatOpen: false, bubble: null, mood: 'idle', out: false })
}

export function cancelPending() { pending = null }

export function forgetLearning() {
  try { localStorage.removeItem('krata-prisma-memory') } catch { /* sem armazenamento */ }
  brain.forget()
  clearChat()
}

export async function refreshStatus() {
  try {
    const { data } = await supabase.auth.getSession()
    const r = await fetch('/api/prisma', { headers: { authorization: `Bearer ${data.session?.access_token || ''}` } })
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) pset({ server: await r.json() })
    else pset({ server: { groq: false, stt: false, tts: false, channelBot: false, used: 0, limit: 0 } })
  } catch { pset({ server: { groq: false, stt: false, tts: false, channelBot: false, used: 0, limit: 0 } }) }
}

async function greetNewUser(pronoun: 'ele' | 'ela' | null) {
  const text = welcome({ ...who(), pronoun: me()?.pronoun || pronoun })
  void showOff(3200)
  await respond(text, 'voice')
}

function remember(text: string, intent: Intent) {
  brain.learn(text, intent)
  try { localStorage.setItem('krata-prisma-memory', JSON.stringify(brain.memories().slice(-400))) } catch { /* cheio */ }
}

// ------------------------------------------------------------------ fala
async function respond(text: string, origin: 'voice' | 'text') {
  if (!text) return
  capture?.push(text)
  lastSaid = text
  pushChat('assistant', text)
  if (pget().captions || origin === 'text') pset({ bubble: text })
  const hide = setTimeout(() => { if (pget().bubble === text) pset({ bubble: null }) }, Math.max(3500, text.length * 70))
  if (origin === 'voice') {
    await speak(text, () => document.documentElement.style.setProperty('--prisma-pulse', String(Math.random())))
    if (pending || /\?\s*$/.test(text)) attend(9000)
  } else void hide
}

// ------------------------------------------------------------------ mundo (o que existe agora no app)
export function world(): World {
  const s = get()
  const ids = new Set<string>([...friendIds(s), ...(s.nav.serverId ? (s.members[s.nav.serverId] || []).map((m) => m.user_id) : []), ...s.dmMembers.map((m) => m.user_id)])
  ids.delete(s.userId || '')
  return {
    servers: s.servers.map((x) => ({ id: x.id, name: x.name })),
    channels: s.channels.map((c) => ({ id: c.id, name: c.name, serverId: c.server_id, kind: c.kind })),
    users: [...ids].map((id) => s.profiles[id]).filter(Boolean).map((p) => ({ id: p.id, username: p.username, display: p.display_name })),
    currentServerId: s.nav.serverId, currentChannelId: s.nav.channelId,
  }
}

function contextText(): string {
  const s = get()
  const now = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date())
  const server = s.servers.find((x) => x.id === s.nav.serverId)
  const channel = s.channels.find((c) => c.id === s.nav.channelId)
  const v = useVoice.getState()
  const lines = [
    `Agora: ${now} (Brasília). Usuário: ${me().display_name} (@${me().username}${me().pronoun ? `, ${me().pronoun}` : ''}).`,
    `Onde está: ${server ? `servidor "${server.name}"` : 'início'}${channel ? ` > ${channel.server_id ? '#' : 'conversa com '}${channelTitle(s, channel)}` : ''}. Na call: ${v.channelId ? 'sim' : 'não'}${v.muted ? ', mutado' : ''}${v.screen ? ', transmitindo a tela' : ''}.`,
    `Cargo aqui: ${server ? s.roles[server.id] || 'membro' : '-'}.`,
    `Servidores: ${s.servers.map((x) => x.name).join('; ') || 'nenhum'}.`,
  ]
  if (server) lines.push(`Canais deste servidor: ${s.channels.filter((c) => c.server_id === server.id).sort(byPosition).map((c) => (c.kind === 'voice' ? `(voz) ${c.name}` : `#${c.name}`)).join(', ')}.`)
  const friends = friendIds(s).map((id) => s.profiles[id]).filter(Boolean).slice(0, 40)
  lines.push(`Amigos: ${friends.map((p) => `${p.display_name} (@${p.username}, ${presenceOf(s, p.id) === 'offline' ? 'off' : 'on'})`).join(', ') || 'nenhum'}.`)
  return lines.join('\n')
}

// ------------------------------------------------------------------ pedidos
export function handle(text: string, origin: 'voice' | 'text' = 'text'): Promise<void> {
  const run = queue.then(() => handleNow(text.trim(), origin)).catch((e) => { console.error('[prisma]', e); shake(); void respond(say.netError(), origin) })
  queue = run
  return run
}
/** Executa um pedido e devolve tudo o que ela respondeu (para escrever no canal). */
function handleCaptured(text: string): Promise<string> {
  const run = queue.then(async () => {
    capture = []
    try { await handleNow(text.trim(), 'text') } catch (e) { console.error('[prisma]', e); shake(); await respond(say.netError(), 'text') }
    const out = capture.join(' ').trim()
    capture = null
    return out
  })
  queue = run.catch(() => {})
  return run
}

async function handleNow(text: string, origin: 'voice' | 'text') {
  if (!text) return
  if (!get().me) return
  pushChat('user', text)
  pset({ mood: 'thinking', bubble: null })
  if (training) await training
  try {
    // 1) respondendo a uma pergunta dela?
    if (pending) {
      const p = pending
      const quick = brain.classify(text)
      if (quick.intent === 'cancel' && quick.confidence > 0.5) { pending = null; return void (await respond(say.cancel(), origin)) }
      if (p.kind === 'confirm') {
        const yes = /^(sim|pode|claro|isso|confirma|manda|bora|aham|yes|uhum|com certeza|pode sim|faz)/i.test(text) || (quick.intent === 'affirm' && quick.confidence > 0.4)
        const no = /^(nao|não|nem|negativo|melhor nao|melhor não|no)\b/i.test(text) || (quick.intent === 'deny' && quick.confidence > 0.4)
        if (yes || no) {
          pending = null
          if (no) return void (await respond(say.cancel(), origin))
          if (p.learn) remember(p.learn.text, p.learn.intent)
          return void (await respond(await p.run(), origin))
        }
        pending = null // falou outra coisa: trata como pedido novo
      } else {
        pending = null
        const slots = { ...p.slots }
        if (p.need === 'name') slots.name = text.replace(/^(o nome (e|é)|chama|coloca|bota)\s+/i, '').slice(0, 60)
        if (p.need === 'text') slots.text = text
        if (p.need === 'user') {
          const hit = findEntity(text, world().users, (u) => [u.display, u.username, u.display.split(' ')[0]], 0.82)
          if (hit) slots.userId = hit.item.id
          else slots.username = text.replace(/^@/, '').toLowerCase().replace(/\s*ponto\s*/g, '.').replace(/\s+/g, '')
        }
        return void (await respond(await act(p.intent, slots, p.raw), origin))
      }
    }

    // 2) pedidos inconfundíveis vão direto (nomes desconhecidos às vezes confundem o cérebro)
    const rule = ruleIntent(text)
    if (rule) return void (await respond(await act(rule, extractSlots(rule, text, world()), text), origin))

    // 3) cérebro local
    const r = brain.classify(text)
    const strong = r.source === 'memory' || (r.confidence >= 0.45 && r.margin >= 0.15)
    const cloud = pget().server?.groq
    if (strong && r.intent !== 'chat') {
      const slots = extractSlots(r.intent, text, world())
      // veio de um exemplo aprendido sem o dado essencial: a nuvem completa melhor (ou pergunta do jeito dela)
      if (!(cloud && r.source === 'memory' && missing(r.intent, slots))) return void (await respond(await act(r.intent, slots, text), origin))
    }

    // 3) IA da nuvem
    if (cloud) {
      const out = await askCloud(text)
      if (out === 'limit' || out === 'error') {
        if (strong || r.confidence >= 0.3) return void (await respond(await act(r.intent, extractSlots(r.intent, text, world()), text), origin))
        return void (await respond(out === 'limit' ? say.limit() : say.netError(), origin))
      }
      if (out.say) void respond(out.say, origin)
      const results: string[] = []
      for (const a of out.actions) {
        const intent = String(a.type) as Intent
        const slots = slotsFromCloud(a)
        const phrase = await act(intent, slots, text, { quiet: !!out.say })
        if (phrase) results.push(phrase)
      }
      if (out.actions.length === 1) remember(text, String(out.actions[0].type) as Intent)
      // com a fala da IA, sucesso fica quieto (""), mas erros ("!..."), perguntas e respostas (quem tá on, não lidas…) sempre aparecem
      if (results.length) await respond(results.map((x) => (x.startsWith('!') ? x.slice(1) : x)).join(' '), origin)
      return
    }

    // 4) sem nuvem: chuta com confirmação, ou admite que não entendeu
    if (r.intent !== 'chat' && r.confidence >= 0.2) {
      const slots = extractSlots(r.intent, text, world())
      pending = { kind: 'confirm', run: () => act(r.intent, slots, text), learn: { text, intent: r.intent } }
      return void (await respond(say.confirmQuestion(describe(r.intent)), origin))
    }
    await respond(r.intent === 'chat' ? say.offline() : say.notUnderstood(), origin)
  } finally {
    if (pget().mood === 'thinking') pset({ mood: 'idle' })
  }
}

/** Regras para pedidos que não podem falhar por causa de nomes estranhos ("convida ely, sirkaiju…"). */
export function ruleIntent(text: string): Intent | null {
  const f = fold(text).replace(/\bpri[sz]ma\b[,:]?/g, ' ')
  if (/\b(link|codigo|regenera|novo convite|outro convite)\b/.test(f)) return null
  if (/\bconvid(a|e|ar|em)\b/.test(f)) return 'invite_users'
  if (/\b(manda|envia|mande|envie)(r)?\s+(o |um )?convite\s+(do servidor |do server )?(pro|pra|para|ao|a|pros|pras)\b/.test(f)) return 'invite_users'
  if (/\b(canal|emoji|cargo|icone|foto|sala|chamad|se chama|chama de|nome)\b/.test(f)) return null
  if (/\b(chama|traz|traga|bota|coloca|adiciona|add)\s+(o |a |os |as )?@?[a-z0-9_.]{2,}.*\b(pro|pra|para o|para|no|na|nesse|neste|ao|aqui no)\s+((esse|este|o|meu|nosso)\s+)?(servidor|server)\b/.test(f)) return 'invite_users'
  return null
}

/** O pedido local veio sem o dado que a ação precisa? */
function missing(intent: Intent, s: Slots): boolean {
  switch (intent) {
    case 'create_server': case 'create_channel': case 'rename_server': case 'rename_channel': case 'set_display_name': return !s.name
    case 'send_gif': return false
    case 'send_message': case 'set_bio': case 'set_custom_status': case 'edit_last': case 'set_topic': return !s.text
    case 'friend_request': case 'open_dm': return !s.userId && !s.username
    case 'call_user': case 'remove_friend': case 'kick_member': case 'promote_member': case 'demote_member': return !s.userId
    case 'set_color': return !s.color
    default: return false
  }
}

async function askCloud(text: string): Promise<{ say: string; actions: Record<string, unknown>[] } | 'limit' | 'error'> {
  try {
    const { data } = await supabase.auth.getSession()
    const history = pget().chat.slice(-7, -1).map((t) => ({ role: t.role, content: t.content }))
    const r = await fetch('/api/prisma', {
      method: 'POST',
      headers: { authorization: `Bearer ${data.session?.access_token || ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'chat', text, history, context: contextText() }),
    })
    const d = (await r.json().catch(() => ({}))) as { say?: string; actions?: Record<string, unknown>[]; error?: string; used?: number; limit?: number }
    if (r.status === 429) { pset((s) => ({ server: s.server ? { ...s.server, used: s.server.limit } : s.server })); return 'limit' }
    if (!r.ok) return 'error'
    if (typeof d.used === 'number') pset((s) => ({ server: s.server ? { ...s.server, used: d.used!, limit: d.limit ?? s.server.limit } : s.server }))
    return { say: d.say || '', actions: Array.isArray(d.actions) ? d.actions : [] }
  } catch { return 'error' }
}

/** Converte os nomes que a IA devolve em ids do app. */
function slotsFromCloud(a: Record<string, unknown>): Slots {
  const w = world()
  const s: Slots = {}
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '')
  if (str('name')) s.name = str('name').slice(0, 60)
  if (str('text')) s.text = str('text').slice(0, 2000)
  if (str('query') && !s.text) s.text = str('query').slice(0, 80)
  if (str('code')) s.code = str('code').split('/').pop()
  if (str('server')) { const hit = w.servers.find((x) => x.name.toLowerCase() === str('server').toLowerCase()) || findEntity(str('server'), w.servers, (x) => [x.name], 0.8)?.item; if (hit) s.serverId = hit.id }
  if (str('channel')) {
    const name = str('channel').replace(/^#/, '').toLowerCase()
    const list = w.channels.filter((c) => c.serverId)
    const hit = list.find((c) => c.name.toLowerCase() === name && c.serverId === w.currentServerId) || list.find((c) => c.name.toLowerCase() === name) || findEntity(name, list, (c) => [c.name], 0.82)?.item
    if (hit) s.channelId = hit.id
  }
  const findUser = (v: string) => {
    const u = v.replace(/^@/, '').toLowerCase()
    return w.users.find((x) => x.username === u) || w.users.find((x) => x.display.toLowerCase() === u) || findEntity(v, w.users, (x) => [x.display, x.username], 0.86)?.item
  }
  if (str('user')) { const hit = findUser(str('user')); if (hit) s.userId = hit.id; else s.username = str('user').replace(/^@/, '').toLowerCase() }
  if (Array.isArray(a.users)) {
    const list = (a.users as unknown[]).map((v) => String(v).trim()).filter(Boolean).slice(0, 10)
    s.userIds = list.map((v) => findUser(v)?.id).filter((x): x is string => !!x)
    // quem não está no contexto (ainda não é amigo) a gente procura pelo @ ou pelo nome
    const rest = list.filter((v) => !findUser(v)).map((v) => v.replace(/^@/, '').toLowerCase().replace(/\s+/g, ''))
    if (rest.length) s.usernames = rest
  }
  if (['online', 'idle', 'dnd', 'invisible'].includes(str('status'))) s.status = str('status') as Slots['status']
  if (/^#[0-9a-f]{6}$/i.test(str('color'))) s.color = str('color')
  if (str('emoji')) s.emoji = str('emoji')
  if (str('kind') === 'voice' || str('kind') === 'text') s.kind = str('kind') as 'voice' | 'text'
  if (['2160', '1440', '1080', '720'].includes(str('quality'))) s.quality = str('quality') as Slots['quality']
  if (str('tab')) s.tab = str('tab')
  if (str('level') === 'full' || str('level') === 'reduced') s.level = str('level') as 'full' | 'reduced'
  return s
}

function describe(intent: Intent): string {
  const map: Partial<Record<Intent, string>> = {
    create_server: 'crie um servidor', join_server: 'entre num servidor com convite', leave_server: 'saia do servidor', delete_server: 'apague o servidor',
    create_channel: 'crie um canal', delete_channel: 'apague o canal', open_server: 'abra o servidor', open_channel: 'abra o canal', open_dm: 'abra a conversa',
    send_message: 'mande essa mensagem', friend_request: 'mande um pedido de amizade', change_avatar: 'troque tua foto de perfil', join_voice: 'entre na call',
    leave_voice: 'saia da call', mute: 'mute teu microfone', share_screen: 'compartilhe tua tela', set_status: 'mude teu status', open_settings: 'abra as configurações',
  }
  return map[intent] || intent.replace(/_/g, ' ')
}

// ------------------------------------------------------------------ execução
const sel = (key: string) => `[data-prisma="${key}"]`
const ask = (intent: Intent, slots: Slots, raw: string, need: 'name' | 'text' | 'user', question: string) => {
  pending = { kind: 'slot', intent, slots, need, raw }
  return question
}
const confirm = (question: string, run: () => Promise<string>) => {
  pending = { kind: 'confirm', run }
  return question
}
const isAdminOf = (serverId: string | null) => !!serverId && ['owner', 'admin'].includes(get().roles[serverId] || '')
const currentText = (): Channel | undefined => { const s = get(); return s.channels.find((c) => c.id === s.nav.channelId) }
function lastMessage(mine: boolean): Message | undefined {
  const s = get()
  const items = (s.nav.channelId && s.messages[s.nav.channelId]?.items) || []
  return [...items].reverse().find((m) => !m.pending && !m.failed && (!mine || m.author_id === s.userId) && !m.bot)
}
async function resolveUsername(slots: Slots): Promise<string | null> {
  if (slots.userId) return get().profiles[slots.userId]?.username || null
  if (!slots.username) return null
  const base = slots.username.replace(/^@/, '')
  const variants = [...new Set([base, base.replace(/\s+/g, ''), base.replace(/\s+/g, '.'), base.replace(/\s+/g, '_')])].filter((v) => /^[a-z0-9_.]{3,20}$/.test(v))
  for (const v of variants) { const free = await usernameAvailable(v); if (free === false) return v }
  return variants[0] || null
}
const seenNames = new Map<string, string>()
const nameOf = (id?: string) => (id ? get().profiles[id]?.display_name || seenNames.get(id) : '') || 'essa pessoa'
const listNames = (names: string[]) => (names.length <= 1 ? names[0] || '' : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`)

/** Acha pessoas pelo @usuário ou pelo nome de exibição (amigos primeiro). */
async function findPeople(names: string[]): Promise<{ found: string[]; missing: string[]; ambiguous: string[] }> {
  const found: string[] = [], missing: string[] = [], ambiguous: string[] = []
  const s = get()
  const friends = new Set(friendIds(s))
  const known = Object.values(s.profiles)
  for (const raw of names.slice(0, 10)) {
    const n = raw.toLowerCase().replace(/^@/, '')
    if (!/^[a-z0-9_.]{2,20}$/.test(n)) { missing.push(raw); continue }
    const local = known.filter((p) => p.username === n).concat(known.filter((p) => p.username !== n && p.display_name.toLowerCase().replace(/\s+/g, '') === n))
    let pick = local.find((p) => p.username === n) || local.find((p) => friends.has(p.id))
    if (!pick) {
      const { data } = await supabase.from('profiles').select('id,username,display_name').or(`username.eq.${n},display_name.ilike.${n}`).limit(5)
      const rows = (data as Pick<Profile, 'id' | 'username' | 'display_name'>[] | null) || []
      const exact = rows.find((r) => r.username === n)
      const byName = rows.filter((r) => r.username !== n)
      const chosen = exact || byName.find((r) => friends.has(r.id)) || (byName.length === 1 ? byName[0] : undefined)
      if (chosen) {
        seenNames.set(chosen.id, chosen.display_name)
        pick = chosen as Profile
      } else if (byName.length > 1) { ambiguous.push(raw); continue }
    }
    if (pick) found.push(pick.id)
    else missing.push(raw)
  }
  return { found, missing, ambiguous }
}

/**
 * Executa um pedido. Devolve a frase que ela fala.
 * Com `quiet` (a IA já falou), só devolve frase quando algo deu errado (prefixo "!").
 */

const pickOne = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
/** "prisma manda um gif do bolsonaro aqui" → "bolsonaro" */
function gifQuery(text: string): string {
  const t = text.replace(/@prisma\b/gi, ' ')
  const m = /\bgifs?\b\s*(?:engra[cç]ad[oa]\s+)?(?:de|do|da|dos|das|com|sobre)?\s+(.+)$/i.exec(t)
  const q = (m ? m[1] : '').replace(/\b(aqui|a[ií]|nesse grupo|neste grupo|nesse canal|no chat|pfv|por favor|pra mim|pra gente)\b/gi, ' ').replace(/[?!.]+$/g, '').replace(/\s+/g, ' ').trim()
  return q || (/\bengra[cç]ad/i.test(t) ? 'engraçado' : '')
}

export async function act(intent: Intent, slots: Slots, raw: string, opts: { quiet?: boolean } = {}): Promise<string> {
  const s = get()
  const fail = (t: string) => (opts.quiet ? `!${t}` : t)
  const done = (t: string) => (opts.quiet ? '' : t)
  const serverId = slots.serverId || s.nav.serverId
  const server = s.servers.find((x) => x.id === serverId)
  const v = useVoice.getState()

  switch (intent) {
    case 'greet': return say.greet(who())
    case 'thanks': return say.thanks()
    case 'how_are_you': return say.howAreYou(who())
    case 'who_are_you': return say.whoAmI()
    case 'help': return say.help()
    case 'time_now': return say.time()
    case 'repeat': return lastSaid || say.heard()
    case 'cancel': case 'deny': pending = null; return say.cancel()
    case 'affirm': return say.ok()
    case 'chat': return say.offline()
    case 'stop_listening': {
      setListening(false)
      return say.stopListening()
    }

    // ---------------- servidores
    case 'create_server': {
      if (!slots.name) return ask(intent, slots, raw, 'name', say.askServerName())
      const name = slots.name
      const ok = await visit(sel('create-server'), () => createServer(name, null))
      if (!ok) return fail(say.netError())
      celebrate()
      return done(say.serverCreated(name))
    }
    case 'join_server': {
      if (!slots.code) { await visit(sel('join-server'), async () => openModal({ type: 'joinServer' })); return done('Cola o convite aqui.') }
      const code = slots.code
      const ok = await visit(sel('join-server'), () => joinServer(code))
      return ok ? done(say.joined(get().servers.find((x) => x.id === get().nav.serverId)?.name || 'servidor')) : fail('Esse convite não funcionou.')
    }
    case 'leave_server': {
      if (!server) return fail(say.needServer())
      if (s.roles[server.id] === 'owner') return fail('Você é o dono desse servidor: pra sair, transfere ele ou apaga.')
      return confirm(`Sair do ${server.name}?`, async () => { await visit(sel(`server-${server.id}`), () => leaveServer(server.id)); return say.left(server.name) })
    }
    case 'delete_server': {
      if (!server) return fail(say.needServer())
      if (s.roles[server.id] !== 'owner') return fail('Só o dono pode apagar o servidor.')
      pset({ panel: { kind: 'confirm', title: 'Apagar servidor', text: say.confirmDelete(server.name), action: 'Apagar servidor', danger: true, onYes: async () => { pending = null; await visit(sel(`server-${server.id}`), () => deleteServer(server.id)); void respond(say.deleted(server.name), 'voice') } } })
      return confirm(say.confirmDelete(server.name), async () => { pset({ panel: null }); await visit(sel(`server-${server.id}`), () => deleteServer(server.id)); return say.deleted(server.name) })
    }
    case 'rename_server': {
      if (!server) return fail(say.needServer())
      if (!isAdminOf(server.id)) return fail(say.noPermission())
      if (!slots.name) return ask(intent, slots, raw, 'name', 'Qual o nome novo?')
      const name = slots.name
      await visit(sel('server-menu'), () => updateServer(server.id, { name }))
      return done(`Agora o servidor se chama ${name}.`)
    }
    case 'server_icon': {
      if (!server) return fail(say.needServer())
      if (!isAdminOf(server.id)) return fail(say.noPermission())
      await visit(sel(`server-${server.id}`), async () => pset({ panel: { kind: 'upload', target: 'server_icon', title: `Ícone de ${server.name}`, serverId: server.id } }), { stay: 100 })
      return done('Escolhe a imagem do ícone aqui.')
    }
    case 'invite_link': {
      if (!server) return fail(say.needServer())
      const url = `${location.origin}${location.pathname}#/invite/${server.invite_code}`
      let copied = false
      await visit(sel('server-menu'), async () => { try { await navigator.clipboard.writeText(url); copied = true } catch { /* sem permissão */ } pset({ panel: { kind: 'link', title: `Convite de ${server.name}`, url } }) })
      return done(copied ? say.inviteCopied() : say.inviteShown())
    }
    case 'invite_users': {
      if (!server) return fail(say.needServer())
      const ids = [...(slots.userIds || []), ...(slots.userId ? [slots.userId] : [])]
      const names = [...(slots.usernames || []), ...(slots.username ? [slots.username] : [])]
      if (!ids.length && !names.length) {
        await visit(sel('server-menu'), async () => openModal({ type: 'invite', serverId: server.id }))
        return done('Escolhe aqui quem você quer chamar pro servidor.')
      }
      const { found, missing, ambiguous } = await findPeople(names)
      const targets = [...new Set([...ids, ...found])].filter((id) => id !== s.userId)
      const sent: string[] = [], already: string[] = [], blocked: string[] = [], failed: string[] = []
      await visit(sel('server-menu'), async () => {
        for (const id of targets) {
          const r = await inviteToServer(server.id, id)
          ;(r === 'sent' ? sent : r === 'member' ? already : r === 'blocked' ? blocked : failed).push(nameOf(id))
        }
      })
      const parts: string[] = []
      if (sent.length) parts.push(say.invitesSent(server.name, sent))
      if (already.length) parts.push(`${listNames(already)} já ${already.length > 1 ? 'estão' : 'está'} no servidor.`)
      if (blocked.length) parts.push(`Não consegui mandar pra ${listNames(blocked)}: vocês precisam ser amigos ou dividir um servidor. Se quiser, mando um pedido de amizade.`)
      if (failed.length) parts.push(`Deu erro ao mandar pra ${listNames(failed)}.`)
      if (missing.length) parts.push(`Não achei ninguém chamado ${listNames(missing.map((n) => `@${n}`))}.`)
      if (ambiguous.length) parts.push(`Tem mais de uma pessoa com o nome ${listNames(ambiguous)}: me fala o @ certinho.`)
      if (sent.length) celebrate()
      const text = parts.join(' ') || say.notUnderstood()
      // deu tudo certo e a IA já falou: fica quieta; se algo falhou, avisa sempre
      return sent.length && !already.length && !blocked.length && !failed.length && !missing.length && !ambiguous.length ? done(text) : fail(text)
    }
    case 'regenerate_invite': {
      if (!server || !isAdminOf(server.id)) return fail(server ? say.noPermission() : say.needServer())
      return confirm('Gerar um convite novo? O antigo para de funcionar.', async () => { await regenerateInvite(server.id); return 'Convite novo gerado. O antigo já era.' })
    }

    // ---------------- canais
    case 'create_channel': {
      if (!server) return fail(say.needServer())
      if (!isAdminOf(server.id)) return fail(say.noPermission())
      if (!slots.name) return ask(intent, slots, raw, 'name', say.askChannelName())
      const kind = slots.kind || 'text'
      const name = slots.name
      const ok = await visit(document.querySelector(sel(`create-channel-${kind}`)) || sel('server-menu'), () => saveChannel(server.id, undefined, { name, topic: '', category: '', kind }))
      return ok ? done(say.channelCreated(name, kind === 'voice')) : fail(say.netError())
    }
    case 'delete_channel': {
      const ch = s.channels.find((c) => c.id === (slots.channelId || s.nav.channelId) && c.server_id)
      if (!ch || !ch.server_id) return fail('Qual canal? Não achei.')
      if (!isAdminOf(ch.server_id)) return fail(say.noPermission())
      return confirm(`Apagar o canal ${ch.name}? Tudo nele some.`, async () => { await visit(sel(`channel-${ch.id}`), () => deleteChannel(ch)); return `Canal ${ch.name} apagado.` })
    }
    case 'rename_channel': case 'set_topic': {
      const ch = s.channels.find((c) => c.id === (slots.channelId || s.nav.channelId) && c.server_id)
      if (!ch || !ch.server_id) return fail('Abre o canal primeiro.')
      if (!isAdminOf(ch.server_id)) return fail(say.noPermission())
      if (intent === 'rename_channel' && !slots.name) return ask(intent, slots, raw, 'name', 'Qual o nome novo do canal?')
      if (intent === 'set_topic' && !slots.text) return ask(intent, slots, raw, 'text', 'Qual vai ser o assunto?')
      await visit(sel(`channel-${ch.id}`), () => saveChannel(ch.server_id!, ch, { name: intent === 'rename_channel' ? slots.name! : ch.name, topic: intent === 'set_topic' ? slots.text! : ch.topic, category: ch.category, kind: ch.kind as 'text' | 'voice' }))
      return done(say.ok())
    }

    // ---------------- navegação
    case 'open_server': {
      const target = s.servers.find((x) => x.id === slots.serverId)
      if (!target) return fail('Não achei esse servidor.')
      await visit(sel(`server-${target.id}`), async () => navigate({ serverId: target.id, channelId: null }, { keepPanel: false }))
      return done(say.opened(target.name))
    }
    case 'open_channel': {
      const ch = s.channels.find((c) => c.id === slots.channelId)
      if (!ch) return fail('Não achei esse canal.')
      if (ch.kind === 'voice') return act('join_voice', { ...slots }, raw, opts)
      await visit(sel(`channel-${ch.id}`), async () => navigate({ serverId: ch.server_id, channelId: ch.id }))
      return done(say.opened(`#${ch.name}`))
    }
    case 'open_dm': {
      const id = slots.userId || (slots.username ? Object.values(s.profiles).find((p) => p.username === slots.username)?.id : undefined)
      if (!id) return ask(intent, slots, raw, 'user', say.askUser())
      await visit(sel('home'), () => openDm(id))
      return done(say.opened(`a conversa com ${nameOf(id)}`))
    }
    case 'go_home': await visit(sel('home'), async () => navigate({ serverId: null, channelId: null }, { keepPanel: true })); return done(say.home())
    case 'open_friends': {
      await visit(sel('home'), async () => { navigate({ serverId: null, channelId: null }, { keepPanel: false }); setApp({ homeTab: (slots.tab as 'online' | 'all' | 'pending') || 'all' }) })
      return done(slots.tab === 'pending' ? 'Aqui estão teus pedidos de amizade.' : 'Abrindo teus amigos.')
    }
    case 'open_profile': {
      const id = slots.userId || (/\b(meu|minha)\b/i.test(raw) ? s.userId! : undefined)
      if (!id) return ask(intent, slots, raw, 'user', 'O perfil de quem?')
      openModal({ type: 'profile', userId: id })
      return done(say.ok())
    }

    // ---------------- mensagens
    case 'send_gif': {
      const q = (slots.text || gifQuery(raw)).trim()
      if (!q) return ask(intent, slots, raw, 'text', 'Gif de quê?')
      const found = await searchGifs(q)
      if (found === 'off') return fail('A busca de GIFs ainda não foi ligada no servidor.')
      if (found === 'error' || !found.gifs.length) return fail(`Não achei gif de "${q}".`)
      // um dos primeiros resultados (os mais certeiros), variando um pouco se pedirem de novo
      const g = found.gifs[Math.floor(Math.random() * Math.min(3, found.gifs.length))]
      const dest = slots.userId ? null : s.channels.find((c) => c.id === (slots.channelId || s.nav.channelId) && c.kind !== 'voice')
      if (slots.userId) {
        const uid = slots.userId
        await visit(sel('home'), () => openDm(uid))
        const ch = get().nav.channelId
        if (!ch) return fail(say.netError())
        await visit(sel('composer'), () => sendMessage(ch, g.url))
        return done(`Gif de ${q} no privado do ${nameOf(uid)}.`)
      }
      if (!dest) return fail('Abre um canal ou me fala onde mandar.')
      const ok = await visit(dest.id === s.nav.channelId ? sel('composer') : sel(`channel-${dest.id}`), () => sendMessage(dest.id, g.url))
      return ok ? done(pickOne([`Toma teu gif de ${q}.`, `Gif de ${q} na área.`, `Saindo um gif de ${q}.`])) : fail('Não consegui mandar.')
    }
    case 'send_message': {
      if (!slots.text) return ask(intent, slots, raw, 'text', say.askMessage())
      // "manda um gif de X" que caiu como mensagem, ou link de gif inventado: busca um gif de verdade
      const gifAsk = /^\s*(um\s+|uma\s+)?gif\b/i.test(slots.text) || (!!gifUrl(slots.text.trim()) && !raw.includes(slots.text.trim()))
      if (gifAsk) return act('send_gif', { ...slots, text: gifUrl(slots.text.trim()) ? gifQuery(raw) : gifQuery(slots.text) }, raw)
      const text = slots.text
      if (slots.userId) {
        const uid = slots.userId
        await visit(sel('home'), () => openDm(uid))
        const ch = get().nav.channelId
        if (!ch) return fail(say.netError())
        await visit(sel('composer'), () => sendMessage(ch, text))
        return done(say.sent(`privado do ${nameOf(uid)}`))
      }
      const ch = s.channels.find((c) => c.id === (slots.channelId || s.nav.channelId) && c.kind !== 'voice')
      if (!ch) return fail('Abre um canal ou me fala onde mandar.')
      const target = ch.id === s.nav.channelId ? sel('composer') : sel(`channel-${ch.id}`)
      const ok = await visit(target, () => sendMessage(ch.id, text))
      return ok ? done(say.sent(ch.server_id ? `#${ch.name}` : channelTitle(get(), ch))) : fail('Não consegui mandar.')
    }
    case 'react_last': {
      const m = lastMessage(false)
      if (!m) return fail(say.noMessage())
      await visit(document.getElementById(`msg-${m.id}`), () => toggleReaction(m, slots.emoji || '👍'))
      return done(say.reacted())
    }
    case 'pin_last': {
      const m = lastMessage(false)
      if (!m) return fail(say.noMessage())
      await visit(document.getElementById(`msg-${m.id}`), () => setPinned(m, true))
      return done(say.pinned())
    }
    case 'edit_last': {
      const m = lastMessage(true)
      if (!m) return fail(say.noMessage())
      if (!slots.text) return ask(intent, slots, raw, 'text', 'Escrevo o quê no lugar?')
      await visit(document.getElementById(`msg-${m.id}`), () => editMessage(m, slots.text!))
      return done(say.edited())
    }
    case 'delete_last': {
      const m = lastMessage(true)
      if (!m) return fail(say.noMessage())
      return confirm('Apagar tua última mensagem?', async () => { await visit(document.getElementById(`msg-${m.id}`), () => deleteMessage(m)); return 'Apagada.' })
    }
    case 'search': {
      const ch = currentText()
      if (!ch) return fail('Abre um canal pra eu procurar.')
      openModal({ type: 'search', channelId: ch.id, query: slots.text || '' })
      return done(slots.text ? say.searchOpened(slots.text) : 'O que eu procuro?')
    }
    case 'unread_summary': {
      const dms = s.channels.filter((c) => !c.server_id).reduce((n, c) => n + (s.unread[c.id] || 0), 0)
      const total = Object.values(s.unread).reduce((a, b) => a + b, 0)
      return say.unread(total, dms)
    }
    case 'summarize_channel': return summarize()

    // ---------------- amigos
    case 'friend_request': {
      const username = await resolveUsername(slots)
      if (!username) return ask(intent, slots, raw, 'user', say.askUser())
      const ok = await visit(sel('home'), () => sendFriendRequest(username))
      return ok ? done(say.friendSent(slots.userId ? nameOf(slots.userId) : `@${username}`)) : fail(`Não rolou mandar pro @${username}.`)
    }
    case 'accept_friend': case 'decline_friend': {
      const incoming = s.friends.filter((f) => f.status === 'pending' && f.addressee_id === s.userId)
      const list = slots.userId ? incoming.filter((f) => f.requester_id === slots.userId) : incoming
      if (!list.length) return fail('Não tem pedido pendente desse jeito.')
      await visit(sel('friends'), async () => { for (const f of list) await (intent === 'accept_friend' ? acceptFriend(f.id) : removeFriend(f.id)) })
      return done(intent === 'accept_friend' ? say.friendAccepted(list.length === 1 ? nameOf(list[0].requester_id) : `${list.length} pessoas`) : say.friendDeclined())
    }
    case 'remove_friend': {
      const f = s.friends.find((x) => x.status === 'accepted' && (x.requester_id === slots.userId || x.addressee_id === slots.userId))
      if (!f || !slots.userId) return ask(intent, slots, raw, 'user', 'Quem você quer tirar dos amigos?')
      return confirm(`Desfazer amizade com ${nameOf(slots.userId)}?`, async () => { await removeFriend(f.id); return say.friendRemoved(nameOf(slots.userId)) })
    }
    case 'online_friends': {
      const names = friendIds(s).filter((id) => presenceOf(s, id) !== 'offline').map((id) => s.profiles[id]?.display_name).filter(Boolean)
      return names.length ? say.online(names) : say.nobodyOnline()
    }
    case 'create_group': {
      const ids = slots.userIds || []
      if (ids.length < 2) return fail('Pra um grupo, me fala pelo menos duas pessoas.')
      const ok = await visit(sel('home'), () => createGroup(ids, slots.name || ''))
      return ok ? done('Grupo criado!') : fail('Não consegui criar o grupo.')
    }

    // ---------------- perfil
    case 'set_display_name': {
      if (!slots.name) return ask(intent, slots, raw, 'name', 'Que nome você quer?')
      const name = slots.name.slice(0, 32)
      await visit(sel('user-panel'), () => updateProfile({ display_name: name }))
      return done(say.nameChanged(name))
    }
    case 'set_bio': {
      if (!slots.text) return ask(intent, slots, raw, 'text', 'O que eu coloco na tua bio?')
      await visit(sel('user-panel'), () => updateProfile({ bio: slots.text!.slice(0, 300) }))
      return done('Bio atualizada.')
    }
    case 'set_status': {
      const st = slots.status || 'online'
      await visit(sel('user-panel'), () => updateProfile({ status: st }))
      return done(say.statusChanged(STATUS_LABEL[st]))
    }
    case 'set_custom_status': {
      if (!slots.text) return ask(intent, slots, raw, 'text', 'Qual status eu coloco?')
      await visit(sel('user-panel'), () => updateProfile({ custom_status: slots.text!.slice(0, 80) }))
      return done(`Status: ${slots.text}.`)
    }
    case 'clear_custom_status': await visit(sel('user-panel'), () => updateProfile({ custom_status: '' })); return done('Tirei teu status.')
    case 'set_color': {
      if (!slots.color) return fail('Qual cor? Tenho verde, jade, azul, roxo, rosa, vermelho, laranja, amarelo e branco.')
      await visit(sel('user-panel'), () => updateProfile({ accent_color: slots.color! }))
      return done(say.colorChanged())
    }
    case 'change_avatar': case 'change_banner': {
      await visit(sel('user-panel'), async () => pset({ panel: { kind: 'upload', target: intent === 'change_avatar' ? 'avatar' : 'banner', title: intent === 'change_avatar' ? 'Nova foto de perfil' : 'Novo banner' } }), { stay: 100 })
      return done(say.avatarPanel())
    }
    case 'remove_avatar': await visit(sel('user-panel'), () => updateProfile({ avatar_url: null })); return done('Tirei tua foto.')
    case 'whoami': return say.whoami(me().username)

    // ---------------- voz e tela
    case 'join_voice': {
      let ch = s.channels.find((c) => c.id === slots.channelId && c.kind === 'voice')
      const firstVoice = (sid: string) => s.channels.filter((c) => c.server_id === sid && c.kind === 'voice').sort(byPosition)[0]
      if (!ch && server) ch = firstVoice(server.id)
      if (!ch) {
        const dm = currentText()
        if (dm && !dm.server_id) { await visit(sel('call'), () => joinVoice(dm.id, { ring: true })); return done('Ligando!') }
        // fora de servidor: usa o primeiro servidor que tem sala de voz
        const other = s.servers.map((x) => ({ x, c: firstVoice(x.id) })).find((o) => o.c)
        if (!other) return fail('Não achei sala de voz. Quer que eu crie um canal de voz?')
        await visit(sel(`server-${other.x.id}`), async () => navigate({ serverId: other.x.id, channelId: null }, { keepPanel: true }))
        ch = other.c
      }
      const target = ch
      await visit(sel(`channel-${target.id}`), () => joinVoice(target.id))
      return done(say.joinVoice(target.name))
    }
    case 'leave_voice': if (!v.channelId) return fail(say.notInVoice()); await visit(sel('voice-leave'), () => leaveVoice()); return done(say.leaveVoice())
    case 'mute': if (!v.muted) await visit(sel('mute'), () => toggleMute()); return done(say.muted())
    case 'unmute': if (v.muted || v.deafened) await visit(sel('mute'), () => toggleMute()); return done(say.unmuted())
    case 'deafen': if (!v.deafened) await visit(sel('deafen'), async () => toggleDeafen()); return done(say.deafened())
    case 'undeafen': if (v.deafened) await visit(sel('deafen'), async () => toggleDeafen()); return done(say.undeafened())
    case 'camera_on': case 'camera_off': {
      if (!v.channelId) return fail(say.needVoice())
      if (v.camera !== (intent === 'camera_on')) await visit(sel('voice-camera'), () => toggleCamera())
      return done(intent === 'camera_on' ? say.cameraOn() : say.cameraOff())
    }
    case 'share_screen': {
      if (!canShareScreen()) return fail(say.noScreenShare(isIOS()))
      if (!v.channelId) return fail(say.needVoice())
      await visit(sel('voice-screen'), async () => pset({ panel: { kind: 'screen', quality: slots.quality } }), { stay: 100 })
      return done(say.screenPanel())
    }
    case 'stop_share': if (!v.screen) return fail('Você não tá transmitindo.'); await visit(sel('voice-screen'), async () => stopScreen()); return done(say.screenStopped())
    case 'call_user': {
      const id = slots.userId
      if (!id) return ask(intent, slots, raw, 'user', 'Ligar pra quem?')
      await visit(sel('home'), () => openDm(id))
      const ch = get().nav.channelId
      if (ch) await joinVoice(ch, { ring: true })
      return done(say.calling(nameOf(id)))
    }

    // ---------------- configurações e conta
    case 'open_settings': openModal({ type: 'settings', tab: slots.tab }); return done(say.settings())
    case 'set_animations': setMotion(slots.level || 'full'); return done(say.animations((slots.level || 'full') === 'full'))
    case 'sounds_off': case 'sounds_on': try { localStorage.setItem('krata-sounds', intent === 'sounds_on' ? 'on' : 'off') } catch { /* sem armazenamento */ } return done(say.sounds(intent === 'sounds_on'))
    case 'logout': return confirm('Quer mesmo sair da conta?', async () => { await signOut(); return 'Até mais!' })

    // ---------------- moderação
    case 'kick_member': case 'promote_member': case 'demote_member': {
      if (!server) return fail(say.needServer())
      if (!slots.userId) return ask(intent, slots, raw, 'user', 'Quem?')
      if (!get().members[server.id]) await loadMembers(server.id)
      const member = get().members[server.id]?.find((m) => m.user_id === slots.userId)
      if (!member) return fail(`${nameOf(slots.userId)} não tá nesse servidor.`)
      const role = get().roles[server.id]
      if (intent === 'kick_member') {
        if (!isAdminOf(server.id) || member.role === 'owner' || (member.role === 'admin' && role !== 'owner')) return fail(say.noPermission())
        return confirm(`Expulsar ${nameOf(slots.userId)} do ${server.name}?`, async () => { await kickMember(server.id, member.user_id); return say.kicked(nameOf(member.user_id)) })
      }
      if (role !== 'owner') return fail('Só o dono muda cargos.')
      await setMemberRole(server.id, member.user_id, intent === 'promote_member' ? 'admin' : 'member')
      return done(intent === 'promote_member' ? say.promoted(nameOf(member.user_id)) : say.demoted(nameOf(member.user_id)))
    }
    case 'add_emoji': {
      if (!server) return fail(say.needServer())
      if (!isAdminOf(server.id)) return fail(say.noPermission())
      const name = (slots.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
      pset({ panel: { kind: 'upload', target: 'emoji', title: 'Novo emoji', serverId: server.id, emojiName: name.length >= 2 ? name : '' } })
      return done(say.emojiPanel())
    }
  }
  return fail(say.notUnderstood())
}

/** Resume o canal aberto usando a IA (as mensagens viram dados, nunca comandos). */
async function summarize(): Promise<string> {
  const s = get()
  const ch = currentText()
  const items = (ch && s.messages[ch.id]?.items) || []
  if (!ch || !items.length) return say.summaryEmpty()
  if (!pget().server?.groq) return say.offline()
  const text = items.slice(-40).map((m) => `${m.bot ? 'Prisma' : s.profiles[m.author_id]?.display_name || 'alguém'}: ${m.content || '[anexo]'}`).join('\n')
  const { data } = await supabase.auth.getSession()
  const r = await fetch('/api/prisma', { method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token || ''}`, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'summary', messages: text }) })
  if (r.status === 429) return say.limit()
  const d = (await r.json().catch(() => ({}))) as { say?: string }
  return d.say || say.netError()
}

async function postToChannel(channelId: string, text: string) {
  if (!text) return
  const { data } = await supabase.auth.getSession()
  const r = await fetch('/api/prisma', {
    method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token || ''}`, 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'post', channelId, text }),
  }).catch(() => null)
  if (!r?.ok) { pset({ bubble: text }); pushChat('assistant', text) }
}

/** Alguém escreveu @prisma num canal de servidor. Pedidos ela executa de verdade e escreve no canal o
 *  resultado real; perguntas ela responde no canal. Nunca diz que fez algo que não fez. */
export async function channelMention(channelId: string, content: string) {
  const text = content.replace(/(^|\s)@prisma\b[,:]?/gi, ' ').trim()
  if (!text) return
  if (training) await training
  const st = pget().server
  const bot = !!st?.channelBot
  const r = brain.classify(text)
  const talk = ['chat', 'greet', 'thanks', 'how_are_you', 'who_are_you', 'help', 'time_now'].includes(r.intent)
  const s0 = get()
  // imagens recentes (fotos e gifs) para ela enxergar: as 3 mais novas das últimas mensagens
  const recent = (s0.messages[channelId]?.items || []).slice(-25)
  const images: string[] = []
  const tag = new Map<string, string>()
  for (const m of [...recent].reverse().slice(0, 10)) {
    const urls = [...(m.attachments || []).filter((a) => a.type?.startsWith('image/')).map((a) => a.url), ...(gifUrl(m.content?.trim()) ? [m.content.trim()] : [])]
    for (const u of urls) if (images.length < 3 && !images.includes(u)) { images.push(u); tag.set(m.id + u, `[imagem ${images.length}]`) }
  }
  // pergunta sobre imagem e "que gif é esse" vão para a IA que enxerga; gif só é pedido com verbo de pedido
  const aboutImage = images.length > 0 && /\b(imagem|foto|print|gif|meme|isso|esse|essa|ve|vê|olha|o que [ée])\b/i.test(text) && !/\b(manda|envia|posta|joga|solta|coloca|bota|quero|me d[aá])\b/i.test(text)
  const gifWithoutAsk = r.intent === 'send_gif' && !/\b(manda|envia|posta|joga|solta|coloca|bota|quero|me d[aá]|gif d[eoa])\b/i.test(text)
  // só manda as imagens quando a pergunta é sobre elas ou a própria mensagem tem imagem (gasta menos e usa o modelo de sempre)
  const own = [...recent].reverse().find((m) => m.author_id === s0.userId && !m.bot)
  const ownHasImage = !!own && ((own.attachments || []).some((a) => a.type?.startsWith('image/')) || !!gifUrl(own.content?.trim()))
  if (!aboutImage && !ownHasImage) images.length = 0
  const local = !aboutImage && !gifWithoutAsk && (!!ruleIntent(text) || (!talk && (r.source === 'memory' || (r.confidence >= 0.4 && r.margin >= 0.12))))
  // pedido que o cérebro local entende, ou sem IA na nuvem/sem chave do canal: fluxo normal, resposta real no canal
  if (local || !st?.groq || !bot) {
    if (!bot) pset({ chatOpen: true })
    const said = await handleCaptured(text)
    if (bot) await postToChannel(channelId, said)
    if (pending) pset({ chatOpen: true }) // ela perguntou algo (ex.: o nome do canal): abre o chat dela para responder
    return
  }
  const s = get()
  const history = recent.map((m) => {
    const imgs = [...(m.attachments || []).filter((a) => a.type?.startsWith('image/')).map((a) => tag.get(m.id + a.url) || '[imagem antiga]'), ...(gifUrl(m.content?.trim()) ? [tag.get(m.id + m.content.trim()) || '[gif antigo]'] : [])]
    const body = gifUrl(m.content?.trim()) ? '' : (m.content || '')
    const files = (m.attachments || []).filter((a) => !a.type?.startsWith('image/')).map((a) => `[arquivo ${a.name}]`)
    return `${m.bot ? 'Prisma' : s.profiles[m.author_id]?.display_name || 'alguém'}: ${[body.slice(0, 300), ...imgs, ...files].filter(Boolean).join(' ') || '[mensagem vazia]'}`
  }).join('\n')
  pset({ mood: 'thinking' })
  try {
    const { data } = await supabase.auth.getSession()
    const res = await fetch('/api/prisma', {
      method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token || ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'channel', channelId, text, asker: `${me().display_name} (@${me().username})`, context: contextText(), messages: history, images }),
    })
    if (res.status === 429) return toast(say.limit(), 'error')
    if (!res.ok) return toast('A Prisma não conseguiu responder no canal agora.', 'error')
    const d = (await res.json().catch(() => ({}))) as { say?: string; actions?: Record<string, unknown>[]; posted?: boolean }
    const actions = Array.isArray(d.actions) ? d.actions : []
    if (!actions.length) return // a conversa já foi escrita no canal pelo servidor
    // executa de verdade e escreve o resultado real (não o que a IA "achou" que ia acontecer)
    const results = await queue.then(async () => {
      const out: string[] = []
      for (const a of actions) out.push(await act(String(a.type) as Intent, slotsFromCloud(a), text))
      return out.filter(Boolean)
    })
    if (actions.length === 1) remember(text, String(actions[0].type) as Intent)
    await postToChannel(channelId, results.join(' ') || d.say || '')
    if (pending) pset({ chatOpen: true })
  } finally { if (pget().mood === 'thinking') pset({ mood: 'idle' }) }
}

/** Painéis da Prisma terminaram uma ação (upload, tela etc.). */
export function panelDone(text: string) {
  pset({ panel: null })
  void goHome()
  if (text) void respond(text, 'voice')
}

/** Lista de comandos para a tela de ajuda. */
export const EXAMPLES = [
  'Prisma, cria um servidor chamado Tropa', 'Prisma, quero usar uma foto de perfil nova', 'Prisma, manda "bora jogar" no geral', 'Prisma, adiciona o @beto',
  'Prisma, entra na call', 'Prisma, compartilha minha tela em 4K', 'Prisma, me muta', 'Prisma, me coloca no não perturbe', 'Prisma, resume o chat',
  'Prisma, quem tá on?', 'Prisma, liga pra Ana', 'Prisma, cria um canal de voz chamado Squad', 'Prisma, me dá o link de convite', 'Prisma, convida a Ana e o Beto pro servidor', 'Prisma, troca meu banner',
]

export { brain }
export const sleepMs = sleep
