// Insígnias: desenhos próprios do Krata (gema facetada de jade), com brilho e cartão ao passar o mouse.
import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { badgesOf, type BadgeId, type BadgeInfo } from '../lib/badges'
import { useApp } from '../store/app'

/** Desenho de cada insígnia (24×24). */
export function BadgeIcon({ id, size = 24 }: { id: BadgeId; size?: number }) {
  const u = useId().replace(/:/g, '')
  if (id === 'founder') return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={`fg${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF1BF" /><stop offset=".45" stopColor="#F4C152" /><stop offset="1" stopColor="#B06A12" /></linearGradient>
        <linearGradient id={`fj${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#B8FFE3" /><stop offset=".5" stopColor="#2BD69A" /><stop offset="1" stopColor="#0A6B4A" /></linearGradient>
      </defs>
      {/* escudo hexagonal dourado */}
      <path d="M12 1.2 21.4 6.6v10.8L12 22.8 2.6 17.4V6.6Z" fill={`url(#fg${u})`} stroke="#5a3608" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M12 3.1 19.7 7.5v9L12 20.9 4.3 16.5v-9Z" fill="#2a1a06" opacity=".38" />
      {/* coroa */}
      <path d="M6.9 9.6 8.4 6.4l2 2.2L12 5.2l1.6 3.4 2-2.2 1.5 3.2Z" fill={`url(#fg${u})`} stroke="#5a3608" strokeWidth=".55" strokeLinejoin="round" />
      {/* gema de jade facetada */}
      <path d="M12 9.7 16.8 12.3 12 19.8 7.2 12.3Z" fill={`url(#fj${u})`} stroke="#063d2a" strokeWidth=".55" strokeLinejoin="round" />
      <path d="M12 9.7 13.9 12.3 12 19.8 10.1 12.3Z" fill="#E9FFF6" opacity=".35" />
      <path d="M7.2 12.3h9.6" stroke="#063d2a" strokeWidth=".45" />
      <circle cx="17.6" cy="5.4" r=".9" fill="#fff" opacity=".9" />
    </svg>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={`ag${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFD6F6" /><stop offset=".45" stopColor="#B07CFF" /><stop offset="1" stopColor="#4B1FB0" /></linearGradient>
        <linearGradient id={`ab${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#B8FFE3" /><stop offset="1" stopColor="#14B07A" /></linearGradient>
      </defs>
      <path d="M12 1.2 21.4 6.6v10.8L12 22.8 2.6 17.4V6.6Z" fill={`url(#ag${u})`} stroke="#2a0d66" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M12 3.1 19.7 7.5v9L12 20.9 4.3 16.5v-9Z" fill="#14072e" opacity=".34" />
      {/* pincel com ponta de jade */}
      <path d="M16.9 5.8c.6-.6 1.6.3 1 1l-5.7 6.4-1.6-1.6Z" fill="#F4ECFF" stroke="#2a0d66" strokeWidth=".5" strokeLinejoin="round" />
      <path d="M10.6 11.6l1.6 1.6c-.3 1.9-1.6 3.4-4.6 3.6.9-1 .6-2.6 1-3.6.4-1 1.2-1.5 2-1.6Z" fill={`url(#ab${u})`} stroke="#063d2a" strokeWidth=".5" strokeLinejoin="round" />
      {/* brilhos */}
      <path d="M7.4 6.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5Z" fill="#fff" />
      <path d="M16.4 14.6l.35.9.9.35-.9.35-.35.9-.35-.9-.9-.35.9-.35Z" fill="#fff" opacity=".85" />
    </svg>
  )
}

function Badge({ b }: { b: BadgeInfo }) {
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const below = r.top < 110 // perto do topo: o cartão abre para baixo
    setAt({ x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130), y: below ? r.bottom + 10 : r.top - 10, below })
  }
  const hide = () => setAt(null)
  return (
    <span ref={ref} className={`kbadge ${b.id}`} tabIndex={0} role="img" aria-label={`${b.title}: ${b.text}`}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
      onClick={(e) => { e.stopPropagation(); if (at) hide(); else show() }}>
      <BadgeIcon id={b.id} />
      {at && createPortal(
        <span className={`kbadge-card ${b.id}${at.below ? ' below' : ''}`} role="tooltip" style={{ left: at.x, top: at.y }}>
          <span className="kbadge-card-icon"><BadgeIcon id={b.id} size={40} /></span>
          <span className="kbadge-card-text"><strong>{b.title}</strong><span>{b.text}</span></span>
        </span>, document.body,
      )}
    </span>
  )
}

/** Fileira de insígnias de alguém (nada se não tiver). */
export function Badges({ username }: { username?: string | null }) {
  const role = useApp((s) => (username ? s.staff[username] : undefined))
  const list = badgesOf(username, role)
  if (!list.length) return null
  return <span className="kbadges">{list.map((b) => <Badge key={b.id} b={b} />)}</span>
}
