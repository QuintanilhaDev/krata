// Preferência de animação e posição do ponteiro, compartilhadas pelas peças 3D.

export type MotionLevel = 'full' | 'reduced'
const KEY = 'krata-motion'

export function motionLevel(): MotionLevel {
  try { return localStorage.getItem(KEY) === 'reduced' ? 'reduced' : 'full' } catch { return 'full' }
}
export function applyMotion(level: MotionLevel = motionLevel()) {
  document.documentElement.dataset.motion = level
}
export function setMotion(level: MotionLevel) {
  try { localStorage.setItem(KEY, level) } catch { /* sem armazenamento */ }
  applyMotion(level)
}
export const reduced = () => document.documentElement.dataset.motion === 'reduced'

/** Posição do ponteiro na janela, de -1 a 1 em cada eixo (0,0 = centro). */
export const pointer = { x: 0, y: 0, px: -9999, py: -9999, active: false }
let listening = false
export function trackPointer() {
  if (listening || typeof window === 'undefined') return
  listening = true
  const move = (e: PointerEvent) => {
    pointer.px = e.clientX
    pointer.py = e.clientY
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1
    pointer.active = true
  }
  window.addEventListener('pointermove', move, { passive: true })
  window.addEventListener('pointerdown', move, { passive: true })
  document.addEventListener('pointerleave', () => { pointer.active = false })
}
