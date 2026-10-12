// Voz, vídeo e compartilhamento de tela.
// Conexões diretas entre os participantes (WebRTC), com a sinalização passando
// pelo Supabase Realtime. Não existe limite de qualidade por plano: todo mundo
// pode transmitir em até 4K a 60 quadros por segundo.
import type { RealtimeChannel } from '@supabase/supabase-js'
import { create } from 'zustand'
import { dropChannel, iceServers, openChannel, supabase } from '../lib/supabase'
import { audioCtx, sounds } from '../lib/sound'
import { nativeScreenStream } from '../lib/nativeScreen'
import { get as app, dmPartnerIds, toast } from '../store/app'
import { trackPresence } from '../store/actions'

// ------------------------------------------------------------------ tipos
export type Resolution = 'source' | '2160' | '1440' | '1080' | '720'
export interface ScreenSettings { resolution: Resolution; fps: 15 | 30 | 60; mode: 'motion' | 'text'; audio: boolean }
export interface VoiceMember {
  user_id: string
  channel_id: string
  muted: boolean
  deafened: boolean
  camera: boolean
  screen: boolean
  streams: { mic?: string; cam?: string; screen?: string }
  session?: string
  /** celular/tablet: recebe a tela em H.264 (decodificação por hardware) e no máximo 1080p */
  mobile?: boolean
}
export interface PeerView { state: RTCPeerConnectionState; streams: Record<string, MediaStream> }
export interface StreamStats { width: number; height: number; fps: number; kbps: number; codec: string; limit?: string }
export interface VoiceSettings { inputId: string; noise: boolean; echo: boolean; agc: boolean }

interface VoiceState {
  channelId: string | null
  scopeId: string | null
  status: 'idle' | 'connecting' | 'connected'
  muted: boolean
  deafened: boolean
  camera: boolean
  screen: boolean
  screenSettings: ScreenSettings
  micStream: MediaStream | null
  camStream: MediaStream | null
  screenStream: MediaStream | null
  peers: Record<string, PeerView>
  rosters: Record<string, VoiceMember[]>
  speaking: Record<string, boolean>
  volumes: Record<string, number>
  ping: number | null
  screenOut: StreamStats | null
  inbound: Record<string, StreamStats>
  focus: string | null
  stageOpen: boolean
  incoming: { channelId: string; from: string } | null
  joinedAt: number
  audioBlocked: boolean
}

export const defaultScreen: ScreenSettings = { resolution: 'source', fps: 60, mode: 'motion', audio: true }
const savedScreen = (): ScreenSettings => {
  try { return { ...defaultScreen, ...JSON.parse(localStorage.getItem('krata-screen') || '{}') } } catch { return defaultScreen }
}
export const voiceSettings = (): VoiceSettings => {
  const base = { inputId: '', noise: true, echo: true, agc: true }
  try { return { ...base, ...JSON.parse(localStorage.getItem('krata-voice') || '{}') } } catch { return base }
}
export const saveVoiceSettings = (v: VoiceSettings) => localStorage.setItem('krata-voice', JSON.stringify(v))

const initial: VoiceState = {
  channelId: null, scopeId: null, status: 'idle', muted: false, deafened: false, camera: false, screen: false,
  screenSettings: savedScreen(), micStream: null, camStream: null, screenStream: null, peers: {}, rosters: {},
  speaking: {}, volumes: {}, ping: null, screenOut: null, inbound: {}, focus: null, stageOpen: false, incoming: null, joinedAt: 0, audioBlocked: false,
}
export const useVoice = create<VoiceState>(() => ({ ...initial }))
const vget = useVoice.getState
const vset = useVoice.setState
export const currentVoiceChannel = () => vget().channelId

/** Dimensões e taxa de bits máxima (em bits/s) de cada combinação. */
export const RES: Record<Resolution, { w: number; h: number; label: string }> = {
  source: { w: 3840, h: 2160, label: 'Auto (até 4K)' },
  '2160': { w: 3840, h: 2160, label: '4K' },
  '1440': { w: 2560, h: 1440, label: '1440p' },
  '1080': { w: 1920, h: 1080, label: '1080p' },
  '720': { w: 1280, h: 720, label: '720p' },
}
export function screenBitrate(s: ScreenSettings): number {
  const base = { source: 20, '2160': 20, '1440': 11, '1080': 6.5, '720': 3.2 }[s.resolution]
  const factor = s.fps === 60 ? 1.45 : s.fps === 30 ? 1 : 0.6
  return Math.round(base * factor * 1_000_000)
}
export const canShareScreen = () => typeof navigator !== 'undefined' && (!!navigator.mediaDevices?.getDisplayMedia || !!window.KrataNative)

// ------------------------------------------------------------------ presença de voz (quem está em cada sala)
interface Scope { channel: RealtimeChannel | null; refs: Set<string>; ready: Promise<void> }
const scopes = new Map<string, Scope>()

function watch(scopeId: string, ref: string): Scope {
  const existing = scopes.get(scopeId)
  if (existing) { existing.refs.add(ref); return existing }
  const uid = app().userId!
  let resolve!: () => void
  const scope: Scope = { channel: null, refs: new Set([ref]), ready: new Promise<void>((r) => { resolve = r }) }
  scopes.set(scopeId, scope)
  void (async () => {
    const channel = await openChannel(`krata-voice-${scopeId}`, { config: { presence: { key: uid } } })
    if (scopes.get(scopeId) !== scope) { void dropChannel(channel); return }
    scope.channel = channel
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, VoiceMember[]>
      const roster: VoiceMember[] = []
      for (const [key, metas] of Object.entries(state)) {
        const m = metas.find((x) => x.channel_id)
        if (m) roster.push({ ...m, user_id: key, streams: m.streams || {} })
      }
      const before = vget().rosters[scopeId] || []
      vset((s) => ({ rosters: { ...s.rosters, [scopeId]: roster } }))
      if (vget().scopeId === scopeId && vget().status === 'connected') onRoster(before, roster)
    })
    let once = false
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      resolve()
      const again = once
      once = true
      if (vget().scopeId !== scopeId || vget().status !== 'connected') return
      // Voltou de uma queda: os outros já descartaram as conexões comigo.
      // Começa uma sessão nova e refaz tudo do zero dos dois lados.
      if (again) { mySession = crypto.randomUUID(); for (const id of [...peers.keys()]) closePeer(id) }
      void announce()
    })
  })()
  return scope
}
function unwatch(scopeId: string, ref: string) {
  const sc = scopes.get(scopeId)
  if (!sc) return
  sc.refs.delete(ref)
  if (sc.refs.size) return
  scopes.delete(scopeId)
  void dropChannel(sc.channel)
  vset((s) => { const r = { ...s.rosters }; delete r[scopeId]; return { rosters: r } })
}

let viewScope: string | null = null
/** A tela atual quer ver quem está nas salas de voz deste servidor/conversa. */
export function setViewScope(scopeId: string | null) {
  if (viewScope === scopeId) return
  if (viewScope) unwatch(viewScope, 'view')
  viewScope = scopeId
  if (scopeId && app().userId) watch(scopeId, 'view')
}

const scopeOf = (channelId: string) => app().channels.find((c) => c.id === channelId)?.server_id ?? channelId

async function announce() {
  const s = vget()
  if (!s.channelId || !s.scopeId) return
  const sc = scopes.get(s.scopeId)
  if (!sc?.channel) return
  const meta: Omit<VoiceMember, 'user_id'> = {
    channel_id: s.channelId, muted: s.muted || !s.micStream, deafened: s.deafened, camera: s.camera, screen: s.screen,
    streams: { mic: s.micStream?.id, cam: s.camStream?.id, screen: s.screenStream?.id },
    session: mySession,
    mobile: isMobileDevice(),
  }
  try { await sc.channel.track(meta) } catch { /* reconectando */ }
}

// ------------------------------------------------------------------ conexões entre participantes
interface Peer {
  id: string
  remoteSession?: string
  pc: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  mic?: RTCRtpSender
  cam?: RTCRtpSender
  screenVideo?: RTCRtpTransceiver
  screenAudio?: RTCRtpSender
  restartTimer?: ReturnType<typeof setTimeout>
  last: Record<string, { bytes: number; at: number }>
  /** sinais de uma conexão são tratados um de cada vez, na ordem em que chegaram */
  queue: Promise<void>
}
const peers = new Map<string, Peer>()
let rtc: RealtimeChannel | null = null
let statsTimer: ReturnType<typeof setInterval> | null = null
let speakTimer: ReturnType<typeof setInterval> | null = null
let joinToken = 0
/** Identifica esta entrada na sala; muda a cada entrada e depois de uma queda de conexão. */
let mySession = ''

type Signal = { from: string; to: string; sid?: string; tsid?: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
const outbox: Signal[] = []
const signal = (to: string, data: Partial<Signal>) => {
  const msg: Signal = { from: app().userId!, to, sid: mySession, tsid: peers.get(to)?.remoteSession, ...data }
  // canal reconectando: guarda e manda assim que voltar
  if (!rtc || rtc.state !== 'joined') { if (outbox.length < 200) outbox.push(msg); return }
  void rtc.send({ type: 'broadcast', event: 'signal', payload: msg })
}
function flushOutbox() {
  while (rtc && rtc.state === 'joined' && outbox.length) {
    const msg = outbox.shift()!
    if (msg.sid === mySession) void rtc.send({ type: 'broadcast', event: 'signal', payload: msg })
  }
}
// sinais de quem ainda não apareceu na lista da sala esperam um pouco (a lista pode chegar depois)
const waiting = new Map<string, { at: number; msg: Signal }[]>()

const syncPeerView = (p: Peer, streams?: Record<string, MediaStream>) =>
  vset((s) => ({ peers: { ...s.peers, [p.id]: { state: p.pc.connectionState, streams: streams ?? s.peers[p.id]?.streams ?? {} } } }))

function ensurePeer(id: string, remoteSession?: string): Peer {
  const existing = peers.get(id)
  if (existing) return existing
  const me = app().userId!
  const pc = new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: 'max-bundle', iceCandidatePoolSize: 2 })
  const p: Peer = { id, remoteSession, pc, polite: me > id, makingOffer: false, ignoreOffer: false, last: {}, queue: Promise.resolve() }
  peers.set(id, p)
  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true
      await pc.setLocalDescription()
      if (pc.localDescription) signal(id, { description: pc.localDescription.toJSON() })
    } catch (e) { console.warn('[krata] oferta falhou', e) } finally { p.makingOffer = false }
  }
  pc.onicecandidate = ({ candidate }) => { if (candidate) signal(id, { candidate: candidate.toJSON() }) }
  pc.ontrack = ({ track, streams, receiver }) => {
    const stream = streams[0]
    if (!stream) return
    if (track.kind === 'video') {
      // menor atraso possível na reprodução
      try { (receiver as unknown as { jitterBufferTarget: number }).jitterBufferTarget = 0 } catch { /* não suportado */ }
      try { (receiver as unknown as { playoutDelayHint: number }).playoutDelayHint = 0 } catch { /* não suportado */ }
    }
    const publish = () => {
      const cur = { ...(vget().peers[id]?.streams || {}) }
      if (stream.getTracks().some((t) => t.readyState === 'live')) cur[stream.id] = stream
      else delete cur[stream.id]
      syncPeerView(p, cur)
    }
    stream.onremovetrack = publish
    stream.onaddtrack = publish
    track.onended = publish
    publish()
    watchSpeaking()
  }
  pc.onconnectionstatechange = () => {
    if (peers.get(id) !== p) return
    syncPeerView(p)
    if (pc.connectionState === 'failed') pc.restartIce()
  }
  pc.oniceconnectionstatechange = () => {
    clearTimeout(p.restartTimer)
    if (pc.iceConnectionState === 'disconnected')
      p.restartTimer = setTimeout(() => { if (pc.iceConnectionState === 'disconnected') pc.restartIce() }, 4000)
    if (pc.iceConnectionState === 'failed') pc.restartIce()
  }
  const s = vget()
  const micTrack = s.micStream?.getAudioTracks()[0]
  if (micTrack && s.micStream) p.mic = pc.addTrack(micTrack, s.micStream)
  const camTrack = s.camStream?.getVideoTracks()[0]
  if (camTrack && s.camStream) addCamera(p, camTrack, s.camStream)
  if (s.screenStream) addScreen(p, s.screenStream)
  // sem nenhuma mídia local ainda é preciso abrir a conexão para receber
  if (!micTrack && !camTrack && !s.screenStream) pc.addTransceiver('audio', { direction: 'recvonly' })
  syncPeerView(p, {})
  return p
}

function closePeer(id: string) {
  const p = peers.get(id)
  if (!p) return
  peers.delete(id)
  clearTimeout(p.restartTimer)
  p.pc.onnegotiationneeded = p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = p.pc.oniceconnectionstatechange = null
  p.pc.close()
  vset((s) => {
    const next = { ...s.peers }; delete next[id]
    const sp = { ...s.speaking }; delete sp[id]
    return { peers: next, speaking: sp, focus: s.focus?.startsWith(id + ':') ? null : s.focus }
  })
}

/** Chrome começa transmissões com pouca banda e sobe devagar; isto pede um início mais alto. */
function boostSdp(sdp: string): string {
  if (!vget().screen || !('chrome' in window)) return sdp
  const lines = sdp.split('\r\n')
  const out: string[] = []
  let inVideo = false
  const boosted = new Set<string>()
  const wanted = new Set<string>()
  for (const l of lines) {
    if (l.startsWith('m=')) inVideo = l.startsWith('m=video')
    const rtp = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//i.exec(l)
    if (inVideo && rtp) wanted.add(rtp[1])
  }
  const extra = 'x-google-start-bitrate=6000;x-google-min-bitrate=1500'
  inVideo = false
  for (const l of lines) {
    if (l.startsWith('m=')) inVideo = l.startsWith('m=video')
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(l)
    if (inVideo && fmtp && wanted.has(fmtp[1]) && !/x-google-start-bitrate/.test(l)) {
      out.push(`a=fmtp:${fmtp[1]} ${fmtp[2]};${extra}`); boosted.add(fmtp[1]); continue
    }
    out.push(l)
    const rtp = /^a=rtpmap:(\d+) VP8\//i.exec(l)
    if (inVideo && rtp && !boosted.has(rtp[1]) && !lines.some((x) => x.startsWith(`a=fmtp:${rtp[1]} `))) {
      out.push(`a=fmtp:${rtp[1]} ${extra}`); boosted.add(rtp[1])
    }
  }
  return out.join('\r\n')
}

async function onSignal(msg: Signal) {
  const me = app().userId
  const s = vget()
  if (msg.to !== me || !msg.from || s.status === 'idle') return
  if (msg.tsid && msg.tsid !== mySession) return // era para uma entrada minha que já acabou
  // só conversa com quem está nesta sala (e na mesma sessão que a lista mostra)
  const member = ((s.scopeId && s.rosters[s.scopeId]) || []).find((m) => m.user_id === msg.from && m.channel_id === s.channelId)
  if (!member || (member.session && msg.sid && member.session !== msg.sid)) {
    const now = Date.now()
    const list = (waiting.get(msg.from) || []).filter((w) => now - w.at < 8000)
    if (list.length < 80) list.push({ at: now, msg })
    waiting.set(msg.from, list)
    return
  }
  let p = peers.get(msg.from)
  if (p && msg.sid && p.remoteSession && p.remoteSession !== msg.sid) { closePeer(msg.from); p = undefined }
  if (!p) p = ensurePeer(msg.from, msg.sid || member.session)
  const peer = p
  peer.queue = peer.queue.then(() => applySignal(peer, msg))
  await peer.queue
}

async function applySignal(p: Peer, msg: Signal) {
  if (peers.get(p.id) !== p) return
  const pc = p.pc
  try {
    if (msg.description) {
      const collision = msg.description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable')
      p.ignoreOffer = !p.polite && collision
      if (p.ignoreOffer) return
      // resposta atrasada de uma negociação que já acabou
      if (msg.description.type === 'answer' && pc.signalingState !== 'have-local-offer') return
      const boosted = msg.description.sdp ? { type: msg.description.type, sdp: boostSdp(msg.description.sdp) } : msg.description
      try { await pc.setRemoteDescription(boosted) }
      catch (e) { if (boosted === msg.description) throw e; await pc.setRemoteDescription(msg.description) }
      if (msg.description.type === 'offer') {
        await pc.setLocalDescription()
        if (pc.localDescription) signal(p.id, { description: pc.localDescription.toJSON() })
      }
    } else if (msg.candidate) {
      try { await pc.addIceCandidate(msg.candidate) } catch (e) { if (!p.ignoreOffer && pc.remoteDescription) throw e }
    }
  } catch (e) { console.warn('[krata] sinalização', e) }
}

function onRoster(before: VoiceMember[], roster: VoiceMember[]) {
  const s = vget()
  const me = app().userId
  const here = roster.filter((m) => m.channel_id === s.channelId && m.user_id !== me)
  const wasHere = new Set(before.filter((m) => m.channel_id === s.channelId).map((m) => m.user_id))
  for (const m of here) {
    const cur = peers.get(m.user_id)
    // a pessoa caiu e voltou com outra sessão: recomeça a conexão com ela
    if (cur && m.session && cur.remoteSession && cur.remoteSession !== m.session) closePeer(m.user_id)
    if (!peers.has(m.user_id)) { ensurePeer(m.user_id, m.session); if (!wasHere.has(m.user_id) && Date.now() - s.joinedAt > 1500) sounds.join() }
  }
  for (const m of here) {
    const queued = waiting.get(m.user_id)
    if (!queued) continue
    waiting.delete(m.user_id)
    void (async () => { for (const w of queued) await onSignal(w.msg) })()
  }
  const ids = new Set(here.map((m) => m.user_id))
  for (const id of [...peers.keys()]) if (!ids.has(id)) { closePeer(id); sounds.leave() }
  for (const m of here) if (m.screen && !before.find((b) => b.user_id === m.user_id)?.screen && wasHere.has(m.user_id)) sounds.stream()
  if (s.focus && !here.some((m) => s.focus === `${m.user_id}:screen` && m.screen) && s.focus !== `${me}:screen`) vset({ focus: null })
}

// ------------------------------------------------------------------ entrar e sair
async function getMic(): Promise<MediaStream | null> {
  const v = voiceSettings()
  const constraints = (deviceId?: string): MediaStreamConstraints => ({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: v.echo, noiseSuppression: v.noise, autoGainControl: v.agc, channelCount: 1 },
  })
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
    try { return await navigator.mediaDevices.getUserMedia(constraints(v.inputId || undefined)) }
    catch (e) { if (!v.inputId) throw e; return await navigator.mediaDevices.getUserMedia(constraints()) }
  } catch (e) {
    const name = (e as DOMException)?.name
    toast(name === 'NotAllowedError'
      ? 'O navegador bloqueou o microfone. Você entrou só para ouvir — libere o microfone no cadeado da barra de endereço.'
      : 'Nenhum microfone encontrado. Você entrou só para ouvir.', 'error')
    return null
  }
}

// Entrar e sair acontecem um de cada vez: sair precisa terminar (inclusive avisar a sala)
// antes de uma nova entrada começar, senão a saída atrasada apagaria a entrada nova.
let transitions: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = transitions.then(fn, fn)
  transitions = run.catch(() => {})
  return run
}

export function joinVoice(channelId: string, opts: { ring?: boolean } = {}) {
  const cur = vget()
  if (cur.channelId === channelId && cur.status !== 'idle') { vset({ stageOpen: true }); return Promise.resolve() }
  joinToken++ // cancela uma entrada que ainda esteja conectando
  return serial(() => joinVoiceNow(channelId, opts))
}

export function leaveVoice(silent = false) {
  joinToken++
  return serial(() => leaveVoiceNow(silent))
}

async function joinVoiceNow(channelId: string, opts: { ring?: boolean }) {
  if (vget().channelId === channelId && vget().status === 'connected') { vset({ stageOpen: true }); return }
  if (vget().channelId) await leaveVoiceNow(true)
  const uid = app().userId
  if (!uid) return
  if (typeof RTCPeerConnection === 'undefined') { toast('Este navegador não tem suporte a chamadas.', 'error'); return }
  const token = ++joinToken
  mySession = crypto.randomUUID()
  waiting.clear()
  outbox.length = 0
  const scopeId = scopeOf(channelId)
  vset({ channelId, scopeId, status: 'connecting', stageOpen: true, incoming: null, joinedAt: Date.now() })
  audioCtx()
  const mic = await getMic()
  if (token !== joinToken) { mic?.getTracks().forEach((t) => t.stop()); return }
  const wasMuted = vget().muted
  mic?.getAudioTracks().forEach((t) => { t.enabled = !wasMuted })
  vset({ micStream: mic })

  const ch = await openChannel(`krata-rtc-${channelId}`, { config: { broadcast: { self: false } } })
  if (token !== joinToken) { void dropChannel(ch); return }
  ch.on('broadcast', { event: 'signal' }, ({ payload }) => void onSignal(payload as Signal))
  rtc = ch
  const sc = watch(scopeId, 'call')
  const subscribed = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 12000)
    ch.subscribe((status) => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(true); flushOutbox() } })
  })
  const ok = await Promise.all([subscribed, Promise.race([sc.ready, new Promise((r) => setTimeout(r, 12000))])]).then(([a]) => a)
  if (token !== joinToken) return
  if (!ok) { toast('Não foi possível conectar à sala. Verifique sua internet.', 'error'); await leaveVoiceNow(true); return }

  vset({ status: 'connected', joinedAt: Date.now() })
  await announce()
  if (token !== joinToken) return
  onRoster([], vget().rosters[scopeId] || [])
  void trackPresence(channelId)
  sounds.join()
  statsTimer = setInterval(() => void collectStats(), 2000)
  watchSpeaking()
  if (opts.ring) ringOthers(channelId)
}

async function leaveVoiceNow(silent: boolean) {
  const s = vget()
  if (!s.channelId) return
  if (ringing.size) cancelRing(s.channelId)
  for (const id of [...peers.keys()]) closePeer(id)
  waiting.clear()
  outbox.length = 0
  for (const st of [s.micStream, s.camStream, s.screenStream]) st?.getTracks().forEach((t) => { t.onended = null; t.stop() })
  if (statsTimer) clearInterval(statsTimer)
  if (speakTimer) clearInterval(speakTimer)
  statsTimer = speakTimer = null
  analysers.clear()
  const oldRtc = rtc
  rtc = null
  // a tela volta ao normal na hora; o aviso para a sala termina logo em seguida
  vset((v) => ({ ...initial, rosters: v.rosters, volumes: v.volumes, screenSettings: v.screenSettings, incoming: v.incoming }))
  void trackPresence(null)
  if (!silent) sounds.leave()
  if (s.scopeId) {
    const sc = scopes.get(s.scopeId)
    try { await sc?.channel?.untrack() } catch { /* já desconectado */ }
    unwatch(s.scopeId, 'call')
  }
  await dropChannel(oldRtc)
}

export async function stopVoiceEverything() {
  await leaveVoice(true)
  setViewScope(null)
  userToken++
  if (userChannel) { void dropChannel(userChannel); userChannel = null }
  for (const [id, sc] of scopes) { void dropChannel(sc.channel); scopes.delete(id) }
  vset({ ...initial })
}

// ------------------------------------------------------------------ microfone, câmera
export async function toggleMute() {
  const s = vget()
  if (s.deafened) return toggleDeafen()
  let mic = s.micStream
  if (s.muted || !mic) {
    if (!mic && s.status === 'connected') {
      mic = await getMic()
      if (!mic) return
      vset({ micStream: mic })
      const track = mic.getAudioTracks()[0]
      for (const p of peers.values()) p.mic = p.pc.addTrack(track, mic)
      watchSpeaking()
    }
    mic?.getAudioTracks().forEach((t) => { t.enabled = true })
    vset({ muted: false }); sounds.unmute()
  } else {
    mic.getAudioTracks().forEach((t) => { t.enabled = false })
    vset({ muted: true }); sounds.mute()
  }
  void announce()
}
let mutedBeforeDeafen = false
export function toggleDeafen() {
  const s = vget()
  if (!s.deafened) {
    mutedBeforeDeafen = s.muted
    s.micStream?.getAudioTracks().forEach((t) => { t.enabled = false })
    vset({ deafened: true, muted: true }); sounds.mute()
  } else {
    s.micStream?.getAudioTracks().forEach((t) => { t.enabled = !mutedBeforeDeafen })
    vset({ deafened: false, muted: mutedBeforeDeafen }); sounds.unmute()
  }
  void announce()
}

/** Troca o microfone em uso (usado nas configurações). */
export async function reloadMic() {
  const s = vget()
  if (s.status !== 'connected') return
  const mic = await getMic()
  if (!mic) return
  const track = mic.getAudioTracks()[0]
  track.enabled = !s.muted
  for (const p of peers.values()) {
    if (p.mic) await p.mic.replaceTrack(track).catch(() => {})
    else p.mic = p.pc.addTrack(track, mic)
  }
  s.micStream?.getTracks().forEach((t) => t.stop())
  // mantém o mesmo id de stream do lado de quem recebe: quem já tinha "mic" continua casando pelo anúncio
  vset({ micStream: mic })
  analysers.delete('me')
  void announce()
  watchSpeaking()
}

function addCamera(p: Peer, track: MediaStreamTrack, stream: MediaStream) {
  p.cam = p.pc.addTrack(track, stream)
  try {
    const params = p.cam.getParameters()
    if (params.encodings?.length) { params.encodings[0].maxBitrate = 2_500_000; void p.cam.setParameters(params).catch(() => {}) }
  } catch { /* opcional */ }
}
export async function toggleCamera() {
  const s = vget()
  if (s.status !== 'connected') return
  if (s.camera) {
    for (const p of peers.values()) { if (p.cam) { try { p.pc.removeTrack(p.cam) } catch { /* fechado */ } p.cam = undefined } }
    s.camStream?.getTracks().forEach((t) => t.stop())
    vset({ camera: false, camStream: null })
    return void announce()
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' } })
    if (vget().status !== 'connected') { stream.getTracks().forEach((t) => t.stop()); return }
    const track = stream.getVideoTracks()[0]
    track.onended = () => { if (vget().camStream === stream) void toggleCamera() }
    vset({ camera: true, camStream: stream })
    for (const p of peers.values()) addCamera(p, track, stream)
    void announce()
  } catch (e) {
    toast((e as DOMException)?.name === 'NotAllowedError' ? 'O navegador bloqueou a câmera. Libere o acesso no cadeado da barra de endereço.' : 'Não foi possível ligar a câmera.', 'error')
  }
}

// ------------------------------------------------------------------ compartilhamento de tela
export const isMobileDevice = () => typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)))

// ordem de codecs escolhida no começo da transmissão (pela placa de vídeo de quem transmite)
let screenCodecOrder: string[] | null = null
async function pickScreenCodecs(s: ScreenSettings, w: number, h: number): Promise<string[]> {
  // celular: só o H.264 tem codificador por hardware em todos os aparelhos
  if (isMobileDevice()) return ['video/h264', 'video/vp8', 'video/vp9', 'video/av1']
  const small = h <= 1080
  const fallback = small && s.mode === 'motion' ? ['video/h264', 'video/vp9', 'video/av1', 'video/vp8'] : ['video/vp9', 'video/av1', 'video/h264', 'video/vp8']
  const mc = navigator.mediaCapabilities
  if (!mc?.encodingInfo) return fallback
  const rated: { c: string; score: number }[] = []
  for (const c of ['video/av1', 'video/vp9', 'video/h264']) {
    try {
      const r = await mc.encodingInfo({ type: 'webrtc', video: { contentType: c, width: w, height: h, bitrate: screenBitrate(s), framerate: s.fps } } as MediaEncodingConfiguration)
      if (!r.supported) continue
      // por hardware (eficiente) e fluido primeiro; entre iguais, o mais moderno comprime melhor
      const quality = c === 'video/av1' ? 3 : c === 'video/vp9' ? 2 : 1
      rated.push({ c, score: (r.powerEfficient ? 100 : 0) + (r.smooth ? 10 : 0) + quality })
    } catch { /* este navegador não responde para webrtc */ }
  }
  if (!rated.length) return fallback
  // sem nenhum por hardware em resolução alta, o VP9 em software ainda é o mais equilibrado
  if (!rated.some((r) => r.score >= 100) && !small) return fallback
  return [...rated.sort((a, b) => b.score - a.score).map((r) => r.c), ...fallback.filter((c) => !rated.some((r) => r.c === c))]
}

function preferCodecs(tx: RTCRtpTransceiver, s: ScreenSettings, remoteMobile = false) {
  const small = s.resolution === '1080' || s.resolution === '720'
  let order = screenCodecOrder
    ?? (small && s.mode === 'motion' ? ['video/h264', 'video/vp9', 'video/av1', 'video/vp8'] : ['video/vp9', 'video/av1', 'video/h264', 'video/vp8'])
  // quem assiste no celular decodifica H.264 por hardware: sem isso a tela trava em poucos quadros
  if (remoteMobile) order = ['video/h264', 'video/vp8', ...order.filter((c) => c !== 'video/h264' && c !== 'video/vp8')]
  const rank = (mime: string) => { const i = order.indexOf(mime.toLowerCase()); return i === -1 ? order.length : i }
  for (const caps of [RTCRtpReceiver.getCapabilities?.('video'), RTCRtpSender.getCapabilities?.('video')]) {
    if (!caps) continue
    try {
      tx.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType)))
      return
    } catch { /* tenta a outra lista */ }
  }
}
const remoteIsMobile = (peerId: string) => {
  const s = vget()
  return !!((s.scopeId && s.rosters[s.scopeId]) || []).find((m) => m.user_id === peerId)?.mobile
}
/** Para celular: no máximo 1080p no lado menor e bitrate que o aparelho aguenta. */
function mobileCaps(track: MediaStreamTrack, s: ScreenSettings): { scale: number; bitrate: number } {
  const st = track.getSettings()
  const short = Math.min(st.width || 1920, st.height || 1080)
  return { scale: short > 1080 ? short / 1080 : 1, bitrate: Math.min(screenBitrate(s), s.fps >= 60 ? 9_000_000 : 6_500_000) }
}

function tuneScreenSender(sender: RTCRtpSender, s: ScreenSettings, peerId?: string) {
  try {
    const params = sender.getParameters()
    if (!params.encodings?.length) return
    const caps = peerId && remoteIsMobile(peerId) && sender.track ? mobileCaps(sender.track, s) : null
    params.encodings[0].maxBitrate = caps ? caps.bitrate : screenBitrate(s)
    params.encodings[0].maxFramerate = s.fps
    if (caps) params.encodings[0].scaleResolutionDownBy = caps.scale
    ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = s.mode === 'text' ? 'maintain-resolution' : 'maintain-framerate'
    void sender.setParameters(params).catch(() => {})
  } catch { /* opcional */ }
}
function addScreen(p: Peer, stream: MediaStream) {
  const s = vget().screenSettings
  const video = stream.getVideoTracks()[0]
  if (!video) return
  const mobilePeer = remoteIsMobile(p.id)
  const caps = mobilePeer ? mobileCaps(video, s) : null
  const enc: RTCRtpEncodingParameters = { maxBitrate: caps ? caps.bitrate : screenBitrate(s), maxFramerate: s.fps, priority: 'high', networkPriority: 'high', ...(caps && caps.scale > 1 ? { scaleResolutionDownBy: caps.scale } : {}) }
  try { p.screenVideo = p.pc.addTransceiver(video, { direction: 'sendonly', streams: [stream], sendEncodings: [enc] }) }
  catch { p.screenVideo = p.pc.addTransceiver(video, { direction: 'sendonly', streams: [stream], sendEncodings: [{ maxBitrate: enc.maxBitrate, maxFramerate: enc.maxFramerate }] }) }
  preferCodecs(p.screenVideo, s, mobilePeer)
  tuneScreenSender(p.screenVideo.sender, s, p.id)
  const audio = stream.getAudioTracks()[0]
  if (audio) {
    p.screenAudio = p.pc.addTrack(audio, stream)
    try {
      const params = p.screenAudio.getParameters()
      if (params.encodings?.length) { params.encodings[0].maxBitrate = 192_000; void p.screenAudio.setParameters(params).catch(() => {}) }
    } catch { /* opcional */ }
  }
}
function removeScreen(p: Peer) {
  try { if (p.screenAudio) p.pc.removeTrack(p.screenAudio) } catch { /* fechado */ }
  try { if (p.screenVideo) { p.pc.removeTrack(p.screenVideo.sender); p.screenVideo.stop() } } catch { /* fechado */ }
  p.screenAudio = undefined
  p.screenVideo = undefined
}
const videoConstraints = (s: ScreenSettings): MediaTrackConstraints => ({
  width: { ideal: RES[s.resolution].w, max: RES[s.resolution].w },
  height: { ideal: RES[s.resolution].h, max: RES[s.resolution].h },
  frameRate: { ideal: s.fps, max: s.fps },
})

export async function startScreen(settings: ScreenSettings): Promise<boolean> {
  const s = vget()
  if (s.status !== 'connected') return false
  if (!canShareScreen()) { toast('Este navegador não permite compartilhar a tela. No celular, você ainda pode assistir às transmissões.', 'error'); return false }
  localStorage.setItem('krata-screen', JSON.stringify(settings))
  let stream: MediaStream
  if (window.KrataNative) {
    // app Android: captura nativa da tela
    const got = await nativeScreenStream(settings, () => { if (vget().screenStream === got) stopScreen() })
    if (!got) return false
    stream = got
  } else try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints(settings),
      audio: settings.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } as MediaTrackConstraints : false,
      systemAudio: 'include', surfaceSwitching: 'include', selfBrowserSurface: 'exclude',
    } as DisplayMediaStreamOptions)
  } catch (e) {
    const name = (e as DOMException)?.name
    if (name !== 'NotAllowedError' && name !== 'AbortError') toast('Não foi possível capturar a tela.', 'error')
    return false
  }
  if (vget().status !== 'connected') { stream.getTracks().forEach((t) => t.stop()); return false }
  if (vget().screenStream) stopScreen()
  const video = stream.getVideoTracks()[0]
  try { video.contentHint = settings.mode === 'text' ? 'detail' : 'motion' } catch { /* opcional */ }
  { const st = video.getSettings(); screenCodecOrder = await pickScreenCodecs(settings, st.width || RES[settings.resolution].w, st.height || RES[settings.resolution].h).catch(() => null) }
  video.onended = () => { if (vget().screenStream === stream) stopScreen() }
  vset({ screen: true, screenStream: stream, screenSettings: settings, stageOpen: true, focus: `${app().userId}:screen` })
  for (const p of peers.values()) addScreen(p, stream)
  void announce()
  sounds.stream()
  return true
}

export function stopScreen() {
  const s = vget()
  if (!s.screenStream) return
  for (const p of peers.values()) removeScreen(p)
  s.screenStream.getTracks().forEach((t) => { t.onended = null; t.stop() })
  vset((v) => ({ screen: false, screenStream: null, screenOut: null, focus: v.focus === `${app().userId}:screen` ? null : v.focus }))
  void announce()
}

/** Muda a qualidade no meio da transmissão, sem precisar reiniciar. */
export async function updateScreenQuality(settings: ScreenSettings) {
  const s = vget()
  localStorage.setItem('krata-screen', JSON.stringify(settings))
  vset({ screenSettings: settings })
  const video = s.screenStream?.getVideoTracks()[0]
  if (!video) return
  try { video.contentHint = settings.mode === 'text' ? 'detail' : 'motion' } catch { /* opcional */ }
  try { await video.applyConstraints(videoConstraints(settings)) } catch { /* a captura mantém o que conseguir */ }
  for (const p of peers.values()) if (p.screenVideo) tuneScreenSender(p.screenVideo.sender, settings, p.id)
}

// ------------------------------------------------------------------ quem está falando
const analysers = new Map<string, { node: AnalyserNode; id: string; until: number; buf: Uint8Array<ArrayBuffer> }>()
function watchSpeaking() {
  const s = vget()
  const want: Record<string, MediaStream> = {}
  if (s.micStream) want.me = s.micStream
  const roster = (s.scopeId && s.rosters[s.scopeId]) || []
  for (const [id, view] of Object.entries(s.peers)) {
    const micId = roster.find((m) => m.user_id === id)?.streams.mic
    const stream = (micId && view.streams[micId]) || Object.values(view.streams).find((st) => st.getAudioTracks().length && !st.getVideoTracks().length)
    if (stream) want[id] = stream
  }
  for (const [key, stream] of Object.entries(want)) {
    if (analysers.get(key)?.id === stream.id || !stream.getAudioTracks().length) continue
    try {
      const ctx = audioCtx()
      const node = ctx.createAnalyser()
      node.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(node)
      analysers.set(key, { node, id: stream.id, until: 0, buf: new Uint8Array(node.fftSize) })
    } catch { /* áudio indisponível */ }
  }
  for (const key of [...analysers.keys()]) if (!want[key]) analysers.delete(key)
  if (speakTimer) return
  speakTimer = setInterval(() => {
    const now = Date.now()
    const me = app().userId!
    const next: Record<string, boolean> = {}
    for (const [key, a] of analysers) {
      a.node.getByteTimeDomainData(a.buf)
      let sum = 0
      for (let i = 0; i < a.buf.length; i++) { const x = (a.buf[i] - 128) / 128; sum += x * x }
      if (Math.sqrt(sum / a.buf.length) > 0.035) a.until = now + 350
      const id = key === 'me' ? me : key
      if (a.until > now && !(key === 'me' && vget().muted)) next[id] = true
    }
    const cur = vget().speaking
    const keys = new Set([...Object.keys(cur), ...Object.keys(next)])
    for (const k of keys) if (!!cur[k] !== !!next[k]) { vset({ speaking: next }); break }
  }, 110)
}

// ------------------------------------------------------------------ medições (ping, resolução, fps, taxa de bits)
async function collectStats() {
  const s = vget()
  const rtts: number[] = []
  let screenOut: StreamStats | null = null
  const inbound: Record<string, StreamStats> = {}
  const screenTrackId = s.screenStream?.getVideoTracks()[0]?.id
  for (const p of peers.values()) {
    let report: RTCStatsReport
    try { report = await p.pc.getStats() } catch { continue }
    const all = [...report.values()] as Record<string, never>[]
    const byId = (id?: string) => (id ? (report.get(id) as Record<string, never> | undefined) : undefined)
    const transport = all.find((r) => r.type === 'transport' && r.selectedCandidatePairId)
    const pair = byId(transport?.selectedCandidatePairId) || all.find((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded')
    if (pair && typeof pair.currentRoundTripTime === 'number') rtts.push(pair.currentRoundTripTime * 1000)
    const rate = (key: string, bytes: number) => {
      const prev = p.last[key]
      const now = performance.now()
      p.last[key] = { bytes, at: now }
      return prev && now > prev.at ? Math.max(0, ((bytes - prev.bytes) * 8) / (now - prev.at)) : 0
    }
    const codecOf = (r: Record<string, never>) => String(byId(r.codecId)?.mimeType || '').replace('video/', '')
    for (const r of all) {
      if (r.type === 'outbound-rtp' && r.kind === 'video') {
        const src = byId(r.mediaSourceId)
        const kbps = rate(`o${r.ssrc}`, Number(r.bytesSent || 0))
        if (screenTrackId && src?.trackIdentifier === screenTrackId && r.frameWidth) {
          const st: StreamStats = { width: Number(r.frameWidth), height: Number(r.frameHeight), fps: Math.round(Number(r.framesPerSecond || 0)), kbps, codec: codecOf(r), limit: String(r.qualityLimitationReason || 'none') }
          if (!screenOut || st.kbps > screenOut.kbps) screenOut = st
        }
      }
      if (r.type === 'inbound-rtp' && r.kind === 'video' && r.trackIdentifier) {
        const kbps = rate(`i${r.ssrc}`, Number(r.bytesReceived || 0))
        inbound[String(r.trackIdentifier)] = { width: Number(r.frameWidth || 0), height: Number(r.frameHeight || 0), fps: Math.round(Number(r.framesPerSecond || 0)), kbps, codec: codecOf(r) }
      }
    }
  }
  vset({ ping: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null, screenOut, inbound })
}

// ------------------------------------------------------------------ chamadas em conversas (toque)
let userChannel: RealtimeChannel | null = null
let ringTimer: ReturnType<typeof setInterval> | null = null
const ringing = new Set<string>()

let userToken = 0
export function startUserChannel(uid: string) {
  if (userChannel) return
  const token = ++userToken
  void openChannel(`krata-user-${uid}`).then((ch) => {
  if (token !== userToken || userChannel) { void dropChannel(ch); return }
  ch.on('broadcast', { event: 'ring' }, ({ payload }) => {
    const { channelId, from } = payload as { channelId: string; from: string }
    if (!app().channels.some((c) => c.id === channelId) || vget().channelId === channelId || app().me?.status === 'dnd') return
    vset({ incoming: { channelId, from } })
    stopRingSound()
    let count = 0
    sounds.ring()
    ringTimer = setInterval(() => { if (++count >= 12) dismissIncoming(); else sounds.ring() }, 2500)
  })
  ch.on('broadcast', { event: 'cancel' }, ({ payload }) => {
    if (vget().incoming?.channelId === (payload as { channelId: string }).channelId) dismissIncoming()
  })
  ch.on('broadcast', { event: 'decline' }, ({ payload }) => {
    const { channelId, from } = payload as { channelId: string; from: string }
    if (vget().channelId !== channelId) return
    ringing.delete(from)
    toast(`${app().profiles[from]?.display_name || 'A pessoa'} recusou a chamada.`)
  })
  ch.subscribe()
  userChannel = ch
  })
}
function stopRingSound() { if (ringTimer) clearInterval(ringTimer); ringTimer = null }
export function dismissIncoming() { stopRingSound(); vset({ incoming: null }) }
export async function acceptIncoming() {
  const inc = vget().incoming
  dismissIncoming()
  if (inc) await joinVoice(inc.channelId)
}
export function declineIncoming() {
  const inc = vget().incoming
  dismissIncoming()
  if (inc) sendToUser(inc.from, 'decline', { channelId: inc.channelId, from: app().userId })
}
const userQueues = new Map<string, Promise<void>>()
/** Manda um aviso para o canal pessoal de alguém, sem precisar entrar nele (uma fila por pessoa). */
function sendToUser(userId: string, event: string, payload: Record<string, unknown>) {
  const run = async () => {
    const ch = supabase.channel(`krata-user-${userId}`, { config: { private: true } })
    try { await ch.httpSend(event, payload) }
    catch { try { await ch.send({ type: 'broadcast', event, payload }) } catch { /* sem conexão */ } }
    finally { void supabase.removeChannel(ch) }
  }
  const next = (userQueues.get(userId) || Promise.resolve()).then(run, run)
  userQueues.set(userId, next)
  void next.finally(() => { if (userQueues.get(userId) === next) userQueues.delete(userId) })
}
function ringOthers(channelId: string) {
  const s = vget()
  const inRoom = new Set((s.rosters[s.scopeId || ''] || []).filter((m) => m.channel_id === channelId).map((m) => m.user_id))
  for (const id of dmPartnerIds(app(), channelId)) {
    if (inRoom.has(id)) continue
    ringing.add(id)
    sendToUser(id, 'ring', { channelId, from: app().userId })
  }
  setTimeout(() => ringing.clear(), 30000)
}
function cancelRing(channelId: string) {
  const s = vget()
  const inRoom = new Set((s.rosters[s.scopeId || ''] || []).map((m) => m.user_id))
  for (const id of ringing) if (!inRoom.has(id)) sendToUser(id, 'cancel', { channelId })
  ringing.clear()
}

export const setVolume = (key: string, v: number) => vset((s) => ({ volumes: { ...s.volumes, [key]: v } }))

/** iPhone e alguns navegadores bloqueiam o som até um toque na tela. */
export function unlockAudio() {
  audioCtx()
  document.querySelectorAll('audio').forEach((a) => { void a.play().catch(() => {}) })
  vset({ audioBlocked: false })
}

/** Estado interno para diagnóstico (só aparece com o modo de diagnóstico ligado). */
export const voiceDebug = () => ({ rtc: rtc?.state ?? null, topic: rtc?.topic ?? null, session: mySession, peers: [...peers.keys()], waiting: Object.fromEntries([...waiting].map(([k, v]) => [k, v.length])), outbox: outbox.length, scopes: [...scopes].map(([k, v]) => `${k}:${[...v.refs]}:${v.channel?.state}`) })
