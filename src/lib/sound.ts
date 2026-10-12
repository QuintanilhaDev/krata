// Sons curtos gerados no navegador (sem arquivos de áudio).
let ctx: AudioContext | null = null
export function audioCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}
function tone(freq: number, at: number, dur: number, gain = 0.07, type: OscillatorType = 'sine') {
  try {
    const c = audioCtx()
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = type
    o.frequency.value = freq
    const t = c.currentTime + at
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(c.destination)
    o.start(t)
    o.stop(t + dur + 0.02)
  } catch { /* áudio indisponível */ }
}
export const sounds = {
  message: () => { tone(880, 0, 0.12); tone(1320, 0.07, 0.16) },
  join: () => { tone(523, 0, 0.12); tone(784, 0.09, 0.2) },
  leave: () => { tone(784, 0, 0.12); tone(440, 0.09, 0.22) },
  mute: () => tone(330, 0, 0.09, 0.06, 'triangle'),
  unmute: () => tone(660, 0, 0.09, 0.06, 'triangle'),
  stream: () => { tone(659, 0, 0.1); tone(880, 0.08, 0.1); tone(1175, 0.16, 0.22) },
  ring: () => { tone(740, 0, 0.22, 0.08); tone(932, 0.24, 0.22, 0.08); tone(1109, 0.48, 0.4, 0.08) },
}
