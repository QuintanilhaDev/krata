// Versão nova do site publicada: o app Android (e abas que ficam abertas dias) não recarregam
// sozinhos. Ao voltar para o Krata, confere se o site mudou e recarrega na hora certa
// (nunca no meio de uma chamada ou com texto sendo digitado).
import { useVoice } from '../voice/engine'

const current = () => [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => new URL(s.src, location.href).pathname).sort().join('|')
let mine = ''
let checking = false
let lastCheck = 0

async function latest(): Promise<string | null> {
  try {
    const r = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const html = await r.text()
    const list = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], location.href).pathname).sort()
    return list.length ? list.join('|') : null
  } catch { return null }
}

const busy = () => {
  if (useVoice.getState().channelId) return true
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && !!el.value
}

async function check() {
  if (checking || Date.now() - lastCheck < 30_000 || !mine) return
  checking = true; lastCheck = Date.now()
  const now = await latest()
  checking = false
  if (!now || now === mine) return
  if (busy()) { lastCheck = 0; return } // tenta de novo na próxima volta
  location.reload()
}

export function watchFreshness() {
  mine = current()
  if (!mine) return
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check() })
  window.addEventListener('focus', () => void check())
  setInterval(() => { if (document.visibilityState === 'visible' && !busy()) void check() }, 10 * 60_000)
}
