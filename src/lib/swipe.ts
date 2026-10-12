// Gestos de arrastar no celular: puxa a lista de conversas da esquerda (arrastando para a
// direita em qualquer lugar), fecha arrastando para a esquerda, e abre/fecha a lista de
// membros pela direita. O painel segue o dedo e decide no fim pela distância ou velocidade.
import { useEffect, type RefObject } from 'react'
import { get, set } from '../store/app'

const NARROW = '(max-width: 820px)'
// onde arrastar para o lado já tem outro significado
const IGNORE = 'input, textarea, select, [contenteditable], .no-swipe, .tabs, pre, video, .stage-grid.strip, .emoji-picker, .modal-backdrop, .prisma-panel-veil, .prisma-chat, .vol, [role="slider"], .mention-list'

type Mode = 'open-nav' | 'close-nav' | 'open-members' | 'close-members'

export function useSwipeNav(shell: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = shell.current
    if (!root) return
    let startX = 0, startY = 0, startT = 0, lastX = 0, lastT = 0, vx = 0
    let mode: Mode | null = null
    let tracking = false
    let width = 1

    const nav = () => root.querySelector<HTMLElement>('.nav-col')
    const main = () => root.querySelector<HTMLElement>('.main')
    const members = () => root.querySelector<HTMLElement>('.members')
    const veil = () => root.querySelector<HTMLElement>('.members-veil')

    function paint(p: number) {
      // p: 0 = lista fechada, 1 = lista aberta (ou membros abertos)
      if (mode === 'open-nav' || mode === 'close-nav') {
        const n = nav(), m = main()
        if (n) { n.style.visibility = 'visible'; n.style.transform = `translateX(${(p - 1) * 102}%) rotateY(${(1 - p) * 12}deg)` }
        if (m) m.style.transform = `translateX(${p * 30}%) scale(${1 - p * 0.06})`
      } else if (mode === 'close-members') {
        const el = members()
        if (el) el.style.transform = `translateX(${(1 - p) * 100}%)`
        const v = veil()
        if (v) v.style.opacity = String(p)
      }
    }
    function clear() {
      for (const el of [nav(), main(), members(), veil()]) if (el) { el.style.transform = ''; el.style.visibility = ''; el.style.opacity = '' }
      root!.classList.remove('dragging')
    }

    const onStart = (e: TouchEvent) => {
      if (!matchMedia(NARROW).matches || e.touches.length !== 1) { tracking = false; return }
      const t = e.target as Element
      if (t.closest(IGNORE)) { tracking = false; return }
      // em chamada com o palco aberto, o arrasto fica para os vídeos
      if (root.querySelector('.stage') && !get().mobileNav) { tracking = false; return }
      const p = e.touches[0]
      startX = lastX = p.clientX; startY = p.clientY; startT = lastT = performance.now(); vx = 0
      mode = null; tracking = true; width = root.clientWidth || innerWidth
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const p = e.touches[0]
      const dx = p.clientX - startX, dy = p.clientY - startY
      const now = performance.now()
      if (now > lastT) { vx = 0.7 * vx + 0.3 * ((p.clientX - lastX) / (now - lastT)); lastX = p.clientX; lastT = now }
      if (!mode) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
        if (Math.abs(dx) < Math.abs(dy) * 1.4) { tracking = false; return } // rolagem vertical
        const s = get()
        const channel = s.channels.find((c) => c.id === s.nav.channelId)
        const membersOpen = !!members()
        if (membersOpen) mode = dx > 0 ? 'close-members' : null
        else if (s.mobileNav) mode = dx < 0 ? 'close-nav' : null
        else if (dx > 0) mode = 'open-nav'
        else if (channel && channel.kind !== 'dm' && channel.kind !== 'voice') mode = 'open-members'
        if (!mode) { tracking = false; return }
        root.classList.add('dragging')
        // soltar a seleção de texto e o toque longo que já tinham começado
        window.getSelection()?.removeAllRanges()
      }
      if (e.cancelable) e.preventDefault()
      const w = mode === 'close-members' ? (members()?.clientWidth || 300) : width * 0.86
      let prog = 0
      if (mode === 'open-nav') prog = dx / w
      else if (mode === 'close-nav') prog = 1 + dx / w
      else if (mode === 'close-members') prog = 1 - dx / w
      else prog = 0 // membros: decide no fim
      paint(Math.max(0, Math.min(1, prog)))
    }

    const onEnd = (e: TouchEvent) => {
      if (!tracking || !mode) { tracking = false; return }
      tracking = false
      const p = e.changedTouches[0]
      const dx = p.clientX - startX
      const fast = Math.abs(vx) > 0.45 && performance.now() - startT < 600
      const far = Math.abs(dx) > (mode === 'open-members' ? 70 : width * 0.3)
      const commit = (far || fast) && Math.sign(dx) === (mode === 'open-nav' || mode === 'close-members' ? 1 : -1)
      const m = mode
      mode = null
      // devolve a animação para o CSS a partir de onde o dedo parou
      root.classList.remove('dragging')
      requestAnimationFrame(() => {
        clear()
        if (!commit) return
        if (m === 'open-nav') set({ mobileNav: true })
        else if (m === 'close-nav') set({ mobileNav: false })
        else if (m === 'open-members') set({ showMembers: true })
        else set({ showMembers: false })
        navigator.vibrate?.(8)
      })
    }
    const onCancel = () => { if (mode) clear(); tracking = false; mode = null }

    root.addEventListener('touchstart', onStart, { passive: true })
    root.addEventListener('touchmove', onMove, { passive: false })
    root.addEventListener('touchend', onEnd, { passive: true })
    root.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchmove', onMove)
      root.removeEventListener('touchend', onEnd)
      root.removeEventListener('touchcancel', onCancel)
    }
  }, [shell])
}
