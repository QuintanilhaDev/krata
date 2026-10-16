// Servidores TURN para as chamadas.
// Sem TURN, quem está em rede móvel (2G/3G/4G com CGNAT) ou atrás de firewall muitas vezes não
// consegue falar direto com os outros e fica em "Conectando..." para sempre.
// GET /api/turn → { iceServers: RTCIceServer[], ttl }
//
// Configuração (variáveis de ambiente na Vercel), uma das duas:
//   CF_TURN_KEY_ID + CF_TURN_API_TOKEN   → Cloudflare Realtime TURN (credenciais temporárias, recomendado)
//   TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL → um servidor TURN fixo (ex.: coturn próprio)
import { authUser, env, json } from './_lib.js'

const TTL = 6 * 60 * 60
let cache: { at: number; servers: RTCIceServer[] } | null = null

export async function GET(request: Request) {
  const user = await authUser(request)
  if (!user) return json(401, { error: 'login' })

  const keyId = env('CF_TURN_KEY_ID')
  const token = env('CF_TURN_API_TOKEN')
  if (keyId && token) {
    // a mesma credencial serve para todos por algumas horas (evita uma chamada à Cloudflare por pessoa)
    if (!cache || Date.now() - cache.at > (TTL / 2) * 1000) {
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: TTL }),
        })
        if (!r.ok) throw new Error(`cloudflare ${r.status}`)
        const data = (await r.json()) as { iceServers: RTCIceServer | RTCIceServer[] }
        const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers]
        // a porta 53 costuma travar a coleta de candidatos nos navegadores
        const servers = list.map((s) => ({ ...s, urls: ([] as string[]).concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
        cache = { at: Date.now(), servers }
      } catch (e) {
        if (!cache) return json(200, { iceServers: [], ttl: 60, error: (e as Error).message })
      }
    }
    return json(200, { iceServers: cache.servers, ttl: TTL / 2 })
  }

  const urls = env('TURN_URLS').split(',').map((s) => s.trim()).filter(Boolean)
  if (urls.length) return json(200, { iceServers: [{ urls, username: env('TURN_USERNAME'), credential: env('TURN_CREDENTIAL') }], ttl: TTL })
  return json(200, { iceServers: [], ttl: TTL })
}
