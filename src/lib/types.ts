export type Status = 'online' | 'idle' | 'dnd' | 'invisible'
export type Role = 'owner' | 'admin' | 'member'
export type ChannelKind = 'text' | 'voice' | 'dm' | 'group'

export interface Profile {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  banner_url: string | null
  accent_color: string
  bio: string
  status: Status
  custom_status: string
  onboarded: boolean
  created_at: string
  pronoun?: 'ele' | 'ela' | null
  /** bundle da loja equipado (moldura da foto e do card) */
  equipped_bundle?: string | null
}
export interface Server {
  id: string
  name: string
  icon_url: string | null
  owner_id: string
  invite_code: string
  created_at: string
  description?: string
  default_notify?: NotifyLevel
  everyone_role?: 'all' | 'admins'
  welcome_channel?: string | null
}
export type NotifyLevel = 'all' | 'mentions' | 'none'
export interface NotifyPref { level: NotifyLevel | null; suppress_everyone: boolean }
export interface Member {
  server_id: string
  user_id: string
  role: Role
  joined_at: string
}
export interface Channel {
  id: string
  server_id: string | null
  kind: ChannelKind
  name: string
  topic: string
  category: string
  position: number
  dm_key: string | null
  owner_id: string | null
  last_message_at: string | null
  created_at: string
  slowmode?: number
}
export interface Attachment {
  url: string
  name: string
  size: number
  type: string
  width?: number
  height?: number
}
export interface Reaction {
  emoji: string
  user_id: string
}
export interface Message {
  id: string
  channel_id: string
  author_id: string
  content: string
  attachments: Attachment[]
  reply_to: string | null
  pinned: boolean
  edited_at: string | null
  created_at: string
  reactions: Reaction[]
  bot?: 'prisma' | 'welcome' | null
  pending?: boolean
  failed?: boolean
}
export interface Friendship {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
}
export interface CustomEmoji {
  id: string
  server_id: string
  name: string
  url: string
  created_by: string | null
}
export interface DmMember {
  channel_id: string
  user_id: string
}

export type BundleStatus = 'pending' | 'approved' | 'rejected' | 'archived'
export interface Bundle {
  id: string
  artist_id: string
  name: string
  description: string
  avatar_frame: string
  card_frame: string
  asked_cents: number
  price_cents: number
  status: BundleStatus
  review_note: string
  reviewed_at: string | null
  sales: number
  created_at: string
  updated_at: string
}
export type StaffRole = 'dev' | 'artist'
