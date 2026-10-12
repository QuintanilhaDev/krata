import { create } from 'zustand'
import type { Channel, CustomEmoji, DmMember, Friendship, Member, Message, Profile, Role, Server, Status } from '../lib/types'

export interface Nav { serverId: string | null; channelId: string | null }
export interface MsgList { items: Message[]; hasMore: boolean; loaded: boolean; loading: boolean }
export interface Toast { id: number; text: string; kind: 'info' | 'error' | 'ok' }
export interface Upload { id: string; channelId: string; name: string; size: number; progress: number; abort: () => void }

export type ModalState =
  | { type: 'createServer' }
  | { type: 'joinServer'; code?: string }
  | { type: 'serverSettings'; serverId: string }
  | { type: 'channel'; serverId: string; channel?: Channel; kind?: 'text' | 'voice'; category?: string }
  | { type: 'settings'; tab?: string }
  | { type: 'profile'; userId: string }
  | { type: 'newDm' }
  | { type: 'invite'; serverId: string }
  | { type: 'switcher' }
  | { type: 'screenShare' }
  | { type: 'image'; url: string; name: string }
  | { type: 'pins'; channelId: string }
  | { type: 'search'; channelId: string; query?: string }
  | { type: 'confirm'; title: string; text: string; action: string; danger?: boolean; onConfirm: () => void | Promise<void> }

export interface AppState {
  booting: boolean
  userId: string | null
  me: Profile | null
  profiles: Record<string, Profile>
  servers: Server[]
  channels: Channel[]
  members: Record<string, Member[]>
  roles: Record<string, Role>
  dmMembers: DmMember[]
  friends: Friendship[]
  emojis: Record<string, CustomEmoji>
  messages: Record<string, MsgList>
  replyCache: Record<string, Message | null>
  unread: Record<string, number>
  online: Record<string, { status: Status; voice: boolean }>
  typing: Record<string, Record<string, number>>
  uploads: Upload[]
  nav: Nav
  homeTab: 'online' | 'all' | 'pending' | 'add'
  mobileNav: boolean
  showMembers: boolean
  modal: ModalState | null
  toasts: Toast[]
  replyingTo: Record<string, string | null>
  editing: string | null
  connection: 'ok' | 'reconnecting'
  structureLoaded: boolean
}

export const initialState: AppState = {
  booting: true,
  userId: null,
  me: null,
  profiles: {},
  servers: [],
  channels: [],
  members: {},
  roles: {},
  dmMembers: [],
  friends: [],
  emojis: {},
  messages: {},
  replyCache: {},
  unread: {},
  online: {},
  typing: {},
  uploads: [],
  nav: { serverId: null, channelId: null },
  homeTab: 'online',
  mobileNav: true,
  showMembers: typeof window !== 'undefined' ? window.innerWidth > 1100 : true,
  modal: null,
  toasts: [],
  replyingTo: {},
  editing: null,
  connection: 'ok',
  structureLoaded: false,
}

export const useApp = create<AppState>(() => ({ ...initialState }))
export const get = useApp.getState
export const set = useApp.setState

let toastId = 1
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = toastId++
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }))
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3500)
}
export const openModal = (modal: ModalState | null) => set({ modal })
export const closeModal = () => set({ modal: null })

// ---- seletores usados em vários lugares ---------------------------------
export function dmPartnerIds(s: AppState, channelId: string): string[] {
  return s.dmMembers.filter((m) => m.channel_id === channelId && m.user_id !== s.userId).map((m) => m.user_id)
}
export function channelTitle(s: AppState, c: Channel | undefined): string {
  if (!c) return ''
  if (c.kind === 'text' || c.kind === 'voice') return c.name
  const names = dmPartnerIds(s, c.id).map((id) => s.profiles[id]?.display_name || 'Usuário')
  if (c.kind === 'dm') return names[0] || 'Conversa'
  return c.name || names.join(', ') || 'Grupo'
}
export function presenceOf(s: AppState, userId: string): Status | 'offline' {
  if (userId === s.userId) return s.me?.status === 'invisible' ? 'offline' : s.me?.status || 'online'
  const o = s.online[userId]
  if (!o || o.status === 'invisible') return 'offline'
  return o.status
}
export function myRole(s: AppState, serverId: string | null) {
  if (!serverId) return null
  return s.roles[serverId] ?? null
}
export function friendIds(s: AppState): string[] {
  return s.friends.filter((f) => f.status === 'accepted').map((f) => (f.requester_id === s.userId ? f.addressee_id : f.requester_id))
}
