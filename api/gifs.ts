// Busca de GIFs (proxy para a Tenor ou a GIPHY, com a chave guardada no servidor).
// GET /api/gifs?q=texto&pos=próxima-página   (sem q: os GIFs em alta)
import { authUser, env, json } from './_lib.js'

interface Gif { id: string; url: string; preview: string; width: number; height: number; title: string }

export async function GET(request: Request) {
  const user = await authUser(request)
  if (!user) return json(401, { error: 'login' })
  const u = new URL(request.url)
  const q = (u.searchParams.get('q') || '').trim().slice(0, 80)
  const pos = (u.searchParams.get('pos') || '').slice(0, 60)
  const tenor = env('TENOR_API_KEY'), giphy = env('GIPHY_API_KEY')
  try {
    if (tenor) {
      const p = new URLSearchParams({ key: tenor, client_key: 'krata', limit: '30', media_filter: 'gif,tinygif', locale: 'pt_BR', country: 'BR', contentfilter: 'medium' })
      if (q) p.set('q', q)
      if (pos) p.set('pos', pos)
      const r = await fetch(`${(env('TENOR_BASE_URL') || 'https://tenor.googleapis.com').replace(/\/+$/, '')}/v2/${q ? 'search' : 'featured'}?${p}`)
      if (!r.ok) return json(502, { error: 'tenor', status: r.status })
      const d = (await r.json()) as { next?: string; results?: { id: string; content_description?: string; media_formats: Record<string, { url: string; dims: [number, number] }> }[] }
      const gifs: Gif[] = (d.results || []).filter((x) => x.media_formats?.gif).map((x) => ({
        id: `t:${x.id}`, url: x.media_formats.gif.url, preview: (x.media_formats.tinygif || x.media_formats.gif).url,
        width: x.media_formats.gif.dims[0], height: x.media_formats.gif.dims[1], title: x.content_description || '',
      }))
      return json(200, { gifs, next: d.next || null, provider: 'tenor' }, { 'cache-control': 'private, max-age=300' })
    }
    if (giphy) {
      const offset = Number(pos) || 0
      const p = new URLSearchParams({ api_key: giphy, limit: '30', offset: String(offset), rating: 'pg-13', lang: 'pt' })
      if (q) p.set('q', q)
      const r = await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${p}`)
      if (!r.ok) return json(502, { error: 'giphy', status: r.status })
      const d = (await r.json()) as { data?: { id: string; title?: string; images: Record<string, { url: string; width: string; height: string }> }[]; pagination?: { total_count: number; count: number; offset: number } }
      const gifs: Gif[] = (d.data || []).filter((x) => x.images?.original).map((x) => {
        const full = x.images.downsized_medium || x.images.original
        return { id: `g:${x.id}`, url: full.url.split('?')[0], preview: (x.images.fixed_width_downsampled || x.images.fixed_width || full).url.split('?')[0], width: Number(full.width), height: Number(full.height), title: x.title || '' }
      })
      const pg = d.pagination
      const next = pg && pg.offset + pg.count < pg.total_count ? String(pg.offset + pg.count) : null
      return json(200, { gifs, next, provider: 'giphy' }, { 'cache-control': 'private, max-age=300' })
    }
    return json(503, { error: 'not_configured' })
  } catch (e) {
    return json(502, { error: 'fetch', detail: (e as Error).message })
  }
}
