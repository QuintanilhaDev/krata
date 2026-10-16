import {
  ArrowDown, AtSign, Copy, CornerUpLeft, Download, FileText, Hash, Menu, Paperclip, Pencil, Phone, Pin, Plus, RotateCw, Search,
  SendHorizontal, Smile, Star, Trash2, Users, Video, X,
} from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { QUICK_REACTIONS } from '../lib/emoji'
import { safeMediaUrl } from '../lib/supabase'
import { clock, dayLabel, fileSize, sameDay, stamp } from '../lib/time'
import type { Attachment, Channel, Message, Profile } from '../lib/types'
import {
  checkFiles, clearStaleTyping, deleteMessage, discardMessage, editMessage, loadMessages, retryMessage, sendMessage, sendTyping,
  setPinned, toggleReaction, invitePreview, joinServer, navigate,
} from '../store/actions'
import { channelTitle, dmPartnerIds, openModal, presenceOf, set, toast, useApp } from '../store/app'
import { joinVoice, toggleCamera, useVoice } from '../voice/engine'
import { EmojiPicker } from './EmojiPicker'
import { GifPicker, useGifFavorites } from './GifPicker'
import { gifIdFromUrl, gifUrl } from '../lib/gifs'
import { Markdown, plain } from './Markdown'
import { canMassPing, massMention, mentionsUser } from '../lib/mentions'
import { channelMention } from '../prisma/agent'
import { PRISMA_PROFILE, PrismaHeadButton, PrismaMark } from './Prisma'
import { Avatar, ErrorBoundary, Spinner } from './ui'

const EMPTY: Message[] = []
const isCoarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

// ============================================================ cabeçalho
function ChatHeader({ channel }: { channel: Channel }) {
  const title = useApp((s) => channelTitle(s, channel))
  const showMembers = useApp((s) => s.showMembers)
  const partnerId = useApp((s) => (channel.kind === 'dm' ? dmPartnerIds(s, channel.id)[0] : undefined))
  const partner = useApp((s) => (partnerId ? s.profiles[partnerId] : undefined))
  const status = useApp((s) => (partnerId ? presenceOf(s, partnerId) : undefined))
  const inVoice = useApp((s) => (partnerId ? !!s.online[partnerId]?.voice : false))
  const calling = useVoice((v) => v.channelId === channel.id)
  const isDm = !channel.server_id
  return (
    <header className="chat-head">
      <button className="icon-btn only-mobile" onClick={() => set({ mobileNav: true })} aria-label="Abrir lista de conversas"><Menu size={20} /></button>
      {channel.kind === 'dm' ? <Avatar profile={partner} size={28} status={status} /> : channel.kind === 'group' ? <span className="head-glyph"><Users size={18} /></span> : <span className="head-glyph"><Hash size={20} /></span>}
      <div className="chat-head-title">
        <h1>{title}</h1>
        {channel.kind === 'dm' && partner && (
          <span className="chat-head-sub">{inVoice ? 'Em chamada' : partner.custom_status || `@${partner.username}`}</span>
        )}
        {channel.topic && <span className="chat-head-sub">{channel.topic}</span>}
      </div>
      <div className="chat-head-actions">
        <PrismaHeadButton />
        {isDm && !calling && (
          <>
            <button data-prisma="call" className="icon-btn" data-tip="Ligar" aria-label="Iniciar chamada de voz" onClick={() => void joinVoice(channel.id, { ring: true })}><Phone size={19} /></button>
            <button className="icon-btn hide-narrow" data-tip="Chamada de vídeo" aria-label="Iniciar chamada de vídeo" onClick={() => void joinVoice(channel.id, { ring: true }).then(() => toggleCamera())}><Video size={20} /></button>
          </>
        )}
        <button className="icon-btn" data-tip="Mensagens fixadas" aria-label="Mensagens fixadas" onClick={() => openModal({ type: 'pins', channelId: channel.id })}><Pin size={19} /></button>
        <button className="icon-btn" data-tip="Buscar neste canal" aria-label="Buscar neste canal" onClick={() => openModal({ type: 'search', channelId: channel.id })}><Search size={19} /></button>
        {channel.kind !== 'dm' && (
          <button className={`icon-btn${showMembers ? ' on' : ''}`} data-tip="Pessoas" aria-label="Mostrar pessoas" aria-pressed={showMembers} onClick={() => set((s) => ({ showMembers: !s.showMembers }))}><Users size={19} /></button>
        )}
      </div>
    </header>
  )
}

// ============================================================ anexos
function AttachmentView({ a }: { a: Attachment }) {
  const ratio = a.width && a.height ? a.width / a.height : undefined
  const box = ratio ? { aspectRatio: String(ratio), width: Math.min(420, a.width!, Math.round(320 * ratio)) } : undefined
  if (a.type.startsWith('image/'))
    return (
      <button className="att att-image" style={box} onClick={() => openModal({ type: 'image', url: a.url, name: a.name })} aria-label={`Abrir imagem ${a.name}`}>
        <img src={a.url} alt={a.name} loading="lazy" />
      </button>
    )
  if (a.type.startsWith('video/'))
    return <video className="att att-video" style={box} src={a.url} controls preload="metadata" playsInline />
  if (a.type.startsWith('audio/'))
    return <div className="att att-audio"><span className="att-name">{a.name}</span><audio src={a.url} controls preload="none" /></div>
  return (
    <a className="att att-file" href={a.url} target="_blank" rel="noopener noreferrer" download={a.name}>
      <FileText size={26} />
      <span className="att-meta"><span className="att-name">{a.name}</span><span className="muted">{fileSize(a.size)}</span></span>
      <Download size={18} />
    </a>
  )
}

// ============================================================ mensagem
function ReactionEmoji({ emoji }: { emoji: string }) {
  const custom = useApp((s) => (emoji.startsWith('<:') ? s.emojis[emoji.slice(emoji.lastIndexOf(':') + 1, -1)] : undefined))
  if (!emoji.startsWith('<:')) return <span className="rx-emoji">{emoji}</span>
  return custom && safeMediaUrl(custom.url) ? <img className="rx-emoji" src={safeMediaUrl(custom.url)!} alt={`:${custom.name}:`} /> : <span className="rx-emoji">❔</span>
}

interface ItemProps { m: Message; fresh?: boolean; compact: boolean; author?: Profile; replied?: Message | null; repliedAuthor?: Profile; mine: boolean; canModerate: boolean; canPin: boolean; editing: boolean; mentioned: boolean }

const MessageItem = memo(function MessageItem({ m, fresh, compact, author, replied, repliedAuthor, mine, canModerate, canPin, editing, mentioned }: ItemProps) {
  const uid = useApp((s) => s.userId)!
  const [picker, setPicker] = useState(false)
  const [active, setActive] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const editRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!editing) return
    setDraft(m.content)
    const el = editRef.current
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const groups = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>()
    for (const r of m.reactions) {
      const g = map.get(r.emoji) || { count: 0, mine: false }
      g.count++; if (r.user_id === uid) g.mine = true
      map.set(r.emoji, g)
    }
    return [...map.entries()]
  }, [m.reactions, uid])

  if (m.bot === 'welcome') return (
    <div id={`msg-${m.id}`} className={`msg-system${fresh ? ' fresh' : ''}`} role="note">
      <span className="msg-system-icon" aria-hidden="true">👋</span>
      <span><button type="button" className="link-strong" onClick={() => openModal({ type: 'profile', userId: m.author_id })}>{author?.display_name || 'Alguém'}</button> entrou no servidor. Dê as boas-vindas!</span>
      <time className="muted">{clock(m.created_at)}</time>
      <button className="btn ghost small" onClick={() => { const input = document.getElementById('composer-input') as HTMLTextAreaElement | null; if (input && author) { input.focus(); document.execCommand?.('insertText', false, `Bem-vindo(a), @${author.username}! 🎉 `) } }}>Acenar 👋</button>
    </div>
  )
  const bot = m.bot === 'prisma'
  const name = bot ? 'Prisma' : author?.display_name || 'Usuário'
  const openProfile = () => openModal({ type: 'profile', userId: m.author_id })
  const stable = !m.pending && !m.failed

  return (
    <article
      id={`msg-${m.id}`}
      className={`msg${bot ? ' bot' : ''}${fresh ? ' fresh' : ''}${compact ? ' compact' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}${mentioned ? ' mentioned' : ''}${active || picker ? ' active' : ''}${m.pinned ? ' pinned' : ''}`}
      onClick={(e) => { if (isCoarse() && !(e.target as HTMLElement).closest('a,button,video,audio,textarea')) setActive((v) => !v) }}
      onMouseLeave={() => setActive(false)}
    >
      {m.reply_to && (
        <div className="msg-reply">
          <CornerUpLeft size={13} />
          {replied ? (
            <button onClick={() => document.getElementById(`msg-${replied.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>
              <strong>{repliedAuthor?.display_name || 'Usuário'}</strong> {plain(replied.content).slice(0, 120) || 'Anexo'}
            </button>
          ) : <span className="muted">Mensagem original apagada</span>}
        </div>
      )}
      <div className="msg-gutter">
        {compact ? <time className="msg-mini-time" dateTime={m.created_at}>{clock(m.created_at)}</time>
          : bot ? <span className="bot-avatar" aria-hidden="true"><PrismaMark size={22} /></span>
          : <button className="plain" onClick={openProfile} aria-label={`Ver perfil de ${name}`}><Avatar profile={author} name={name} seed={m.author_id} size={40} /></button>}
      </div>
      <div className="msg-body">
        {!compact && (
          <header className="msg-head">
            {bot ? <><span className="msg-author bot">Prisma</span><span className="bot-tag">IA</span><span className="bot-for">a pedido de {author?.display_name || 'alguém'}</span></>
              : <button className="msg-author" onClick={openProfile} style={{ color: author?.accent_color && author.accent_color.toLowerCase() !== '#00a86b' ? author.accent_color : undefined }}>{name}</button>}
            <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('pt-BR')}>{stamp(m.created_at)}</time>
            {m.pinned && <span className="msg-pin" title="Mensagem fixada"><Pin size={12} /></span>}
          </header>
        )}
        {editing ? (
          <div className="msg-edit">
            <textarea ref={editRef} value={draft} maxLength={4000} rows={Math.min(8, draft.split('\n').length + 1)} aria-label="Editar mensagem"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); set({ editing: null }) }
                if (e.key === 'Enter' && !e.shiftKey && !isCoarse()) { e.preventDefault(); void editMessage(m, draft) }
              }} />
            <div className="msg-edit-actions">
              <button className="btn ghost small" onClick={() => set({ editing: null })}>Cancelar</button>
              <button className="btn primary small" onClick={() => void editMessage(m, draft)}>Salvar</button>
            </div>
          </div>
        ) : (
          <>
            {m.content && <Markdown text={m.content} />}
            {m.content && inviteCode(m.content) && <InviteCard code={inviteCode(m.content)!} />}
            {m.edited_at && <span className="msg-edited" title={new Date(m.edited_at).toLocaleString('pt-BR')}>(editada)</span>}
          </>
        )}
        {m.attachments.length > 0 && <div className="atts">{m.attachments.map((a, i) => <AttachmentView key={i} a={a} />)}</div>}
        {groups.length > 0 && (
          <div className="rxs">
            {groups.map(([emoji, g]) => (
              <button key={emoji} className={`rx${g.mine ? ' mine' : ''}`} onClick={() => void toggleReaction(m, emoji)} aria-pressed={g.mine} aria-label={`${g.count} reação`}>
                <ReactionEmoji emoji={emoji} /><span>{g.count}</span>
              </button>
            ))}
            <button className="rx add" onClick={() => setPicker(true)} aria-label="Adicionar reação"><Smile size={15} /></button>
          </div>
        )}
        {m.failed && (
          <div className="msg-failed" role="alert">
            Não foi enviada.
            <button className="link" onClick={() => void retryMessage(m.id)}><RotateCw size={13} /> Tentar de novo</button>
            <button className="link" onClick={() => discardMessage(m)}>Descartar</button>
          </div>
        )}
      </div>
      {stable && !editing && (
        <div className="msg-tools" role="toolbar" aria-label="Ações da mensagem">
          {QUICK_REACTIONS.slice(0, 3).map((e) => <button key={e} className="hide-touch" onClick={() => void toggleReaction(m, e)} aria-label={`Reagir com ${e}`}>{e}</button>)}
          <button data-tip="Reagir" aria-label="Reagir" onClick={() => setPicker((v) => !v)}><Smile size={17} /></button>
          <button data-tip="Responder" aria-label="Responder" onClick={() => { set((s) => ({ replyingTo: { ...s.replyingTo, [m.channel_id]: m.id } })); document.getElementById('composer-input')?.focus() }}><CornerUpLeft size={17} /></button>
          {mine && !bot && <button data-tip="Editar" aria-label="Editar" onClick={() => set({ editing: m.id })}><Pencil size={16} /></button>}
          {canPin && <button data-tip={m.pinned ? 'Desafixar' : 'Fixar'} aria-label={m.pinned ? 'Desafixar' : 'Fixar'} onClick={() => void setPinned(m, !m.pinned)}><Pin size={16} /></button>}
          {gifUrl(m.content.trim()) && <FavGifButton url={m.content.trim()} />}
          {m.content && <button data-tip="Copiar texto" aria-label="Copiar texto" onClick={() => void navigator.clipboard?.writeText(m.content).then(() => toast('Texto copiado', 'ok'))}><Copy size={16} /></button>}
          {(mine || canModerate) && (
            <button className="danger" data-tip="Apagar" aria-label="Apagar" onClick={(e) => {
              if (e.shiftKey) return void deleteMessage(m)
              openModal({ type: 'confirm', title: 'Apagar mensagem', text: 'A mensagem some para todo mundo e não dá para desfazer.', action: 'Apagar mensagem', danger: true, onConfirm: () => deleteMessage(m) })
            }}><Trash2 size={16} /></button>
          )}
        </div>
      )}
      {picker && <EmojiPicker onClose={() => setPicker(false)} onPick={(e) => { setPicker(false); void toggleReaction(m, e) }} />}
    </article>
  )
})

// ============================================================ cartão de convite
const INVITE_RX = /#\/invite\/([a-z0-9]{6,16})\b/i
const inviteCode = (text: string) => INVITE_RX.exec(text)?.[1]?.toLowerCase() || null
type Preview = Awaited<ReturnType<typeof invitePreview>> | null
const previews = new Map<string, Promise<Preview>>()

/** Link de convite numa mensagem vira um cartão com o servidor e o botão de entrar. */
function InviteCard({ code }: { code: string }) {
  const [info, setInfo] = useState<Preview | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const joined = useApp((s) => (info ? s.servers.some((x) => x.id === info.id) : false))
  useEffect(() => {
    let alive = true
    if (!previews.has(code)) previews.set(code, invitePreview(code).catch(() => null))
    void previews.get(code)!.then((p) => { if (alive) setInfo(p) })
    return () => { alive = false }
  }, [code])
  if (info === undefined) return <div className="invite-card loading"><span className="invite-card-face" /><span className="muted">Carregando convite…</span></div>
  if (!info) return <div className="invite-card dead"><span className="muted">Convite inválido ou trocado pelo dono do servidor.</span></div>
  const member = joined || info.already_member
  return (
    <div className="invite-card" onClick={(e) => e.stopPropagation()}>
      <span className="invite-card-label">Convite para um servidor</span>
      <div className="invite-card-row">
        <Avatar url={info.icon_url} name={info.name} seed={info.id} size={46} square />
        <span className="invite-card-text"><strong>{info.name}</strong><span className="muted">{info.member_count} {info.member_count === 1 ? 'membro' : 'membros'}</span></span>
        <button className="btn primary small" disabled={busy} onClick={async () => {
          if (member) return navigate({ serverId: info.id, channelId: null })
          setBusy(true)
          const ok = await joinServer(code)
          setBusy(false)
          if (ok) { previews.delete(code); toast(`Você entrou no ${info.name}!`, 'ok') }
        }}>{member ? 'Abrir' : busy ? 'Entrando…' : 'Entrar'}</button>
      </div>
    </div>
  )
}

function FavGifButton({ url }: { url: string }) {
  const { isFav, toggle } = useGifFavorites()
  const on = isFav(url)
  return <button data-tip={on ? 'Tirar dos favoritos' : 'Salvar GIF'} aria-label={on ? 'Tirar GIF dos favoritos' : 'Salvar GIF nos favoritos'} aria-pressed={on} className={on ? 'on' : ''} onClick={() => void toggle({ id: gifIdFromUrl(url), url, preview: url, width: 0, height: 0 })}><Star size={16} /></button>
}

// ============================================================ lista
function MessageList({ channel }: { channel: Channel }) {
  const list = useApp((s) => s.messages[channel.id])
  const items = list?.items ?? EMPTY
  const profiles = useApp((s) => s.profiles)
  const replyCache = useApp((s) => s.replyCache)
  const uid = useApp((s) => s.userId)!
  const myName = useApp((s) => s.me?.username || '')
  const role = useApp((s) => (channel.server_id ? s.roles[channel.server_id] : null))
  const editing = useApp((s) => s.editing)
  const title = useApp((s) => channelTitle(s, channel))
  const wrap = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const prev = useRef({ height: 0, first: '', last: '', count: 0 })
  const [fresh, setFresh] = useState(0)
  const mountedAt = useRef(Date.now())
  const canModerate = role === 'owner' || role === 'admin'
  const canPin = !channel.server_id || canModerate
  const server = useApp((s) => (channel.server_id ? s.servers.find((x) => x.id === channel.server_id) : undefined))
  const serverMembers = useApp((s) => (channel.server_id ? s.members[channel.server_id] : undefined))
  const suppress = useApp((s) => (channel.server_id ? !!s.notifyPrefs[channel.server_id]?.suppress_everyone : false))
  const isMentioned = useCallback((m: Message) => !!myName && (mentionsUser(m.content, myName) || (!!channel.server_id && !suppress && !!massMention(m.content) && canMassPing(server, m.author_id, serverMembers))), [myName, channel.server_id, suppress, server, serverMembers])
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items])

  const toBottom = useCallback((smooth = false) => {
    const el = wrap.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    stick.current = true
    setFresh(0)
  }, [])

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const first = items[0]?.id || ''
    const lastMsg = items[items.length - 1]
    const last = lastMsg?.id || ''
    const p = prev.current
    const appended = last !== p.last && items.length > 0
    if (appended && lastMsg?.author_id === uid && lastMsg.pending) stick.current = true
    if (stick.current) el.scrollTop = el.scrollHeight
    else if (p.first && first !== p.first && last === p.last) el.scrollTop += el.scrollHeight - p.height
    else if (appended && p.count > 0 && lastMsg?.author_id !== uid) setFresh((n) => n + 1)
    prev.current = { height: el.scrollHeight, first, last, count: items.length }
  }, [items, uid])

  // imagens e vídeos mudam a altura depois de carregar: mantém colado no fim
  useEffect(() => {
    const el = inner.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const w = wrap.current
      if (!w) return
      if (stick.current) w.scrollTop = w.scrollHeight
      prev.current.height = w.scrollHeight
    })
    ro.observe(el)
    // a área visível também muda (teclado do celular abrindo, barra de resposta): continua nas mais recentes
    if (wrap.current) ro.observe(wrap.current)
    const vv = window.visualViewport
    const onVv = () => { const w = wrap.current; if (w && stick.current) requestAnimationFrame(() => { w.scrollTop = w.scrollHeight }) }
    vv?.addEventListener('resize', onVv)
    return () => { ro.disconnect(); vv?.removeEventListener('resize', onVv) }
  }, [])

  const onScroll = () => {
    const el = wrap.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (stick.current && fresh) setFresh(0)
    if (el.scrollTop < 300 && list?.loaded && list.hasMore && !list.loading) void loadMessages(channel.id, true)
  }

  return (
    <div className="msgs-wrap">
      <div className="msgs" ref={wrap} onScroll={onScroll} role="log" aria-label={`Mensagens de ${title}`} tabIndex={0}>
        <div ref={inner} className="msgs-inner">
          {!list?.loaded ? <div className="msgs-loading"><Spinner /></div> : (
            <>
              {list.hasMore ? <div className="msgs-more">{list.loading ? 'Carregando mensagens antigas…' : ''}</div> : (
                <div className="msgs-start">
                  <span className="msgs-start-icon">{channel.server_id ? <Hash size={30} /> : <AtSign size={30} />}</span>
                  <h2>{channel.server_id ? `Este é o começo de #${title}` : channel.kind === 'group' ? `Este é o começo do grupo ${title}` : `Este é o começo da sua conversa com ${title}`}</h2>
                  <p className="muted">{channel.topic || 'Mande a primeira mensagem, um arquivo de até 200 MB ou comece uma chamada.'}</p>
                </div>
              )}
              {items.map((m, i) => {
                const before = items[i - 1]
                const newDay = !before || !sameDay(before.created_at, m.created_at)
                const compact = !newDay && !m.reply_to && before.author_id === m.author_id && !before.bot === !m.bot && new Date(m.created_at).getTime() - new Date(before.created_at).getTime() < 7 * 60000
                const replied = m.reply_to ? byId.get(m.reply_to) ?? replyCache[m.reply_to] ?? null : undefined
                return (
                  <div key={m.id}>
                    {newDay && <div className="day-divider" role="separator"><span>{dayLabel(m.created_at)}</span></div>}
                    <MessageItem m={m} fresh={new Date(m.created_at).getTime() > mountedAt.current} compact={compact} author={profiles[m.author_id]} replied={replied} repliedAuthor={replied ? profiles[replied.author_id] : undefined}
                      mine={m.author_id === uid} canModerate={canModerate} canPin={canPin} editing={editing === m.id}
                      mentioned={m.author_id !== uid && isMentioned(m)} />
                  </div>
                )
              })}
              <div className="msgs-end" />
            </>
          )}
        </div>
      </div>
      {fresh > 0 && (
        <button className="jump-new" onClick={() => toBottom(true)}><ArrowDown size={15} /> {fresh === 1 ? '1 mensagem nova' : `${fresh} mensagens novas`}</button>
      )}
    </div>
  )
}

// ============================================================ caixa de mensagem
const drafts = new Map<string, string>()

const massProfile = (username: string, display: string): Profile => ({ id: `mass-${username}`, username, display_name: display, avatar_url: null, banner_url: null, accent_color: '#00A86B', bio: '', status: 'online', custom_status: '', onboarded: true, created_at: '' })
const MASS_PROFILES = [massProfile('everyone', 'Todos do servidor'), massProfile('here', 'Quem está online agora')]

function Composer({ channel, dropped }: { channel: Channel; dropped: File[] | null }) {
  const [gifs, setGifs] = useState(false)
  const [text, setText] = useState(() => drafts.get(channel.id) || '')
  const [files, setFiles] = useState<File[]>([])
  const [picker, setPicker] = useState(false)
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const title = useApp((s) => channelTitle(s, channel))
  const replyId = useApp((s) => s.replyingTo[channel.id])
  const replyMsg = useApp((s) => (replyId ? s.messages[channel.id]?.items.find((m) => m.id === replyId) : undefined))
  const replyAuthor = useApp((s) => (replyMsg ? s.profiles[replyMsg.author_id] : undefined))
  const typing = useApp((s) => s.typing[channel.id])
  const profiles = useApp((s) => s.profiles)
  const uploads = useApp((s) => s.uploads)
  const members = useApp((s) => (channel.server_id ? s.members[channel.server_id] : undefined))
  const server = useApp((s) => (channel.server_id ? s.servers.find((x) => x.id === channel.server_id) : undefined))
  const dmMembers = useApp((s) => s.dmMembers)
  const uid = useApp((s) => s.userId)
  const myUploads = uploads.filter((u) => u.channelId === channel.id)

  useEffect(() => { drafts.set(channel.id, text) }, [text, channel.id])
  useEffect(() => { if (!isCoarse()) input.current?.focus() }, [channel.id])
  useEffect(() => { if (dropped?.length) setFiles((f) => [...f, ...checkFiles(dropped, f.length)]) }, [dropped])
  useEffect(() => { const t = setInterval(clearStaleTyping, 2000); return () => clearInterval(t) }, [])
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    // posiciona o cursor logo depois de inserir menção/emoji, antes da próxima tecla
    if (caret.current !== null) { el.focus(); el.setSelectionRange(caret.current, caret.current); caret.current = null }
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.38))}px`
  }, [text])

  const candidates = useMemo(() => {
    if (!mention) return []
    const ids = channel.server_id ? (members || []).map((m) => m.user_id) : dmMembers.filter((m) => m.channel_id === channel.id).map((m) => m.user_id)
    const q = mention.query.toLowerCase()
    const people = ids.map((id) => profiles[id]).filter((p): p is Profile => !!p && p.id !== uid && (p.username.includes(q) || p.display_name.toLowerCase().includes(q))).slice(0, 6)
    const mass = channel.server_id && canMassPing(server, uid || '', members)
      ? MASS_PROFILES.filter((p) => p.username.startsWith(q) || p.display_name.toLowerCase().includes(q)) : []
    return [...mass, ...('prisma'.includes(q) ? [PRISMA_PROFILE] : []), ...people].slice(0, 7)
  }, [mention, members, dmMembers, profiles, channel, uid, server])

  function onChange(value: string, caret: number) {
    setText(value)
    if (value.trim()) sendTyping()
    const m = /(^|\s)@([a-z0-9_.]{0,20})$/i.exec(value.slice(0, caret))
    setMention(m ? { query: m[2], start: caret - m[2].length - 1, index: 0 } : null)
  }
  function insert(snippet: string) {
    const el = input.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = text.slice(0, start) + snippet + text.slice(end)
    caret.current = start + snippet.length
    setText(next)
  }
  function completeMention(p: Profile) {
    if (!mention) return
    const el = input.current
    const at = el?.selectionStart ?? text.length
    const next = `${text.slice(0, mention.start)}@${p.username} ${text.slice(at)}`
    caret.current = mention.start + p.username.length + 2
    setText(next); setMention(null)
  }

  async function submit() {
    const body = text
    const sending = files
    if (!body.trim() && !sending.length) return
    if (body.trim().length > 4000) return toast('A mensagem passa de 4.000 caracteres.', 'error')
    setText(''); setFiles([]); setMention(null); drafts.delete(channel.id)
    const ok = await sendMessage(channel.id, body, sending, replyId || null)
    if (ok && /(^|\s)@prisma\b/i.test(body)) void channelMention(channel.id, body)
    if (!ok && sending.length) { setText((t) => t || body); setFiles((f) => (f.length ? f : sending)) }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        return setMention({ ...mention, index: (mention.index + d + candidates.length) % candidates.length })
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return completeMention(candidates[mention.index] || candidates[0]) }
      if (e.key === 'Escape') { e.preventDefault(); return setMention(null) }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isCoarse()) { e.preventDefault(); void submit() }
    else if (e.key === 'Escape' && replyId) set((s) => ({ replyingTo: { ...s.replyingTo, [channel.id]: null } }))
    else if (e.key === 'ArrowUp' && !text) {
      const s = useApp.getState()
      const last = [...(s.messages[channel.id]?.items || [])].reverse().find((m) => m.author_id === s.userId && !m.pending && !m.failed)
      if (last) { e.preventDefault(); set({ editing: last.id }) }
    }
  }

  const typers = Object.keys(typing || {}).map((id) => profiles[id]?.display_name).filter(Boolean)
  const over = text.trim().length - 4000

  return (
    <footer className="composer-wrap">
      {myUploads.length > 0 && (
        <div className="uploads" aria-live="polite">
          {myUploads.map((u) => (
            <div key={u.id} className="upload">
              <div className="upload-info"><span className="att-name">{u.name}</span><span className="muted">{Math.round(u.progress * 100)}% de {fileSize(u.size)}</span></div>
              <div className="bar" role="progressbar" aria-valuenow={Math.round(u.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Enviando ${u.name}`}><i style={{ width: `${u.progress * 100}%` }} /></div>
              <button className="icon-btn" onClick={u.abort} aria-label={`Cancelar envio de ${u.name}`}><X size={16} /></button>
            </div>
          ))}
        </div>
      )}
      {mention && candidates.length > 0 && (
        <ul className="mention-list pop" role="listbox" aria-label="Mencionar alguém">
          {candidates.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === mention.index} className={i === mention.index ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); completeMention(p) }}>
              {p.id === PRISMA_PROFILE.id ? <span className="bot-avatar small"><PrismaMark size={14} /></span> : p.id.startsWith('mass-') ? <span className="mass-avatar"><AtSign size={14} /></span> : <Avatar profile={p} size={24} />} <strong>{p.display_name}</strong> <span className="muted">{p.id === PRISMA_PROFILE.id ? 'assistente · responde aqui' : `@${p.username}`}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={`composer${replyMsg ? ' replying' : ''}`} data-prisma="composer">
        {replyMsg && (
          <div className="composer-reply">
            <CornerUpLeft size={14} />
            <span>Respondendo a <strong>{replyAuthor?.display_name || 'Usuário'}</strong></span>
            <button className="icon-btn" onClick={() => set((s) => ({ replyingTo: { ...s.replyingTo, [channel.id]: null } }))} aria-label="Cancelar resposta"><X size={15} /></button>
          </div>
        )}
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((f, i) => (
              <div className="file-chip" key={`${f.name}-${i}`}>
                {f.type.startsWith('image/') ? <FilePreview file={f} /> : <FileText size={22} />}
                <span className="att-meta"><span className="att-name">{f.name}</span><span className="muted">{fileSize(f.size)}</span></span>
                <button className="icon-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remover ${f.name}`}><X size={15} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button className="icon-btn" data-tip="Anexar (até 200 MB)" aria-label="Anexar arquivo" onClick={() => fileInput.current?.click()}><Plus size={21} /></button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const picked = [...(e.target.files || [])]; setFiles((f) => [...f, ...checkFiles(picked, f.length)]); e.target.value = ''; input.current?.focus() }} />
          <textarea
            id="composer-input" ref={input} rows={1} value={text} placeholder={channel.server_id ? `Conversar em #${title}` : `Conversar com ${title}`}
            aria-label="Mensagem" enterKeyHint={isCoarse() ? 'enter' : 'send'}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)} onKeyDown={onKeyDown}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files]
              if (pasted.length) { e.preventDefault(); setFiles((f) => [...f, ...checkFiles(pasted, f.length)]) }
            }}
          />
          {over > -500 && <span className={`counter${over > 0 ? ' over' : ''}`} aria-live="polite">{-over}</span>}
          <div className="rel">
            <button className="icon-btn gif-btn" data-tip="GIF" aria-label="Escolher GIF" aria-expanded={gifs} onClick={() => { setGifs((v) => !v); setPicker(false) }}><span className="gif-badge">GIF</span></button>
            {gifs && <GifPicker onClose={() => setGifs(false)} onPick={(g) => { setGifs(false); void sendMessage(channel.id, g.url, [], replyId || null) }} />}
          </div>
          <div className="rel">
            <button className="icon-btn" data-tip="Emoji" aria-label="Inserir emoji" aria-expanded={picker} onClick={() => { setPicker((v) => !v); setGifs(false) }}><Smile size={21} /></button>
            {picker && <EmojiPicker onClose={() => setPicker(false)} onPick={(e) => insert(e.startsWith('<:') ? `${e} ` : e)} />}
          </div>
          <button className="icon-btn send" aria-label="Enviar mensagem" disabled={(!text.trim() && !files.length) || over > 0} onClick={() => void submit()}><SendHorizontal size={20} /></button>
        </div>
      </div>
      <div className="typing" aria-live="polite">
        {typers.length > 0 && (
          <><span className="typing-dots"><i /><i /><i /></span>
            {typers.length === 1 ? <><strong>{typers[0]}</strong> está digitando…</> : typers.length < 4 ? <><strong>{typers.join(', ')}</strong> estão digitando…</> : 'Várias pessoas estão digitando…'}</>
        )}
      </div>
    </footer>
  )
}

function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u) }, [file])
  return url ? <img src={url} alt="" /> : <Paperclip size={20} />
}

// ============================================================ tela do chat
export function ChatView({ channel }: { channel: Channel }) {
  const [drag, setDrag] = useState(false)
  const [dropped, setDropped] = useState<File[] | null>(null)
  const depth = useRef(0)
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files')
  return (
    <section className="chat"
      onDragEnter={(e) => { if (hasFiles(e)) { depth.current++; setDrag(true) } }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault() }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDrag(false) }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current = 0; setDrag(false); setDropped([...e.dataTransfer.files]) }}
    >
      <ChatHeader channel={channel} />
      <ErrorBoundary label="Não foi possível mostrar as mensagens deste canal."><MessageList key={channel.id} channel={channel} /></ErrorBoundary>
      <Composer key={`c-${channel.id}`} channel={channel} dropped={dropped} />
      {drag && <div className="drop-veil"><div><Paperclip size={34} /><strong>Solte para anexar</strong><span>Até 200 MB por arquivo</span></div></div>}
    </section>
  )
}
