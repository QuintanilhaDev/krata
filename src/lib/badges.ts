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
  drawgoa: ['artist'],
}

/** Insígnias da pessoa: as fixas acima + "Artista Oficial" para quem o desenvolvedor credenciou na loja (tabela staff). */
export const badgesOf = (username?: string | null, staffRole?: string | null): BadgeInfo[] => {
  if (!username) return []
  const ids = [...(BY_USER[username] || [])]
  if (staffRole === 'artist' && !ids.includes('artist')) ids.push('artist')
  return ids.map((b) => BADGES[b])
}
