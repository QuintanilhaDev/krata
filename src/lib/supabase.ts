import { createClient, type RealtimeChannel, type RealtimeChannelOptions, type SupabaseClient } from '@supabase/supabase-js'

const env = import.meta.env
export const SUPABASE_URL: string = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
export const SUPABASE_KEY: string = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
export const isConfigured = /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_KEY.length > 20

export const supabase: SupabaseClient = createClient(
  isConfigured ? SUPABASE_URL : 'http://localhost:54321',
  isConfigured ? SUPABASE_KEY : 'missing-key-missing-key-missing-key',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'krata-auth' },
    realtime: { params: { eventsPerSecond: 40 } },
  },
)

const closing = new Map<string, Promise<unknown>>()
/** Fecha um canal de tempo real e lembra que ele está fechando. */
export function dropChannel(ch: RealtimeChannel | null | undefined): Promise<unknown> {
  if (!ch) return Promise.resolve()
  const p = supabase.removeChannel(ch).catch(() => {})
  closing.set(ch.topic, p)
  void p.finally(() => { if (closing.get(ch.topic) === p) closing.delete(ch.topic) })
  return p
}
/**
 * Abre um canal novo. Se um canal com o mesmo nome ainda está fechando, espera terminar:
 * sem isso o cliente devolveria o canal antigo, que nunca mais conecta.
 */
export async function openChannel(name: string, opts?: RealtimeChannelOptions): Promise<RealtimeChannel> {
  const topic = `realtime:${name}`
  await closing.get(topic)
  const stale = supabase.getChannels().find((c) => c.topic === topic)
  if (stale) await dropChannel(stale)
  // canais privados: o Supabase confere as regras de quem pode entrar (seção 7 do schema.sql)
  return supabase.channel(name, { ...opts, config: { ...opts?.config, private: true } })
}

const STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`
/** Só mostra imagens e vídeos que estão no Storage do próprio projeto (evita rastreamento por links externos). */
export const safeMediaUrl = (url?: string | null): string | null =>
  url && url.startsWith(STORAGE_PREFIX) && !/[\s"'()\\<>]/.test(url) ? url : null

/** O Supabase identifica contas por e-mail; o Krata usa um e-mail interno a partir do nome de usuário. */
export const USER_DOMAIN = 'users.krata.app'
export const loginEmail = (username: string) => `${username.trim().toLowerCase()}@${USER_DOMAIN}`
export const USERNAME_RX = /^[a-z0-9_.]{3,20}$/

/** Servidores ICE: STUN público + TURN opcional (recomendado em produção). */
export function iceServers(): RTCIceServer[] {
  const list: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
  const urls = (env.VITE_TURN_URLS || '').split(',').map((s: string) => s.trim()).filter(Boolean)
  if (urls.length) list.push({ urls, username: env.VITE_TURN_USERNAME || '', credential: env.VITE_TURN_CREDENTIAL || '' })
  return list
}

/** Traduz erros do Supabase para mensagens que dizem o que fazer. */
export function errorText(e: unknown): string {
  const any = e as { message?: string; code?: string; status?: number; error_code?: string } | null
  const msg = (any?.message || String(e || '')).trim()
  const code = any?.code || any?.error_code || ''
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  if (code === 'invalid_credentials' || /Invalid login credentials/i.test(msg)) return 'Usuário ou senha incorretos.'
  if (code === 'user_already_exists' || /already registered|already been registered/i.test(msg)) return 'Esse nome de usuário já está em uso. Escolha outro.'
  if (code === 'weak_password' || /Password should be|weak password/i.test(msg)) return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.'
  if (code === 'email_not_confirmed' || /Email not confirmed/i.test(msg)) return 'No Supabase, desligue "Confirm email" (Authentication → Providers → Email) para o login funcionar.'
  if (code === 'over_request_rate_limit' || /rate limit|too many/i.test(msg)) return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
  if (/Database error saving new user/i.test(msg)) return 'Não foi possível criar a conta. Confira o nome de usuário e tente de novo.'
  if (/Signups not allowed|signup.*disabled/i.test(msg)) return 'O cadastro de contas está desativado no Supabase.'
  if (code === 'same_password' || /should be different/i.test(msg)) return 'A nova senha precisa ser diferente da atual.'
  if (code === '23505' && /username/i.test(msg)) return 'Esse nome de usuário já está em uso. Escolha outro.'
  if (code === '23505') return 'Isso já existe.'
  if (code === '23514') return 'Algum campo está fora do formato permitido.'
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Você não tem permissão para fazer isso.'
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Sua sessão expirou. Entre de novo.'
  return msg || 'Algo deu errado. Tente de novo.'
}
