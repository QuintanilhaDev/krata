// Ajuste da foto antes de enviar: arrastar para posicionar, pinçar/rolar/deslizar para aproximar,
// com o círculo (ou quadrado arredondado, ou faixa larga) mostrando exatamente o que vai aparecer.
import { Check, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'

type Shape = 'circle' | 'rounded' | 'wide'
interface Job { file: File; url: string; shape: Shape; title: string; resolve: (f: File | null) => void }
const useCrop = create<{ job: Job | null }>(() => ({ job: null }))

/**
 * Abre o ajuste e devolve a imagem recortada (ou null se a pessoa cancelar).
 * GIF animado passa direto (recortar tiraria a animação).
 */
export function cropImage(file: File, shape: Shape = 'circle', title = 'Ajustar foto'): Promise<File | null> {
  if (file.type === 'image/gif') return Promise.resolve(file)
  return new Promise((resolve) => {
    const prev = useCrop.getState().job
    if (prev) { prev.resolve(null); URL.revokeObjectURL(prev.url) }
    useCrop.setState({ job: { file, url: URL.createObjectURL(file), shape, title, resolve } })
  })
}

const OUT: Record<Shape, { w: number; h: number }> = { circle: { w: 512, h: 512 }, rounded: { w: 512, h: 512 }, wide: { w: 1500, h: 540 } }

export function CropperHost() {
  const job = useCrop((s) => s.job)
  if (!job) return null
  return <CropperDialog key={job.url} job={job} />
}

function CropperDialog({ job }: { job: Job }) {
  const frame = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 }) // deslocamento do centro, em px da moldura
  const [box, setBox] = useState({ w: 280, h: 280 })
  const [busy, setBusy] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const max = Math.min(innerWidth - 48, 420)
      setBox(job.shape === 'wide' ? { w: max, h: Math.round(max / (OUT.wide.w / OUT.wide.h)) } : { w: Math.min(max, 320), h: Math.min(max, 320) })
    }
    measure()
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [job.shape])

  // escala mínima: a imagem sempre cobre a moldura inteira
  const base = natural ? Math.max(box.w / natural.w, box.h / natural.h) : 1
  const scale = base * zoom
  const clamp = (p: { x: number; y: number }, z = zoom) => {
    if (!natural) return p
    const s = base * z
    const mx = Math.max(0, (natural.w * s - box.w) / 2), my = Math.max(0, (natural.h * s - box.h) / 2)
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) }
  }
  const setZoomClamped = (z: number) => { const nz = Math.max(1, Math.min(5, z)); setZoom(nz); setPos((p) => clamp(p, nz)) }

  const close = (result: File | null) => {
    job.resolve(result)
    URL.revokeObjectURL(job.url)
    useCrop.setState({ job: null })
  }

  async function confirm() {
    if (!natural || !img.current) return
    setBusy(true)
    const out = OUT[job.shape]
    const canvas = document.createElement('canvas')
    canvas.width = out.w; canvas.height = out.h
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    // pedaço da imagem original que está dentro da moldura
    const sw = box.w / scale, sh = box.h / scale
    const sx = natural.w / 2 - pos.x / scale - sw / 2
    const sy = natural.h / 2 - pos.y / scale - sh / 2
    ctx.drawImage(img.current, sx, sy, sw, sh, 0, 0, out.w, out.h)
    const keepAlpha = job.file.type === 'image/png' || job.file.type === 'image/webp'
    const type = keepAlpha ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.92))
    setBusy(false)
    if (!blob) return close(job.file)
    const name = job.file.name.replace(/\.[^.]+$/, '') + (keepAlpha ? '.png' : '.jpg')
    close(new File([blob], name, { type }))
  }

  const onDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom }
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, cur)
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      setZoomClamped(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist))
    } else if (pointers.current.size === 1) {
      setPos((p) => clamp({ x: p.x + cur.x - prev.x, y: p.y + cur.y - prev.y }))
    }
  }
  const onUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter') void confirm() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <div className="cropper-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null) }}>
      <section className="cropper" role="dialog" aria-modal="true" aria-label={job.title}>
        <h2>{job.title}</h2>
        <p className="muted">Arraste para posicionar. Pince ou use o controle para aproximar.</p>
        <div
          ref={frame}
          className={`cropper-frame ${job.shape}`}
          style={{ width: box.w, height: box.h }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onWheel={(e) => setZoomClamped(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        >
          <img
            ref={img} src={job.url} alt="" draggable={false}
            onLoad={(e) => { const i = e.currentTarget; setNatural({ w: i.naturalWidth, h: i.naturalHeight }) }}
            style={natural ? { width: natural.w * scale, height: natural.h * scale, transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)` } : { opacity: 0 }}
          />
          <span className="cropper-mask" aria-hidden="true" />
        </div>
        <div className="cropper-zoom">
          <button className="icon-btn" onClick={() => setZoomClamped(zoom / 1.2)} aria-label="Afastar"><ZoomOut size={18} /></button>
          <input type="range" min={1} max={5} step={0.01} value={zoom} onChange={(e) => setZoomClamped(Number(e.target.value))} aria-label="Aproximar" />
          <button className="icon-btn" onClick={() => setZoomClamped(zoom * 1.2)} aria-label="Aproximar mais"><ZoomIn size={18} /></button>
          <button className="icon-btn" onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }) }} aria-label="Recomeçar"><RotateCcw size={17} /></button>
        </div>
        <footer>
          <button className="btn ghost" onClick={() => close(null)}>Cancelar</button>
          <button className="btn primary" disabled={!natural || busy} onClick={() => void confirm()}><Check size={16} /> {busy ? 'Ajustando…' : 'Usar assim'}</button>
        </footer>
      </section>
    </div>
  )
}
