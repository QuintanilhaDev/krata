import { X } from 'lucide-react'
import { Component, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { safeMediaUrl } from '../lib/supabase'
import type { Profile, Status } from '../lib/types'
import { useApp } from '../store/app'

const HUES = [158, 172, 142, 190, 128, 205, 96, 36]
export function hueFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}
export const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export const STATUS_LABEL: Record<Status | 'offline', string> = {
  online: 'Disponível', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline',
}

export function StatusDot({ status }: { status: Status | 'offline' }) {
  return <span className={`status-dot st-${status}`} role="img" aria-label={STATUS_LABEL[status]} />
}

interface AvatarProps {
  profile?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null
  url?: string | null
  name?: string
  seed?: string
  size?: number
  status?: Status | 'offline'
  speaking?: boolean
  square?: boolean
}
export function Avatar({ profile, url, name, seed, size = 40, status, speaking, square }: AvatarProps) {
  const label = name ?? profile?.display_name ?? '?'
  const src = safeMediaUrl(url ?? profile?.avatar_url)
  const style: CSSProperties = { width: size, height: size, fontSize: Math.max(10, size * 0.38), ['--h' as string]: hueFor(seed ?? profile?.id ?? label) }
  return (
    <span className={`avatar${square ? ' square' : ''}${speaking ? ' speaking' : ''}`} style={style}>
      {src ? <img src={src} alt="" draggable={false} loading="lazy" /> : <span className="avatar-fallback" aria-hidden="true">{initials(label)}</span>}
      {status && <StatusDot status={status} />}
    </span>
  )
}

export function Modal({ title, onClose, children, wide, bare, label }: { title?: string; onClose: () => void; children: ReactNode; wide?: boolean; bare?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('[autofocus], input:not([type=file]), textarea, select, button:not(.modal-close)')
    ;(first || el)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null)
        if (!items.length) return
        const a = items[0], z = items[items.length - 1]
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className={`modal${wide ? ' wide' : ''}${bare ? ' bare' : ''}`} role="dialog" aria-modal="true" aria-label={title || label} tabIndex={-1}>
        {!bare && (
          <header className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn modal-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
          </header>
        )}
        {children}
      </div>
    </div>
  )
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  )
}

/** Marca do Krata: uma pedra de jade lapidada. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="logo-mark">
      <polygon points="24,3 42,14 24,22 6,14" fill="#5BE3B4" />
      <polygon points="6,14 24,22 24,45 6,33" fill="#00A86B" />
      <polygon points="42,14 24,22 24,45 42,33" fill="#0A6B4A" />
      <polygon points="24,3 33,8.5 24,13 15,8.5" fill="#C9F7E4" opacity=".75" />
    </svg>
  )
}

/** Pedra de jade em 3D (CSS puro), usada no login e nas telas de espera. */
export function Gem({ size = 180, className = '' }: { size?: number; className?: string }) {
  const n = 8
  const a = size * 0.36            // apótema da base
  const top = size * 0.3           // altura da coroa
  const bottom = size * 0.62       // altura do pavilhão
  const w = 2 * a * Math.tan(Math.PI / n) + 1
  const face = (i: number, up: boolean) => {
    const h = up ? top : bottom
    const slant = Math.sqrt(a * a + h * h)
    const tilt = (Math.atan(a / h) * 180) / Math.PI
    const light = 30 + ((i * 37 + (up ? 0 : 19)) % 5) * 7 + (up ? 12 : 0)
    return (
      <i key={`${up}${i}`} style={{
        width: w, height: slant, left: `calc(50% - ${w / 2}px)`,
        top: up ? `calc(50% - ${slant}px - ${size * 0.08}px)` : `calc(50% - ${size * 0.08}px)`,
        transformOrigin: up ? '50% 100%' : '50% 0%',
        transform: `rotateY(${i * (360 / n)}deg) translateZ(${a}px) rotateX(${up ? tilt : -tilt}deg)`,
        clipPath: up ? 'polygon(50% 0, 0 100%, 100% 100%)' : 'polygon(0 0, 100% 0, 50% 100%)',
        background: `linear-gradient(${up ? 180 : 0}deg, hsl(158 ${up ? 78 : 86}% ${light + 16}%), hsl(160 92% ${light - 8}%))`,
      }} />
    )
  }
  return (
    <div className={`gem ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <div className="gem-spin">
        {Array.from({ length: n }, (_, i) => face(i, true))}
        {Array.from({ length: n }, (_, i) => face(i, false))}
      </div>
      <div className="gem-glow" />
    </div>
  )
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return <div className="spinner" role="status" aria-label={label}><Gem size={56} /></div>
}

/** Inclina o conteúdo em 3D acompanhando o ponteiro. */
export function Tilt({ children, className = '', max = 9 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const reset = () => { ref.current?.style.setProperty('--rx', '0deg'); ref.current?.style.setProperty('--ry', '0deg') }
  const move = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el || e.pointerType === 'touch') return
    // sobre botões e campos a carta fica parada, para o alvo não se mexer na hora do clique
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, label')) { reset(); return }
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--rx', `${(-y * max).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${(x * max).toFixed(2)}deg`)
    el.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`)
    el.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`)
  }
  return <div ref={ref} className={`tilt ${className}`} onPointerMove={move} onPointerLeave={reset}>{children}</div>
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => { document.addEventListener('mousedown', down); document.addEventListener('keydown', key) }, 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [ref, onClose, active])
}

/** Se uma parte da tela quebrar, mostra um aviso no lugar em vez de derrubar o app inteiro. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.error('[krata] erro na interface', error) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="crash" role="alert">
        <strong>{this.props.label || 'Esta parte da tela não carregou.'}</strong>
        <button className="btn ghost small" onClick={() => this.setState({ failed: false })}>Tentar de novo</button>
      </div>
    )
  }
}
