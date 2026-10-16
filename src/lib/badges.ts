// Insígnias do Krata (aparecem no perfil, ao lado do nome de usuário).
// Por enquanto são dadas pelo nome de usuário, que não muda depois do cadastro.
export type BadgeId = 'founder' | 'artist'

export interface BadgeInfo { id: BadgeId; title: string; text: string }

export const BADGES: Record<BadgeId, BadgeInfo> = {
  founder: { id: 'founder', title: 'Fundador do Krata', text: 'Criou o Krata. A primeira pedra de jade.' },
  artist: { id: 'artist', title: 'Artista Oficial', text: 'Credenciado pelo Krata para criar bundles da loja.' },
}

const BY_USER: Record<string, BadgeId[]> = {
  bones: ['founder'],
  novacombos: ['artist'],
}

export const badgesOf = (username?: string | null): BadgeInfo[] => (username ? (BY_USER[username] || []).map((b) => BADGES[b]) : [])
