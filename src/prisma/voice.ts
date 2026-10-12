// Ouvido e voz da Prisma.
// - Escuta contínua (computador e Android): reconhecimento de fala do navegador, de graça,
//   reage só quando ouve "Prisma" no começo ou no meio da frase.
// - "Toque para falar" (funciona em todo lugar, inclusive iPhone): grava um trecho e manda
//   para o Whisper da Groq pelo servidor.
// - Voz: neural da Microsoft (se configurada no servidor, com um leve brilho "cristalino")
//   ou a melhor voz feminina em português do aparelho.
import { audioCtx } from '../lib/sound'
import { supabase } from '../lib/supabase'
import { toast } from '../store/app'
import { wake } from './brain'
import { speakable } from './persona'
import { pget, pset } from './store'

type Handler = (text: string, viaWake: boolean) => void
type Recognizer = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
type RecognizerCtor = new () => Recognizer

let handler: Handler = () => {}
let rec: Recognizer | null = null
let want = false
let pausedForPtt = false
let speakingUntil = 0
let attentiveUntil = 0
let failures = 0

const W = () => window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor }
export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const speechSupport = () => !!(W().SpeechRecognition || W().webkitSpeechRecognition)
/** Escuta contínua só onde o navegador aguenta (no iPhone ela para sozinha e não volta). */
export const canContinuous = () => speechSupport() && !isIOS()

export function initVoice(h: Handler) {
  handler = h
  pset({ canListen: canContinuous() })
  let pref: string | null = null
  try { pref = localStorage.getItem('krata-prisma-listen') } catch { /* sem armazenamento */ }
  if (canContinuous() && pref !== 'off') setListening(true, false)
}

export function setListening(on: boolean, remember = true) {
  if (remember) { try { localStorage.setItem('krata-prisma-listen', on ? 'on' : 'off') } catch { /* sem armazenamento */ } }
  want = on && canContinuous()
  pset({ listening: want })
  if (want) start()
  else stopRec()
}

function stopRec() {
  const r = rec
  rec = null
  if (r) { r.onend = null; try { r.abort() } catch { /* já parado */ } }
}

function start() {
  if (rec || !want || pausedForPtt) return
  const Ctor = W().SpeechRecognition || W().webkitSpeechRecognition
  if (!Ctor) return
  const r = new Ctor()
  r.lang = 'pt-BR'
  r.continuous = true
  r.interimResults = true
  r.maxAlternatives = 1
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      const text = res[0]?.transcript || ''
      if (!res.isFinal) {
        // mostra que ouviu o nome dela antes mesmo da frase terminar
        if (Date.now() > speakingUntil && wake(text).called && pget().mood === 'idle') pset({ mood: 'listening' })
        continue
      }
      failures = 0
      heard(text)
    }
  }
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      want = false
      pset({ listening: false })
      toast('O navegador bloqueou o microfone da Prisma. Libere no cadeado da barra de endereço, ou toque no botão dela para falar.', 'error')
    } else if (e.error === 'network' || e.error === 'audio-capture') failures++
  }
  r.onend = () => {
    rec = null
    if (pget().mood === 'listening') pset({ mood: 'idle' })
    // o navegador encerra a escuta de tempos em tempos: volta a ouvir sozinha
    if (want && !pausedForPtt) setTimeout(start, Math.min(8000, 250 * 2 ** Math.min(failures, 5)))
  }
  rec = r
  try { r.start() } catch { rec = null; setTimeout(start, 1000) }
}

/** Depois que ela pergunta algo, ouve a resposta mesmo sem "Prisma". */
export function attend(ms = 8000) { attentiveUntil = Date.now() + ms }

function heard(text: string) {
  const w = wake(text)
  if (Date.now() < speakingUntil) {
    // é a própria voz dela saindo pela caixa de som — a não ser que a pessoa chame "Prisma" por cima
    if (!w.called || /pri[sz]ma/i.test(saying)) return
    stopSpeaking()
  }
  if (w.called) {
    if (w.request.replace(/[^\p{L}\p{N}]/gu, '').length < 2) {
      // só "Prisma": fica atenta à próxima frase
      attentiveUntil = Date.now() + 7000
      handler('', true)
      return
    }
    attentiveUntil = 0
    handler(w.request, true)
    return
  }
  if (Date.now() < attentiveUntil) { attentiveUntil = 0; handler(text, true) }
  else if (pget().mood === 'listening') pset({ mood: 'idle' })
}

// ------------------------------------------------------------------ toque para falar
let recorder: MediaRecorder | null = null
let oneShot: Recognizer | null = null

export function isRecording() { return !!recorder || !!oneShot }

/** Liga e desliga a gravação do "toque para falar". */
export async function pushToTalk() {
  if (recorder) { recorder.stop(); return }
  if (oneShot) { try { oneShot.stop() } catch { /* já parado */ } return }
  audioCtx()
  const Ctor = W().SpeechRecognition || W().webkitSpeechRecognition
  if (Ctor && !isIOS()) {
    pausedForPtt = true
    stopRec()
    const r = new Ctor()
    r.lang = 'pt-BR'; r.continuous = false; r.interimResults = false; r.maxAlternatives = 1
    let got = ''
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) got += e.results[i][0].transcript }
    r.onerror = (e) => { if (e.error === 'not-allowed') toast('Libere o microfone no cadeado da barra de endereço para falar com a Prisma.', 'error') }
    r.onend = () => {
      oneShot = null
      pset({ recording: false })
      pausedForPtt = false
      if (want) start()
      const w = wake(got)
      if (got.trim()) handler(w.called && w.request ? w.request : got.trim(), false)
    }
    oneShot = r
    pset({ recording: true })
    try { r.start() } catch { oneShot = null; pset({ recording: false }); pausedForPtt = false }
    return
  }
  await recordAndTranscribe()
}

async function recordAndTranscribe() {
  if (!pget().server?.stt) { toast('A voz no celular precisa da chave da Groq configurada no servidor. Por enquanto, escreve pra Prisma no chat dela.', 'error'); pset({ chatOpen: true }); return }
  let stream: MediaStream
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) }
  catch { toast('Libere o microfone para falar com a Prisma.', 'error'); return }
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) || ''
  let mr: MediaRecorder
  try { mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream) } catch { stream.getTracks().forEach((t) => t.stop()); toast('Este navegador não grava áudio.', 'error'); return }
  const chunks: Blob[] = []
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  // para sozinho depois de um silêncio, ou em 12 segundos
  const ctx = audioCtx()
  const src = ctx.createMediaStreamSource(stream)
  const an = ctx.createAnalyser(); an.fftSize = 1024
  src.connect(an)
  const buf = new Uint8Array(an.fftSize)
  let spoke = false, quietSince = performance.now()
  const started = performance.now()
  const timer = setInterval(() => {
    an.getByteTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x }
    const loud = Math.sqrt(sum / buf.length) > 0.03
    const now = performance.now()
    if (loud) { spoke = true; quietSince = now }
    if ((spoke && now - quietSince > 1300) || now - started > 12000 || (!spoke && now - started > 6000)) { if (mr.state === 'recording') mr.stop() }
  }, 100)
  const done = new Promise<void>((resolve) => { mr.onstop = () => resolve() })
  recorder = mr
  pset({ recording: true, mood: 'listening' })
  mr.start(250)
  await done
  clearInterval(timer)
  src.disconnect()
  stream.getTracks().forEach((t) => t.stop())
  recorder = null
  pset({ recording: false })
  const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' })
  if (!spoke || blob.size < 1500) { pset({ mood: 'idle' }); return }
  pset({ mood: 'thinking' })
  try {
    const { data } = await supabase.auth.getSession()
    const r = await fetch('/api/prisma-stt', { method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token || ''}`, 'content-type': blob.type }, body: blob })
    const d = (await r.json().catch(() => ({}))) as { text?: string; error?: string }
    if (!r.ok) { pset({ mood: 'error' }); toast(d.error === 'limit' ? 'A transcrição de voz bateu o limite de agora. Tenta em alguns minutos ou escreve no chat da Prisma.' : 'Não consegui ouvir direito. Tenta de novo?', 'error'); return }
    const text = (d.text || '').trim()
    pset({ mood: 'idle' })
    if (text) { const w = wake(text); handler(w.called && w.request ? w.request : text, false) }
  } catch { pset({ mood: 'error' }); toast('Sem conexão para entender a voz agora.', 'error') }
}

// ------------------------------------------------------------------ voz
let currentSource: AudioBufferSourceNode | null = null
let fx: AudioNode | null = null
let speakToken = 0
let saying = ''

export const volume = () => { try { return Number(localStorage.getItem('krata-prisma-volume') ?? 1) } catch { return 1 } }
export const chosenVoice = () => { try { return localStorage.getItem('krata-prisma-voice') || '' } catch { return '' } }

/** Vozes femininas em português disponíveis neste aparelho, da melhor para a pior. */
export function femaleVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return []
  const all = speechSynthesis.getVoices().filter((v) => /^pt/i.test(v.lang))
  const female = /francisca|thalita|leila|leticia|luciana|maria|fernanda|vit[oó]ria|yara|manuela|brenda|giovanna|elza|raquel|joana|camila|google portugu[eê]s do brasil|female|feminina|\bf\d?\b/i
  const male = /daniel|felipe|antonio|ant[oô]nio|fabio|f[aá]bio|julio|j[uú]lio|nicolau|valerio|humberto|donato|male\b|masculin/i
  const score = (v: SpeechSynthesisVoice) => (female.test(v.name) ? 10 : 0) - (male.test(v.name) ? 20 : 0) + (/pt[-_]BR/i.test(v.lang) ? 4 : 0) + (/natural|neural|online|premium|enhanced/i.test(v.name) ? 3 : 0) + (v.localService ? 0 : 1)
  return all.filter((v) => !male.test(v.name)).sort((a, b) => score(b) - score(a))
}

function crystalChain(ctx: AudioContext): AudioNode {
  if (fx) return fx
  // brilho bem leve: um pouco de agudo, um eco curtíssimo e um coro sutil
  const input = ctx.createGain()
  const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 6500; shelf.gain.value = 3
  const dry = ctx.createGain(); dry.gain.value = 0.9
  const chorusDelay = ctx.createDelay(); chorusDelay.delayTime.value = 0.012
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.55
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.0015
  lfo.connect(lfoGain).connect(chorusDelay.delayTime); lfo.start()
  const chorusWet = ctx.createGain(); chorusWet.gain.value = 0.12
  const conv = ctx.createConvolver()
  const len = Math.floor(ctx.sampleRate * 0.7)
  const ir = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) }
  conv.buffer = ir
  const revWet = ctx.createGain(); revWet.gain.value = 0.08
  const out = ctx.createGain(); out.gain.value = volume()
  input.connect(shelf)
  shelf.connect(dry).connect(out)
  shelf.connect(chorusDelay).connect(chorusWet).connect(out)
  shelf.connect(conv).connect(revWet).connect(out)
  out.connect(ctx.destination)
  fx = input
  return fx
}

export function stopSpeaking() {
  speakToken++
  try { currentSource?.stop() } catch { /* já parou */ }
  currentSource = null
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  speakingUntil = Date.now() + 300
}

/** Fala o texto. Resolve quando termina (ou é interrompida). */
export async function speak(text: string, onPulse?: () => void): Promise<void> {
  const plain = speakable(text)
  if (!plain) return
  stopSpeaking()
  const token = ++speakToken
  saying = plain
  speakingUntil = Number.POSITIVE_INFINITY
  pset({ mood: 'speaking' })
  try {
    if (pget().server?.tts && (await speakNeural(plain, token))) return
    if (token === speakToken) await speakDevice(plain, token, onPulse)
  } finally {
    if (token === speakToken) {
      speakingUntil = Date.now() + 600
      if (pget().mood === 'speaking') pset({ mood: 'idle' })
    }
  }
}

async function speakNeural(text: string, token: number): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession()
    const r = await fetch('/api/prisma-tts', { method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token || ''}`, 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    if (!r.ok || token !== speakToken) return false
    const ctx = audioCtx()
    const buffer = await ctx.decodeAudioData(await r.arrayBuffer())
    if (token !== speakToken) return true
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(crystalChain(ctx))
    currentSource = src
    await new Promise<void>((resolve) => { src.onended = () => resolve(); src.start() })
    return true
  } catch { return false }
}

function speakDevice(text: string, token: number, onPulse?: () => void): Promise<void> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve()
  const voices = femaleVoices()
  const picked = voices.find((v) => v.name === chosenVoice()) || voices[0]
  // frases curtas: o Chrome corta falas longas no meio
  const parts = text.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) || [text]
  return new Promise<void>((resolve) => {
    let i = 0
    const next = () => {
      if (token !== speakToken || i >= parts.length) return resolve()
      const u = new SpeechSynthesisUtterance(parts[i++])
      u.lang = picked?.lang || 'pt-BR'
      if (picked) u.voice = picked
      u.rate = 1.05
      u.pitch = 1.14
      u.volume = Math.max(0, Math.min(1, volume()))
      u.onboundary = () => onPulse?.()
      let finished = false
      const end = () => { if (!finished) { finished = true; next() } }
      u.onend = end
      u.onerror = end
      // segurança: alguns navegadores não avisam o fim
      setTimeout(end, 1500 + parts[i - 1].length * 95)
      speechSynthesis.speak(u)
    }
    next()
  })
}

if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => { /* carrega a lista de vozes */ }

// O iPhone só deixa falar/tocar som depois de um toque: aproveita o primeiro toque na página.
let unlocked = false
function unlockSpeech() {
  if (unlocked) return
  unlocked = true
  try { audioCtx() } catch { /* sem áudio */ }
  if (typeof speechSynthesis !== 'undefined' && isIOS()) {
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u) } catch { /* sem voz */ }
  }
}
if (typeof window !== 'undefined') {
  const once = () => { unlockSpeech(); removeEventListener('pointerdown', once, true); removeEventListener('keydown', once, true) }
  addEventListener('pointerdown', once, true)
  addEventListener('keydown', once, true)
}
