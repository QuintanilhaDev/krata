// Compartilhamento de tela dentro do app Android.
// O WebView do Android não tem getDisplayMedia, então o app captura a tela com a API nativa
// (MediaProjection) e entrega os quadros (JPEG) e o som (PCM) neste mesmo endereço, em
// /__krata/frame e /__krata/audio. Aqui eles viram uma MediaStream comum (canvas + áudio),
// que segue pelo mesmo caminho da transmissão do computador.
import type { Resolution } from '../voice/engine'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function state(): Promise<string> {
  try { return window.KrataNative?.screenState() || 'idle' } catch { return 'idle' }
}

export async function nativeScreenStream(settings: { resolution: Resolution; fps: number; audio: boolean }, onEnded: () => void): Promise<MediaStream | null> {
  const bridge = window.KrataNative
  if (!bridge) return null
  bridge.startScreen(settings.resolution, settings.fps, settings.audio)
  // espera a pessoa aceitar no aviso do Android
  const t0 = Date.now()
  for (;;) {
    const s = await state()
    if (s === 'live') break
    if (s === 'denied' || s === 'error' || Date.now() - t0 > 120_000) return null
    await sleep(150)
  }

  const canvas = document.createElement('canvas')
  canvas.width = 1280; canvas.height = 720
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const fps = Math.max(5, Math.min(60, settings.fps))
  const stream = canvas.captureStream(fps)
  let alive = true
  let lastId = '0'

  // vídeo: busca o quadro mais novo sempre que o anterior terminou de desenhar
  void (async () => {
    let misses = 0
    while (alive) {
      const started = performance.now()
      try {
        const r = await fetch(`/__krata/frame?after=${lastId}`, { cache: 'no-store' })
        if (r.status === 200) {
          lastId = r.headers.get('x-frame-id') || lastId
          const bmp = await createImageBitmap(await r.blob())
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas.width = bmp.width; canvas.height = bmp.height }
          ctx.drawImage(bmp, 0, 0)
          bmp.close()
          misses = 0
        } else if (r.status === 410) { break } // a captura acabou (parada pela notificação)
        else misses++
      } catch { misses++ }
      if (misses > 200) break
      const wait = 1000 / fps - (performance.now() - started)
      if (wait > 1) await sleep(wait)
    }
    if (alive) { alive = false; onEnded() }
  })()

  // som: blocos PCM 16 bits estéreo 48 kHz enfileirados sem buraco
  let audioCtx: AudioContext | null = null
  if (settings.audio) {
    try {
      audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
      const dest = audioCtx.createMediaStreamDestination()
      let next = 0
      void (async () => {
        while (alive && audioCtx) {
          try {
            const r = await fetch('/__krata/audio', { cache: 'no-store' })
            if (r.status === 200) {
              const buf = await r.arrayBuffer()
              const frames = Math.floor(buf.byteLength / 4)
              if (frames > 0) {
                const pcm = new Int16Array(buf, 0, frames * 2)
                const ab = audioCtx.createBuffer(2, frames, 48000)
                const l = ab.getChannelData(0), rr = ab.getChannelData(1)
                for (let i = 0; i < frames; i++) { l[i] = pcm[i * 2] / 32768; rr[i] = pcm[i * 2 + 1] / 32768 }
                const src = audioCtx.createBufferSource()
                src.buffer = ab
                src.connect(dest)
                const now = audioCtx.currentTime
                if (next < now + 0.02 || next > now + 0.5) next = now + 0.06 // reancora se atrasou ou acumulou
                src.start(next)
                next += ab.duration
              } else await sleep(30)
            }
            else await sleep(60)
          } catch { await sleep(100) /* tenta de novo */ }
        }
      })()
      const track = dest.stream.getAudioTracks()[0]
      if (track) stream.addTrack(track)
    } catch { audioCtx = null }
  }

  const video = stream.getVideoTracks()[0]
  const stop = video.stop.bind(video)
  // quando o Krata para a transmissão, avisa o app para soltar a captura
  video.stop = () => {
    if (alive) { alive = false; try { bridge.stopScreen() } catch { /* já parou */ } }
    void audioCtx?.close().catch(() => {})
    audioCtx = null
    stop()
  }
  return stream
}
