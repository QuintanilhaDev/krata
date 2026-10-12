import { useMemo, useRef, useState } from 'react'
import { EMOJI_GROUPS, recentEmoji } from '../lib/emoji'
import { safeMediaUrl } from '../lib/supabase'
import { useApp } from '../store/app'
import { useClickOutside } from './ui'

/** `onPick` recebe o emoji unicode ou o código `<:nome:id>` de um emoji próprio. */
export function EmojiPicker({ onPick, onClose, align = 'right' }: { onPick: (emoji: string) => void; onClose: () => void; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, onClose)
  const emojis = useApp((s) => s.emojis)
  const servers = useApp((s) => s.servers)
  const custom = useMemo(() => Object.values(emojis).filter((e) => servers.some((s) => s.id === e.server_id) && safeMediaUrl(e.url)), [emojis, servers])
  const recent = useMemo(() => recentEmoji().filter((e) => !e.startsWith('<:') || emojis[e.slice(e.lastIndexOf(':') + 1, -1)]), [emojis])
  const [tab, setTab] = useState(recent.length ? 'recent' : 'smileys')
  const items = tab === 'recent' ? recent : tab === 'custom' ? [] : EMOJI_GROUPS.find((g) => g.id === tab)?.items || []
  const render = (e: string) => {
    if (!e.startsWith('<:')) return e
    const c = emojis[e.slice(e.lastIndexOf(':') + 1, -1)]
    return c && safeMediaUrl(c.url) ? <img src={safeMediaUrl(c.url)!} alt={`:${c.name}:`} /> : null
  }
  return (
    <div ref={ref} className={`emoji-picker pop ${align}`} role="dialog" aria-label="Escolher emoji">
      <div className="emoji-tabs" role="tablist">
        {recent.length > 0 && <button role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'on' : ''} onClick={() => setTab('recent')} title="Recentes">🕘</button>}
        {custom.length > 0 && <button role="tab" aria-selected={tab === 'custom'} className={tab === 'custom' ? 'on' : ''} onClick={() => setTab('custom')} title="Emojis dos seus servidores">💎</button>}
        {EMOJI_GROUPS.map((g) => (
          <button key={g.id} role="tab" aria-selected={tab === g.id} className={tab === g.id ? 'on' : ''} onClick={() => setTab(g.id)} title={g.label}>{g.icon}</button>
        ))}
      </div>
      <div className="emoji-grid">
        {tab === 'custom'
          ? custom.map((c) => (
            <button key={c.id} onClick={() => onPick(`<:${c.name}:${c.id}>`)} title={`:${c.name}:`}><img src={c.url} alt={`:${c.name}:`} /></button>
          ))
          : items.map((e) => <button key={e} onClick={() => onPick(e)}>{render(e)}</button>)}
      </div>
    </div>
  )
}
