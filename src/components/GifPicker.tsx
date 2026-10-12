// Escolher GIF: pesquisa, em alta e favoritos (a estrela salva na conta).
import { Search, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { addFavorite, loadFavorites, removeFavorite, searchGifs, type Gif } from '../lib/gifs'
import { toast, useApp } from '../store/app'
import { useClickOutside } from './ui'

let favCache: Gif[] | null = null
const listeners = new Set<(f: Gif[]) => void>()
function setFavs(f: Gif[]) { favCache = f; listeners.forEach((l) => l(f)) }

/** Favoritos compartilhados entre o seletor e o botão das mensagens. */
export function useGifFavorites() {
  const uid = useApp((s) => s.userId)
  const [favs, set] = useState<Gif[]>(favCache || [])
  useEffect(() => {
    listeners.add(set)
    if (!favCache && uid) void loadFavorites().then(setFavs)
    return () => { listeners.delete(set) }
  }, [uid])
  const toggle = async (g: Gif) => {
    if (!uid) return
    const has = (favCache || []).some((f) => f.id === g.id || f.url === g.url)
    if (has) {
      const target = (favCache || []).find((f) => f.id === g.id || f.url === g.url)!
      setFavs((favCache || []).filter((f) => f !== target))
      if (!(await removeFavorite(target.id))) { toast('Não deu para tirar dos favoritos.', 'error'); void loadFavorites().then(setFavs) }
    } else {
      setFavs([g, ...(favCache || [])])
      if (!(await addFavorite(g, uid))) { toast('Não deu para salvar o GIF.', 'error'); void loadFavorites().then(setFavs) }
      else toast('GIF salvo nos favoritos', 'ok')
    }
  }
  return { favs, toggle, isFav: (url: string) => favs.some((f) => f.url === url) }
}

export function GifPicker({ onPick, onClose }: { onPick: (g: Gif) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, onClose)
  const { favs, toggle, isFav } = useGifFavorites()
  const [tab, setTab] = useState<'trend' | 'fav'>(favCache?.length ? 'fav' : 'trend')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Gif[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'off' | 'error'>('loading')
  const req = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    if (tab === 'fav' && !q) return
    const id = ++req.current
    setState('loading')
    const t = setTimeout(async () => {
      const r = await searchGifs(q.trim())
      if (id !== req.current) return
      if (r === 'off' || r === 'error') { setState(r); setItems([]); return }
      setItems(r.gifs); setNext(r.next); setState('ok')
    }, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [q, tab])

  async function more() {
    if (!next || state === 'loading') return
    const id = ++req.current
    setState('loading')
    const r = await searchGifs(q.trim(), next)
    if (id !== req.current) return
    if (r === 'off' || r === 'error') { setState('ok'); setNext(null); return }
    setItems((x) => [...x, ...r.gifs.filter((g) => !x.some((y) => y.id === g.id))]); setNext(r.next); setState('ok')
  }

  const showing = tab === 'fav' && !q ? favs : items
  // duas colunas em "alvenaria": cada GIF vai para a coluna mais baixa
  const cols = useMemo(() => {
    const c: Gif[][] = [[], []], h = [0, 0]
    for (const g of showing) { const i = h[0] <= h[1] ? 0 : 1; c[i].push(g); h[i] += (g.height || 1) / (g.width || 1) }
    return c
  }, [showing])

  return (
    <div ref={ref} className="gif-picker pop" role="dialog" aria-label="Escolher GIF">
      <div className="gif-head">
        <div className="input with-prefix gif-search"><Search size={15} /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar GIFs" aria-label="Pesquisar GIFs" enterKeyHint="search" /></div>
        <div className="gif-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'fav'} className={tab === 'fav' ? 'on' : ''} onClick={() => { setTab('fav'); setQ('') }}><Star size={14} /> Favoritos</button>
          <button role="tab" aria-selected={tab === 'trend'} className={tab === 'trend' ? 'on' : ''} onClick={() => { setTab('trend'); setQ('') }}>Em alta</button>
        </div>
      </div>
      <div className="gif-grid" onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 300 && !(tab === 'fav' && !q)) void more() }}>
        {state === 'off' && <p className="gif-empty">A busca de GIFs ainda não foi ligada no servidor (falta a chave da Tenor ou da GIPHY). Seus favoritos continuam funcionando.</p>}
        {state === 'error' && <p className="gif-empty">Não deu para buscar GIFs agora.</p>}
        {tab === 'fav' && !q && favs.length === 0 && <p className="gif-empty">Toque na ⭐ de um GIF para salvar aqui. Os favoritos ficam na sua conta.</p>}
        {state === 'ok' && showing.length === 0 && q && <p className="gif-empty">Nada encontrado para “{q}”.</p>}
        <div className="gif-cols">
          {cols.map((col, i) => (
            <div key={i} className="gif-col">
              {col.map((g) => (
                <div key={g.id} className="gif-item" style={{ aspectRatio: `${g.width || 1} / ${g.height || 1}` }}>
                  <button className="gif-send" onClick={() => onPick(g)} aria-label={`Enviar GIF ${g.title || ''}`}><img src={g.preview} alt={g.title || 'GIF'} loading="lazy" /></button>
                  <button className={`gif-star${isFav(g.url) ? ' on' : ''}`} onClick={() => void toggle(g)} aria-label={isFav(g.url) ? 'Tirar dos favoritos' : 'Salvar nos favoritos'} aria-pressed={isFav(g.url)}><Star size={15} /></button>
                </div>
              ))}
            </div>
          ))}
        </div>
        {state === 'loading' && <p className="gif-empty">Carregando…</p>}
      </div>
    </div>
  )
}
