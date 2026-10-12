import { Fragment, memo, useMemo, useState, type ReactNode } from 'react'
import { gifUrl } from '../lib/gifs'
import { safeMediaUrl } from '../lib/supabase'
import { openModal, useApp } from '../store/app'

const INLINE = new RegExp([
  '(`[^`\\n]+`)',                                             // 1 código
  '(<:[a-z0-9_]{2,24}:[0-9a-f-]{36}>)',                       // 2 emoji próprio
  '(https?:\\/\\/[^\\s<>]+[^\\s<>.,;:!?)\\]}\'"*_~|])',       // 3 link
  '(\\*\\*[^\\n]+?\\*\\*)',                                   // 4 negrito
  '(__[^\\n]+?__)',                                           // 5 sublinhado
  '(~~[^\\n]+?~~)',                                           // 6 riscado
  '(\\|\\|[\\s\\S]+?\\|\\|)',                                 // 7 spoiler
  '(\\*[^\\s*][^*\\n]*?\\*)',                                 // 8 itálico
  '((?<![\\p{L}\\p{N}_])_[^\\s_][^_\\n]*?_(?![\\p{L}\\p{N}_]))', // 9 itálico
  '((?<![\\p{L}\\p{N}_.@])@[a-z0-9_.]{3,20})',                // 10 menção
].join('|'), 'giu')

const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s|<:[a-z0-9_]{2,24}:[0-9a-f-]{36}>)+$/u

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={`spoiler${open ? ' open' : ''}`} role="button" tabIndex={0} aria-label={open ? undefined : 'Spoiler — clique para revelar'}
      onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}>
      <span aria-hidden={!open}>{children}</span>
    </span>
  )
}

interface Ctx { users: Record<string, string>; emojis: Record<string, { url: string; name: string }>; me: string }

function inline(text: string, ctx: Ctx, key = 'k'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index!
    if (at > last) out.push(text.slice(last, at))
    const k = `${key}-${n++}`
    const raw = m[0]
    if (m[1]) out.push(<code key={k}>{raw.slice(1, -1)}</code>)
    else if (m[2]) {
      const [, name, id] = /^<:([^:]+):([^>]+)>$/.exec(raw)!
      const e = ctx.emojis[id]
      const src = safeMediaUrl(e?.url)
      out.push(e && src ? <img key={k} className="emoji-custom" src={src} alt={`:${name}:`} title={`:${name}:`} draggable={false} /> : `:${name}:`)
    } else if (m[3]) out.push(<a key={k} href={raw} target="_blank" rel="noopener noreferrer nofollow">{raw}</a>)
    else if (m[4]) out.push(<strong key={k}>{inline(raw.slice(2, -2), ctx, k)}</strong>)
    else if (m[5]) out.push(<u key={k}>{inline(raw.slice(2, -2), ctx, k)}</u>)
    else if (m[6]) out.push(<s key={k}>{inline(raw.slice(2, -2), ctx, k)}</s>)
    else if (m[7]) out.push(<Spoiler key={k}>{inline(raw.slice(2, -2), ctx, k)}</Spoiler>)
    else if (m[8] || m[9]) out.push(<em key={k}>{inline(raw.slice(1, -1), ctx, k)}</em>)
    else if (m[10]) {
      const name = raw.slice(1).toLowerCase()
      const id = ctx.users[name]
      if (name === 'todos') out.push(<span key={k} className="mention me">@todos</span>)
      else if (id) out.push(
        <button key={k} type="button" className={`mention${name === ctx.me ? ' me' : ''}`} onClick={() => openModal({ type: 'profile', userId: id })}>@{name}</button>,
      )
      else out.push(raw)
    }
    last = at + raw.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function blocks(text: string, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = []
  const parts = text.split(/```(?:[a-zA-Z0-9+#-]*\n)?([\s\S]*?)```/g)
  parts.forEach((part, i) => {
    if (i % 2 === 1) { out.push(<pre key={`c${i}`} className="code-block"><code>{part.replace(/\n$/, '')}</code></pre>); return }
    if (!part) return
    const lines = part.replace(/^\n+|\n+$/g, '').split('\n')
    let quote: string[] = []
    const flush = (k: string) => {
      if (!quote.length) return
      out.push(<blockquote key={k}>{quote.map((q, j) => <Fragment key={j}>{j > 0 && <br />}{inline(q, ctx, `${k}${j}`)}</Fragment>)}</blockquote>)
      quote = []
    }
    let buf: ReactNode[] = []
    lines.forEach((line, j) => {
      if (/^> ?/.test(line) && line.startsWith('>')) {
        if (buf.length) { out.push(<Fragment key={`t${i}-${j}`}>{buf}</Fragment>); buf = [] }
        quote.push(line.replace(/^> ?/, ''))
      } else {
        flush(`q${i}-${j}`)
        if (buf.length) buf.push(<br key={`b${j}`} />)
        buf.push(...inline(line, ctx, `l${i}-${j}`))
      }
    })
    flush(`q${i}-end`)
    if (buf.length) out.push(<Fragment key={`t${i}-end`}>{buf}</Fragment>)
  })
  return out
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const profiles = useApp((s) => s.profiles)
  const emojis = useApp((s) => s.emojis)
  const me = useApp((s) => s.me?.username || '')
  const users = useMemo(() => Object.fromEntries(Object.values(profiles).map((p) => [p.username, p.id])), [profiles])
  const big = text.length <= 120 && ONLY_EMOJI.test(text) && !/^\s*$/.test(text) && !/^[\d\s#*]+$/.test(text)
  const gif = gifUrl(text.trim())
  const nodes = useMemo(() => (gif ? null : blocks(text, { users, emojis, me })), [text, users, emojis, me, gif])
  // mensagem que é só um GIF: mostra o GIF animado no lugar do link
  if (gif) return <div className="md"><img className="gif-embed" src={gif} alt="GIF" loading="lazy" onClick={(e) => e.stopPropagation()} /></div>
  return <div className={`md${big ? ' jumbo' : ''}`}>{nodes}</div>
})

/** Texto curto de uma linha para prévias (respostas, notificações). */
export const plain = (text: string) => gifUrl(text.trim()) ? 'GIF' : text.replace(/```[\s\S]*?```/g, '[código]').replace(/<:([a-z0-9_]+):[0-9a-f-]{36}>/g, ':$1:').replace(/[*_~|`]/g, '').replace(/\s+/g, ' ').trim()
