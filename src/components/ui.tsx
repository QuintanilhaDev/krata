import { X } from 'lucide-react'
import { Component, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { pointer, reduced, trackPointer } from '../lib/motion'
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

/**
 * Pedra de jade em 3D (CSS 3D + um laço de animação).
 * Gira sozinha, a luz das faces muda conforme ela gira, inclina na direção do mouse,
 * acelera quando o mouse chega perto, pode ser arrastada para girar (com inércia)
 * e dá um giro rápido ao ser clicada.
 */
export function Gem({ size = 180, className = '', interactive = false, speed = 1 }: { size?: number; className?: string; interactive?: boolean; speed?: number }) {
  const n = 8
  const a = size * 0.36            // apótema da base
  const top = size * 0.3           // altura da coroa
  const bottom = size * 0.62       // altura do pavilhão
  const w = 2 * a * Math.tan(Math.PI / n) + 1
  const box = useRef<HTMLDivElement>(null)
  const spin = useRef<HTMLDivElement>(null)
  const glow = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = spin.current, root = box.current
    if (!el || !root) return
    trackPointer()
    const faces = [...el.querySelectorAll<HTMLElement>('i')]
    let rotY = Math.random() * 360
    let vel = 26 * speed
    let tiltX = -14, lean = 0, lift = 0, near = 0, burst = 0
    let dragging = false, lastX = 0, dragVel = 0
    let raf = 0, last = performance.now(), frame = 0

    const hit = (x: number, y: number) => {
      const r = root.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }
    const down = (e: PointerEvent) => {
      if (!interactive || !hit(e.clientX, e.clientY)) return
      if ((e.target as HTMLElement).closest('button, a, input, textarea, select, label')) return
      dragging = true; lastX = e.clientX; dragVel = 0
      burst = 1
      vel += 420 * speed // clique: giro rápido
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      rotY += dx * 0.6
      dragVel = dx * 30
    }
    const up = () => { if (dragging) { vel += dragVel; dragging = false } }
    if (interactive) {
      window.addEventListener('pointerdown', down)
      window.addEventListener('pointermove', move, { passive: true })
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) { last = now; return }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const calm = reduced()
      const base = (calm ? 10 : 26) * speed
      // proximidade do mouse (0 longe, 1 em cima)
      let targetNear = 0, targetTilt = -14, targetLean = 0
      if (interactive && pointer.active) {
        const r = root.getBoundingClientRect()
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const dx = (pointer.px - cx) / Math.max(innerWidth, 1), dy = (pointer.py - cy) / Math.max(innerHeight, 1)
        const dist = Math.hypot(pointer.px - cx, pointer.py - cy)
        targetNear = Math.max(0, 1 - dist / (r.width * 1.6))
        targetTilt = -14 + Math.max(-1, Math.min(1, dy)) * 34
        targetLean = Math.max(-1, Math.min(1, dx)) * -22
      }
      const k = 1 - Math.exp(-dt * (calm ? 2 : 5))
      near += (targetNear - near) * k
      tiltX += (targetTilt - tiltX) * k
      lean += (targetLean - lean) * k
      if (!dragging) {
        const wanted = base * (1 + near * 3.5)
        vel += (wanted - vel) * (1 - Math.exp(-dt * 1.6))
        rotY += vel * dt
      }
      burst = Math.max(0, burst - dt * 1.4)
      lift = Math.sin(now / 1400) * (calm ? 3 : 9)
      const scale = 1 + near * 0.08 + burst * 0.1
      el.style.transform = `translateY(${lift.toFixed(2)}px) rotateX(${tiltX.toFixed(2)}deg) rotateZ(${lean.toFixed(2)}deg) rotateY(${(rotY % 360).toFixed(2)}deg) scale(${scale.toFixed(3)})`
      if (glow.current) glow.current.style.opacity = String(0.55 + near * 0.45 + burst * 0.5)
      // luz: a cada 2 quadros, as faces voltadas para a luz (alto, à esquerda) ficam mais claras
      // luz: as faces voltadas para a luz (alto, à esquerda) ficam mais claras
      if ((frame++ & 1) === 0) {
        for (let i = 0; i < faces.length; i++) {
          const upper = i < n
          const ang = ((i % n) * (360 / n) + rotY) * (Math.PI / 180)
          const facing = Math.cos(ang - 0.6) * 0.5 + 0.5
          const l = (upper ? 52 : 34) + facing * (upper ? 26 : 22) + near * 6 + burst * 14
          const color = `hsl(${upper ? 157 : 160} ${upper ? 74 : 88}% ${Math.min(88, l).toFixed(1)}%)`
          if (upper) faces[i].style.borderBottomColor = color
          else faces[i].style.borderTopColor = color
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [interactive, speed])

  // cada face é um triângulo feito com bordas (sem recortes: muito mais leve para animar em 3D)
  const face = (i: number, up: boolean) => {
    const h = up ? top : bottom
    const slant = Math.sqrt(a * a + h * h)
    const tilt = (Math.atan(a / h) * 180) / Math.PI
    const light = up ? 60 : 40
    const side = `${w / 2}px solid transparent`
    const fill = `${slant}px solid hsl(158 80% ${light}%)`
    return (
      <i key={`${up}${i}`} style={{
        width: 0, height: 0, left: `calc(50% - ${w / 2}px)`,
        top: up ? `calc(50% - ${slant}px - ${size * 0.08}px)` : `calc(50% - ${size * 0.08}px)`,
        borderLeft: side, borderRight: side,
        ...(up ? { borderBottom: fill } : { borderTop: fill }),
        transformOrigin: up ? '50% 100%' : '50% 0%',
        transform: `rotateY(${i * (360 / n)}deg) translateZ(${a}px) rotateX(${up ? tilt : -tilt}deg)`,
      }} />
    )
  }
  return (
    <div ref={box} className={`gem${interactive ? ' interactive' : ''} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <div ref={spin} className="gem-spin">
        {Array.from({ length: n }, (_, i) => face(i, true))}
        {Array.from({ length: n }, (_, i) => face(i, false))}
      </div>
      <div ref={glow} className="gem-glow" />
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

/** Lascas de jade flutuando em profundidade, com paralaxe seguindo o mouse. */
export function ShardField({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    trackPointer()
    let w = 0, h = 0, dpr = 1, raf = 0, last = performance.now()
    let mx = 0, my = 0
    const count = Math.round(70 * density)
    const shards = Array.from({ length: count }, () => ({
      x: Math.random(), y: Math.random(), z: 0.15 + Math.random() * 0.85,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.8, s: 2 + Math.random() * 5, hue: 150 + Math.random() * 20,
    }))
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth; h = canvas.clientHeight
      canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) { last = now; return }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const calm = reduced()
      const k = 1 - Math.exp(-dt * 3)
      mx += ((pointer.active ? pointer.x : 0) - mx) * k
      my += ((pointer.active ? pointer.y : 0) - my) * k
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      for (const p of shards) {
        p.y -= dt * (calm ? 0.004 : 0.016) * (0.4 + p.z)
        p.r += dt * p.vr * (calm ? 0.3 : 1)
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random() }
        const x = p.x * w - mx * 60 * p.z
        const y = p.y * h - my * 40 * p.z
        const s = p.s * (0.5 + p.z)
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(p.r)
        ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(p.r * 1.7)))
        ctx.globalAlpha = 0.12 + p.z * 0.5
        ctx.fillStyle = `hsl(${p.hue} 80% ${45 + p.z * 25}%)`
        ctx.beginPath()
        ctx.moveTo(0, -s * 1.6); ctx.lineTo(s, 0); ctx.lineTo(0, s * 1.6); ctx.lineTo(-s, 0)
        ctx.closePath(); ctx.fill()
        ctx.restore()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [density])
  return <canvas ref={ref} className="shards" aria-hidden="true" />
}

/** Atualiza --mx/--my (de -1 a 1, suavizados) no elemento, para paralaxe em CSS. */
export function useParallax(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    trackPointer()
    let raf = 0, mx = 0, my = 0, last = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const k = 1 - Math.exp(-dt * 3.5)
      mx += ((pointer.active ? pointer.x : 0) - mx) * k
      my += ((pointer.active ? pointer.y : 0) - my) * k
      const el = ref.current
      if (el) { el.style.setProperty('--mx', mx.toFixed(4)); el.style.setProperty('--my', my.toFixed(4)) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ref])
}
