// Voo da Prisma pela tela: ela sai do botão dela, voa em curva até o botão certo,
// "toca" nele e volta. Tudo com requestAnimationFrame e transformações 3D.
import { reduced } from '../lib/motion'
import { get as app, set as setApp } from '../store/app'
import { pget, pset } from './store'

let sprite: HTMLDivElement | null = null
let layer: HTMLDivElement | null = null
const pos = { x: -100, y: -100 }
let flying = false

export function registerSprite(el: HTMLDivElement | null, trailLayer: HTMLDivElement | null) {
  sprite = el
  layer = trailLayer
}

const isVisible = (el: Element | null): boolean => {
  if (!el || !(el as HTMLElement).isConnected) return false
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false
  const st = getComputedStyle(el)
  return st.visibility !== 'hidden' && st.display !== 'none'
}

/** Onde a Prisma "mora": o botão de início (computador) ou o botão flutuante (celular). */
export function homeElement(): HTMLElement | null {
  const home = document.querySelector('[data-prisma="home"]')
  if (isVisible(home)) return home as HTMLElement
  const fab = document.querySelector('[data-prisma="fab"]')
  if (isVisible(fab)) return fab as HTMLElement
  return null
}
const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
const homePoint = () => {
  const h = homeElement()
  return h ? center(h.getBoundingClientRect()) : { x: innerWidth - 44, y: innerHeight - 120 }
}

function place(x: number, y: number, extra = '') {
  pos.x = x; pos.y = y
  if (sprite) sprite.style.transform = `translate3d(${x - 22}px, ${y - 22}px, 0) ${extra}`
}

function spark(x: number, y: number, burst = false) {
  if (!layer || reduced()) return
  const s = document.createElement('i')
  s.className = burst ? 'prisma-spark burst' : 'prisma-spark'
  const dx = (Math.random() - 0.5) * (burst ? 120 : 18), dy = (Math.random() - 0.5) * (burst ? 120 : 18) + (burst ? 0 : 10)
  s.style.left = `${x}px`; s.style.top = `${y}px`
  s.style.setProperty('--dx', `${dx}px`); s.style.setProperty('--dy', `${dy}px`)
  s.style.setProperty('--h', String(150 + Math.random() * 25))
  layer.appendChild(s)
  setTimeout(() => s.remove(), burst ? 900 : 700)
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function flyPath(to: { x: number; y: number }, ms?: number): Promise<void> {
  const from = { ...pos }
  const dx = to.x - from.x, dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  const dur = ms ?? (reduced() ? 260 : Math.max(650, Math.min(1500, 450 + dist * 0.75)))
  // curva: dois pontos de controle desviados para o lado, como um voo de fada
  const side = Math.random() < 0.5 ? -1 : 1
  const nx = -dy / (dist || 1), ny = dx / (dist || 1)
  const bend = Math.min(220, dist * 0.35) * side
  const c1 = { x: from.x + dx * 0.25 + nx * bend, y: from.y + dy * 0.25 + ny * bend - 40 }
  const c2 = { x: from.x + dx * 0.75 + nx * bend * 0.6, y: from.y + dy * 0.75 + ny * bend * 0.6 - 30 }
  return new Promise((resolve) => {
    const t0 = performance.now()
    let lastX = from.x, lastSpark = 0
    flying = true
    sprite?.classList.add('flying')
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur)
      const e = ease(t)
      const u = 1 - e
      const x = u * u * u * from.x + 3 * u * u * e * c1.x + 3 * u * e * e * c2.x + e * e * e * to.x
      const y = u * u * u * from.y + 3 * u * u * e * c1.y + 3 * u * e * e * c2.y + e * e * e * to.y
      const wobble = Math.sin(now / 90) * 3 * (1 - Math.abs(0.5 - t) * 2)
      const bank = Math.max(-28, Math.min(28, (x - lastX) * 2.2))
      const scale = 1 + Math.sin(Math.PI * t) * 0.35
      lastX = x
      place(x, y + wobble, `rotateZ(${bank.toFixed(1)}deg) scale(${scale.toFixed(3)})`)
      if (now - lastSpark > 22) { spark(x, y); lastSpark = now }
      if (t < 1) requestAnimationFrame(step)
      else { flying = false; sprite?.classList.remove('flying'); place(to.x, to.y); resolve() }
    }
    requestAnimationFrame(step)
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 120) : ms))

/** Sai do botão (se ainda estiver dentro dele). */
async function leaveHome() {
  if (pget().out) return
  const p = homePoint()
  place(p.x, p.y)
  pset({ out: true })
  sprite?.classList.add('show')
  await wait(30)
  // pulinho para fora
  await flyPath({ x: p.x + 26, y: p.y + 18 }, reduced() ? 120 : 320)
}

/** Garante que o alvo esteja na tela (abre o menu no celular, rola listas). */
async function reveal(el: HTMLElement): Promise<HTMLElement | null> {
  if (!isVisible(el)) {
    if (el.closest('.nav-col') && innerWidth <= 820 && !app().mobileNav) { setApp({ mobileNav: true }); await wait(420) }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
    await wait(320)
  }
  return isVisible(el) ? el : null
}

export async function flyTo(target: Element | string | null): Promise<HTMLElement | null> {
  let el: HTMLElement | null
  if (typeof target === 'string') {
    const all = [...document.querySelectorAll<HTMLElement>(target)]
    el = all.find((x) => isVisible(x)) || all[0] || null
  } else el = target as HTMLElement | null
  await leaveHome()
  if (!el) return null
  const shown = await reveal(el)
  if (!shown) return null
  const r = shown.getBoundingClientRect()
  // para um pouco acima e à direita do botão, para não cobrir o que ela vai tocar
  const to = { x: Math.min(innerWidth - 26, r.right + 4), y: Math.max(26, r.top - 4) }
  if (to.x > innerWidth - 30) to.x = r.left - 8
  await flyPath(to)
  return shown
}

/** Encosta no alvo: mergulhinho, onda de luz e brilho no botão. */
export async function tap(el: HTMLElement | null) {
  if (!el) return
  const r = el.getBoundingClientRect()
  const c = center(r)
  const back = { ...pos }
  await flyPath({ x: c.x + 6, y: c.y - 6 }, reduced() ? 100 : 220)
  el.classList.add('prisma-hit')
  if (layer && !reduced()) {
    const ring = document.createElement('i')
    ring.className = 'prisma-ring'
    ring.style.left = `${c.x}px`; ring.style.top = `${c.y}px`
    layer.appendChild(ring)
    setTimeout(() => ring.remove(), 800)
  }
  setTimeout(() => el.classList.remove('prisma-hit'), 900)
  await flyPath(back, reduced() ? 100 : 240)
}

export async function goHome() {
  if (!pget().out) return
  await wait(250)
  const p = homePoint()
  await flyPath(p)
  sprite?.classList.remove('show')
  pset({ out: false })
}

export function celebrate() {
  const p = pget().out ? pos : homePoint()
  for (let i = 0; i < 26; i++) setTimeout(() => spark(p.x, p.y, true), i * 14)
}
export function shake() {
  sprite?.classList.remove('shake')
  void sprite?.offsetWidth
  sprite?.classList.add('shake')
}

// um voo de cada vez: boas-vindas e pedidos seguidos não brigam pela fadinha
let chain: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

/** Fluxo completo: voa até o alvo, toca, executa a ação e volta para casa. */
export function visit<T>(target: string | Element | null, action: () => Promise<T>, opts: { stay?: number } = {}): Promise<T> {
  if (!sprite) return action()
  return exclusive(() => visitNow(target, action, opts))
}
async function visitNow<T>(target: string | Element | null, action: () => Promise<T>, opts: { stay?: number }): Promise<T> {
  const el = await flyTo(target)
  await tap(el)
  let result: T
  try { result = await action() } catch (e) { shake(); await goHome(); throw e }
  await wait(opts.stay ?? 380)
  await goHome()
  return result
}

/** Aparece no meio da tela (boas-vindas e respostas importantes) e volta. */
export function showOff(ms = 2600): Promise<void> {
  if (!sprite) return Promise.resolve()
  return exclusive(() => showOffNow(ms))
}
async function showOffNow(ms: number) {
  await leaveHome()
  await flyPath({ x: innerWidth / 2, y: innerHeight * 0.42 })
  celebrate()
  await wait(ms)
  await goHome()
}

export const isFlying = () => flying
export const spritePos = () => ({ ...pos })
