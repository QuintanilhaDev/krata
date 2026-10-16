// Menções: @você, @everyone/@todos (todo mundo do servidor) e @here/@aqui (quem está online).
import type { Member, Server } from './types'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const mentionsUser = (content: string, username: string) => !!username && new RegExp(`(^|\\s)@${esc(username)}(?![a-z0-9_.])`, 'i').test(content)
/** "everyone", "here" ou nada. */
export function massMention(content: string): 'everyone' | 'here' | null {
  if (/(^|\s)@(everyone|todos)(?![a-z0-9_.])/i.test(content)) return 'everyone'
  if (/(^|\s)@(here|aqui)(?![a-z0-9_.])/i.test(content)) return 'here'
  return null
}
/** Quem pode chamar todo mundo: donos e admins (ou todos, se o servidor liberar). */
export function canMassPing(server: Server | undefined, authorId: string, members: Member[] | undefined): boolean {
  if (!server) return false
  if (server.everyone_role === 'all') return true
  if (server.owner_id === authorId) return true
  return !!members?.some((m) => m.user_id === authorId && (m.role === 'owner' || m.role === 'admin'))
}
export const MASS_NAMES = ['everyone', 'here', 'todos', 'aqui']
