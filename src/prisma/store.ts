import { create } from 'zustand'

export interface ChatTurn { role: 'user' | 'assistant'; content: string; at: number }
export type PanelState =
  | { kind: 'upload'; target: 'avatar' | 'banner' | 'server_icon' | 'emoji'; title: string; serverId?: string; emojiName?: string }
  | { kind: 'confirm'; title: string; text: string; action: string; danger?: boolean; onYes: () => void | Promise<void> }
  | { kind: 'screen'; quality?: string }
  | { kind: 'link'; title: string; url: string }
  | { kind: 'list'; title: string; items: string[] }

export interface PrismaState {
  ready: boolean
  /** a fadinha está fora do botão (voando ou parada perto de algo) */
  out: boolean
  mood: 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'error'
  listening: boolean          // escuta contínua ligada
  canListen: boolean          // navegador suporta escuta contínua
  recording: boolean          // gravando no "toque para falar"
  bubble: string | null
  panel: PanelState | null
  chatOpen: boolean
  chat: ChatTurn[]
  server: { groq: boolean; stt: boolean; tts: boolean; channelBot: boolean; used: number; limit: number } | null
  captions: boolean
}

const saved = (() => { try { return JSON.parse(localStorage.getItem('krata-prisma-chat') || '[]') as ChatTurn[] } catch { return [] } })()

export const usePrisma = create<PrismaState>(() => ({
  ready: false, out: false, mood: 'idle', listening: false, canListen: false, recording: false, bubble: null, panel: null,
  chatOpen: false, chat: saved, server: null,
  captions: (() => { try { return localStorage.getItem('krata-prisma-captions') !== 'off' } catch { return true } })(),
}))
export const pget = usePrisma.getState
export const pset = usePrisma.setState

export function pushChat(role: ChatTurn['role'], content: string) {
  pset((s) => {
    const chat = [...s.chat, { role, content, at: Date.now() }].slice(-40)
    try { localStorage.setItem('krata-prisma-chat', JSON.stringify(chat)) } catch { /* sem armazenamento */ }
    return { chat }
  })
}
export function clearChat() {
  pset({ chat: [] })
  try { localStorage.removeItem('krata-prisma-chat') } catch { /* sem armazenamento */ }
}
