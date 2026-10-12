// Funções compartilhadas pelas rotas da Prisma (rodam no servidor da Vercel).
// Arquivos que começam com "_" não viram rota.

export const env = (name: string) => (typeof process !== 'undefined' ? process.env[name] : undefined) || ''

export const SUPABASE_URL = () => (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/, '')
export const ANON_KEY = () => env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY') || env('VITE_SUPABASE_PUBLISHABLE_KEY')
export const SERVICE_KEY = () => env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY')
export const GROQ_BASE = () => (env('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1').replace(/\/+$/, '')
export const DAILY_LIMIT = () => Number(env('PRISMA_DAILY_LIMIT') || 40)

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })

/** Confere o login do usuário perguntando ao próprio Supabase. */
export async function authUser(request: Request): Promise<{ id: string; token: string } | null> {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '')?.[1]
  if (!token || !SUPABASE_URL()) return null
  try {
    const r = await fetch(`${SUPABASE_URL()}/auth/v1/user`, { headers: { apikey: ANON_KEY(), authorization: `Bearer ${token}` } })
    if (!r.ok) return null
    const u = (await r.json()) as { id?: string }
    return u.id ? { id: u.id, token } : null
  } catch { return null }
}

/** Chamada à API REST do Supabase com a chave de serviço (ignora as regras de acesso: use com cuidado). */
export async function admin(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL()}/rest/v1/${path}`, {
    ...init,
    // chaves novas (sb_secret_…) não são JWT: vão só no cabeçalho apikey
    headers: { apikey: SERVICE_KEY(), ...(SERVICE_KEY().startsWith('sb_') ? {} : { authorization: `Bearer ${SERVICE_KEY()}` }), 'content-type': 'application/json', ...(init.headers || {}) },
  })
}
/** Chamada à API REST com o login do próprio usuário (respeita as regras de acesso). */
export async function asUser(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL()}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON_KEY(), authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
  })
}

// limite por pessoa quando não há chave de serviço (vale só dentro da mesma instância)
const memoryQuota = new Map<string, { day: string; count: number }>()
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10) // dia em Brasília

/** Gasta uma unidade da cota diária. Devolve quantas já foram usadas, ou null se estourou. */
export async function takeQuota(userId: string): Promise<{ used: number; limit: number } | null> {
  const limit = DAILY_LIMIT()
  if (SERVICE_KEY()) {
    const r = await admin('rpc/prisma_take_quota', { method: 'POST', body: JSON.stringify({ p_user: userId, p_limit: limit }) })
    if (r.ok) {
      const used = Number(await r.json())
      return used < 0 ? null : { used, limit }
    }
  }
  const d = today()
  const cur = memoryQuota.get(userId)
  const next = cur && cur.day === d ? cur.count + 1 : 1
  if (next > limit) return null
  memoryQuota.set(userId, { day: d, count: next })
  return { used: next, limit }
}

export async function readQuota(userId: string): Promise<number> {
  if (SERVICE_KEY()) {
    const r = await admin(`prisma_usage?select=count&user_id=eq.${userId}&day=eq.${today()}`)
    if (r.ok) { const rows = (await r.json()) as { count: number }[]; return rows[0]?.count ?? 0 }
  }
  const cur = memoryQuota.get(userId)
  return cur && cur.day === today() ? cur.count : 0
}
