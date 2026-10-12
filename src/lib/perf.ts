// Desempenho: descobre se o aparelho é forte, médio ou fraco e ajusta os efeitos para o Krata
// ficar fluido em qualquer um (sem tirar as animações 3D — só deixa elas mais baratas).
// Também tem um único laço de animação para todos os efeitos (em vez de um por diamante).

export type Tier = 'high' | 'mid' | 'low'
const KEY = 'krata-perf'

function detect(): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  const cores = nav.hardwareConcurrency || 4
  const mem = nav.deviceMemory || 4
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))
  if (nav.connection?.saveData) return 'low'
  if (mobile) return cores >= 8 && mem >= 6 ? 'mid' : 'low'
  return cores >= 8 && mem >= 8 ? 'high' : cores >= 4 ? 'mid' : 'low'
}

export type PerfChoice = 'auto' | Tier
const isTier = (t: unknown): t is Tier => t === 'high' || t === 'mid' || t === 'low'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }

/** Escolha da pessoa nas configurações (padrão: automático). */
export function perfChoice(): PerfChoice { const c = read(KEY); return isTier(c) ? c : 'auto' }
function autoTier(): Tier { const a = read(KEY + '-auto'); return isTier(a) ? a : detect() }
export let tier: Tier = perfChoice() === 'auto' ? autoTier() : (perfChoice() as Tier)

export function applyPerf() { document.documentElement.dataset.perf = tier }
export function setPerfChoice(c: PerfChoice) {
  write(KEY, c === 'auto' ? null : c)
  if (c === 'auto') write(KEY + '-auto', null)
  tier = c === 'auto' ? detect() : c
  applyPerf()
}
function setTier(t: Tier) {
  tier = t
  applyPerf()
  write(KEY + '-auto', t)
}

/** Mede a fluidez por alguns segundos; se o aparelho não acompanhar, baixa um degrau. */
export function watchSmoothness(ms = 5000) {
  if (tier === 'low' || perfChoice() !== 'auto') return
  let frames = 0, slow = 0, last = performance.now()
  const end = last + ms
  const step = (now: number) => {
    const dt = now - last
    last = now
    if (!document.hidden && dt < 500) { frames++; if (dt > 24) slow++ }
    if (now < end) requestAnimationFrame(step)
    else if (frames > 30 && slow / frames > 0.25) setTier(tier === 'high' ? 'mid' : 'low')
  }
  requestAnimationFrame(step)
}

// ------------------------------------------------------------------ laço único de animação
interface Ticker { fn: (now: number, dt: number) => void; interval: number; last: number }
const tickers = new Set<Ticker>()
let raf = 0
function loop(now: number) {
  raf = tickers.size ? requestAnimationFrame(loop) : 0
  if (document.hidden) return
  // transmitindo a tela: efeitos decorativos a no máximo 15 quadros/s (sobra processador para o vídeo)
  const floor = document.documentElement.dataset.sharing === '1' ? 66 : 0
  for (const t of tickers) {
    const dt = now - t.last
    if (dt + 2 < Math.max(t.interval, floor)) continue // este efeito pede menos quadros por segundo
    t.last = now
    t.fn(now, Math.min(0.05, dt / 1000))
  }
}
/** Registra um efeito no laço único; devolve a função que tira ele. `fps` limita os quadros. */
export function onFrame(fn: (now: number, dt: number) => void, fps = 60): () => void {
  const t: Ticker = { fn, interval: 1000 / fps, last: performance.now() }
  tickers.add(t)
  if (!raf) raf = requestAnimationFrame(loop)
  return () => { tickers.delete(t) }
}

/** Quadros por segundo de um efeito decorativo conforme o aparelho e o tamanho. */
export function effectFps(size: number): number {
  const big = size >= 70
  if (tier === 'high') return big ? 60 : 40
  if (tier === 'mid') return big ? 45 : 30
  return big ? 30 : 20
}
