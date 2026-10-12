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
  // vídeo por hardware quando o WebView decodifica H.264; senão, o modo compatível (JPEG)
  let fast = false
  if (bridge.setScreenMode && typeof VideoDecoder !== 'undefined') {
    try { fast = !!(await VideoDecoder.isConfigSupported({ codec: 'avc1.42E01F' })).supported } catch { fast = false }
  }
  try { bridge.setScreenMode?.(fast ? 'video' : 'jpeg') } catch { /* app antigo */ }
  bridge.startScreen(settings.resolution, settings.fps, settings.audio)
  // espera a pessoa aceitar no aviso do Android
  const t0 = Date.now()
  for (;;) {
    const s = await state()
    if (s === 'live') break
    if (s === 'denied' || s === 'error' || Date.now() - t0 > 120_000) return null
    await sleep(150)
  }

  const fps = Math.max(5, Math.min(60, settings.fps))
  let alive = true
  const finish = () => { if (alive) { alive = false; onEnded() } }
  let mode = 'jpeg'
  try { mode = bridge.screenMode?.() || 'jpeg' } catch { /* app antigo */ }

  let stream: MediaStream
  let videoTrack: MediaStreamTrack
  const Generator = (window as unknown as { MediaStreamTrackGenerator?: new (o: { kind: 'video' }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> } }).MediaStreamTrackGenerator
  const canvas = document.createElement('canvas')
  canvas.width = 1280; canvas.height = 720
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const draw = (img: VideoFrame | ImageBitmap) => {
    const w = 'displayWidth' in img ? img.displayWidth : img.width, h = 'displayHeight' in img ? img.displayHeight : img.height
    if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h }
    ctx.drawImage(img, 0, 0)
  }

  if (mode === 'video') {
    // modo rápido: H.264 do hardware do celular → decodificador de vídeo do WebView → trilha de vídeo direto
    let writer: WritableStreamDefaultWriter<VideoFrame> | null = null
    if (Generator) {
      const gen = new Generator({ kind: 'video' })
      writer = gen.writable.getWriter()
      stream = new MediaStream([gen])
      videoTrack = gen
    } else {
      stream = canvas.captureStream(fps)
      videoTrack = stream.getVideoTracks()[0]
    }
    // números para diagnóstico (window.__krataScreen no console)
    const stats = { fetches: 0, chunks: 0, decoded: 0, dropped: 0, errors: 0 }
    ;(window as unknown as { __krataScreen?: unknown }).__krataScreen = stats
    let decoder = null as VideoDecoder | null
    let codec = ''
    let needKey = true
    let after = 0
    const makeDecoder = (c: string) => {
      try { decoder?.close() } catch { /* já fechado */ }
      codec = c
      needKey = true
      decoder = new VideoDecoder({
        output: (frame) => {
          stats.decoded++
          if (!alive) { frame.close(); return }
          if (writer) void writer.write(frame).catch(() => frame.close())
          else { draw(frame); frame.close() }
        },
        error: () => { stats.errors++; needKey = true; after = 0; decoder = null },
      })
      decoder.configure({ codec: c, optimizeForLatency: true } as VideoDecoderConfig)
    }
    void (async () => {
      let misses = 0
      while (alive) {
        try {
          stats.fetches++
          const r = await fetch(`/__krata/video?after=${after}`, { cache: 'no-store' })
          if (r.status === 410) break
          if (r.status !== 200) { misses++; await sleep(50); continue }
          const c = r.headers.get('x-codec') || 'avc1.42E01F'
          const buf = new DataView(await r.arrayBuffer())
          if (!decoder || c !== codec || decoder.state === 'closed') makeDecoder(c)
          let off = 0
          while (off + 21 <= buf.byteLength) {
            const len = buf.getInt32(off), key = buf.getInt8(off + 4) === 1
            const pts = Number(buf.getBigInt64(off + 5)), seq = Number(buf.getBigInt64(off + 13))
            const data = new Uint8Array(buf.buffer, buf.byteOffset + off + 21, len)
            off += 21 + len
            after = seq
            stats.chunks++
            if (needKey && !key) { stats.dropped++; continue }
            // ficou para trás (decodificador lotado): espera o próximo quadro-chave
            if (decoder!.decodeQueueSize > 6 && !key) { needKey = true; stats.dropped++; continue }
            needKey = false
            decoder!.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: pts, data }))
          }
          misses = 0
        } catch { misses++; await sleep(80) }
        if (misses > 100) break
      }
      try { decoder?.close() } catch { /* já fechado */ }
      try { await writer?.close() } catch { /* já fechado */ }
      finish()
    })()
  } else {
    stream = canvas.captureStream(fps)
    videoTrack = stream.getVideoTracks()[0]
    let lastId = '0'
    // modo compatível (JPEG): busca o próximo quadro enquanto o anterior ainda decodifica
    void (async () => {
      let misses = 0
      let decoding: Promise<void> = Promise.resolve()
      while (alive) {
        const started = performance.now()
        try {
          const r = await fetch(`/__krata/frame?after=${lastId}`, { cache: 'no-store' })
          if (r.status === 200) {
            lastId = r.headers.get('x-frame-id') || lastId
            const blob = await r.blob()
            await decoding
            decoding = createImageBitmap(blob).then((bmp) => { draw(bmp); bmp.close() }, () => {})
            misses = 0
          } else if (r.status === 410) { break } // a captura acabou (parada pela notificação)
          else misses++
        } catch { misses++ }
        if (misses > 200) break
        const wait = 1000 / fps - (performance.now() - started)
        if (wait > 1) await sleep(wait)
      }
      finish()
    })()
  }

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

  const video = videoTrack
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
