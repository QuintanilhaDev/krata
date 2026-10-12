// GIFs: busca (pelo servidor), favoritos salvos na conta e o reconhecimento de links de GIF nas mensagens.
import { supabase } from './supabase'

export interface Gif { id: string; url: string; preview: string; width: number; height: number; title?: string }

const HOSTS = /^https:\/\/(media\d?\.tenor\.com|c\.tenor\.com|media\d?\.giphy\.com|i\.giphy\.com)\//
/** O link é um GIF de um provedor conhecido? (só esses aparecem como imagem no chat) */
export const gifUrl = (url?: string | null): string | null => (url && HOSTS.test(url) && !/[\s"'()\\<>]/.test(url) && url.length < 600 ? url : null)

async function token() { return (await supabase.auth.getSession()).data.session?.access_token || '' }

export async function searchGifs(q: string, pos?: string | null): Promise<{ gifs: Gif[]; next: string | null } | 'off' | 'error'> {
  try {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (pos) p.set('pos', pos)
    const r = await fetch(`/api/gifs?${p}`, { headers: { authorization: `Bearer ${await token()}` } })
    if (r.status === 503) return 'off'
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return 'error'
    const d = (await r.json()) as { gifs: Gif[]; next: string | null }
    return { gifs: d.gifs.filter((g) => gifUrl(g.url)), next: d.next }
  } catch { return 'error' }
}

export async function loadFavorites(): Promise<Gif[]> {
  const { data, error } = await supabase.from('gif_favorites').select('gif_id,url,preview,width,height').order('created_at', { ascending: false }).limit(200)
  if (error || !data) return []
  return (data as { gif_id: string; url: string; preview: string; width: number; height: number }[]).map((r) => ({ id: r.gif_id, url: r.url, preview: r.preview, width: r.width, height: r.height }))
}

export async function addFavorite(g: Gif, userId: string) {
  return !(await supabase.from('gif_favorites').upsert({ user_id: userId, gif_id: g.id, url: g.url, preview: g.preview || g.url, width: g.width || 0, height: g.height || 0 }, { onConflict: 'user_id,gif_id' })).error
}

export async function removeFavorite(gifId: string) {
  return !(await supabase.from('gif_favorites').delete().eq('gif_id', gifId)).error
}

/** Id estável para um GIF que só temos o link (favoritar a partir de uma mensagem). */
export const gifIdFromUrl = (url: string) => `u:${url.replace(/^https:\/\//, '').slice(0, 180)}`
