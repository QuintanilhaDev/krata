import {
  Activity, Headphones, HeadphoneOff, Maximize, Mic, MicOff, Minimize2, MonitorOff, MonitorUp, Phone, PhoneOff, PictureInPicture2, Settings2,
  SignalHigh, SignalLow, SignalMedium, Video, VideoOff, Volume2, VolumeX,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { mmss } from '../lib/time'
import { channelTitle, closeModal, openModal, useApp } from '../store/app'
import {
  RES, acceptIncoming, canShareScreen, unlockAudio, declineIncoming, leaveVoice, screenBitrate, setVolume, startScreen, stopScreen, toggleCamera,
  toggleDeafen, toggleMute, updateScreenQuality, useVoice, type Resolution, type ScreenSettings, type StreamStats, type VoiceMember,
} from '../voice/engine'
import { Avatar, Modal } from './ui'

const NONE: VoiceMember[] = []

function useMembers(): VoiceMember[] {
  const channelId = useVoice((v) => v.channelId)
  const roster = useVoice((v) => (v.scopeId ? v.rosters[v.scopeId] : undefined)) ?? NONE
  return useMemo(() => roster.filter((m) => m.channel_id === channelId), [roster, channelId])
}

function AudioUnlock() {
  const blocked = useVoice((v) => v.audioBlocked)
  if (!blocked) return null
  return <button className="btn primary small audio-unlock" onClick={unlockAudio}><Volume2 size={15} /> Toque para ouvir</button>
}

export function Ping({ compact }: { compact?: boolean }) {
  const ping = useVoice((v) => v.ping)
  const alone = useVoice((v) => Object.keys(v.peers).length === 0)
  const level = ping == null ? 'none' : ping < 90 ? 'good' : ping < 200 ? 'ok' : 'bad'
  const Icon = level === 'bad' ? SignalLow : level === 'ok' ? SignalMedium : SignalHigh
  return (
    <span className={`ping ${level}`} title="Tempo de resposta entre você e as outras pessoas da chamada">
      <Icon size={16} />
      {ping == null ? (compact ? '' : alone ? 'Aguardando alguém entrar' : 'Medindo…') : `${ping} ms`}
    </span>
  )
}

// ---- reprodução do áudio de todo mundo (fica montado mesmo com a chamada minimizada)
function AudioEl({ stream, volume, muted }: { stream: MediaStream; volume: number; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    void el.play().catch((e) => { if ((e as DOMException)?.name === 'NotAllowedError') useVoice.setState({ audioBlocked: true }) })
  }, [stream])
  useEffect(() => { if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume)) }, [volume])
  return <audio ref={ref} autoPlay playsInline muted={muted} />
}
export function AudioSink() {
  const peers = useVoice((v) => v.peers)
  const volumes = useVoice((v) => v.volumes)
  const deafened = useVoice((v) => v.deafened)
  const members = useMembers()
  return (
    <div hidden>
      {Object.entries(peers).flatMap(([uid, view]) =>
        Object.values(view.streams).filter((s) => s.getAudioTracks().length > 0).map((s) => {
          const isScreen = members.find((m) => m.user_id === uid)?.streams.screen === s.id
          return <AudioEl key={`${uid}-${s.id}`} stream={s} volume={volumes[isScreen ? `${uid}:screen` : uid] ?? 1} muted={deafened} />
        }))}
    </div>
  )
}

function VideoEl({ stream, mirror, contain }: { stream: MediaStream; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    void el.play().catch(() => {})
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted className={`${mirror ? 'mirror ' : ''}${contain ? 'contain' : ''}`} />
}

function StatsBox({ st, sending }: { st?: StreamStats | null; sending?: boolean }) {
  if (!st || !st.width) return <div className="stats">Medindo…</div>
  const limit = st.limit && st.limit !== 'none' ? (st.limit === 'bandwidth' ? 'limitado pela internet' : st.limit === 'cpu' ? 'limitado pelo processador' : '') : ''
  return (
    <div className="stats">
      <span>{st.width}×{st.height}</span><span>{st.fps} fps</span>
      <span>{st.kbps >= 1000 ? `${(st.kbps / 1000).toFixed(1)} Mbps` : `${Math.round(st.kbps)} kbps`}</span>
      {st.codec && <span>{st.codec}</span>}
      {sending && limit && <span className="warn">{limit}</span>}
    </div>
  )
}

interface TileProps { id: string; member: VoiceMember; kind: 'user' | 'screen'; focused: boolean; small?: boolean }

function Tile({ id, member, kind, focused, small }: TileProps) {
  const me = useApp((s) => s.userId)!
  const profile = useApp((s) => s.profiles[member.user_id])
  const isMe = member.user_id === me
  const view = useVoice((v) => v.peers[member.user_id])
  const speaking = useVoice((v) => !!v.speaking[member.user_id])
  const local = useVoice((v) => (kind === 'screen' ? v.screenStream : v.camStream))
  const volume = useVoice((v) => v.volumes[kind === 'screen' ? `${member.user_id}:screen` : member.user_id] ?? 1)
  const wantId = kind === 'screen' ? member.streams.screen : member.streams.cam
  const stream = isMe ? local : wantId ? view?.streams[wantId] : undefined
  const trackId = stream?.getVideoTracks()[0]?.id
  const inbound = useVoice((v) => (trackId ? v.inbound[trackId] : undefined))
  const outbound = useVoice((v) => v.screenOut)
  const [showStats, setShowStats] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const hasVideo = !!stream && stream.getVideoTracks().length > 0 && (kind === 'screen' || member.camera)
  const name = profile?.display_name || 'Usuário'
  const connecting = !isMe && view && view.state !== 'connected'
  const volKey = kind === 'screen' ? `${member.user_id}:screen` : member.user_id

  const fullscreen = () => {
    const el = box.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void (el.requestFullscreen?.() ?? (el.querySelector('video') as unknown as { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.())
  }
  const pip = () => {
    const v = box.current?.querySelector('video')
    if (!v) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture()
    else void v.requestPictureInPicture?.().catch(() => {})
  }

  return (
    <div ref={box} className={`tile ${kind}${focused ? ' focused' : ''}${small ? ' small' : ''}${speaking && kind === 'user' ? ' speaking' : ''}`}
      onClick={() => useVoice.setState((v) => ({ focus: v.focus === id ? null : id }))}
      onDoubleClick={fullscreen} role="group" aria-label={kind === 'screen' ? `Tela de ${name}` : name}>
      {hasVideo ? <VideoEl stream={stream!} mirror={isMe && kind === 'user'} contain={kind === 'screen'} /> : (
        <div className="tile-face" style={{ ['--accent' as string]: profile?.accent_color || '#00A86B' }}>
          <Avatar profile={profile} name={name} seed={member.user_id} size={small ? 44 : 96} speaking={speaking} />
          {kind === 'screen' && <span className="muted">Carregando transmissão…</span>}
        </div>
      )}
      {connecting && <span className="tile-state">Conectando…</span>}
      <div className="tile-label">
        {kind === 'screen' && <span className="live-tag">AO VIVO</span>}
        <span>{kind === 'screen' ? (isMe ? 'Sua tela' : `Tela de ${name}`) : isMe ? `${name} (você)` : name}</span>
        {kind === 'user' && (member.deafened ? <HeadphoneOff size={14} /> : member.muted ? <MicOff size={14} /> : null)}
      </div>
      {showStats && kind === 'screen' && <StatsBox st={isMe ? outbound : inbound} sending={isMe} />}
      {!small && (
        <div className="tile-tools" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {!isMe && (
            <label className="vol" title="Volume">
              {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              <input type="range" min={0} max={1} step={0.05} value={volume} aria-label={`Volume de ${kind === 'screen' ? 'transmissão de ' : ''}${name}`} onChange={(e) => setVolume(volKey, Number(e.target.value))} />
            </label>
          )}
          {kind === 'screen' && <button className={`icon-btn${showStats ? ' on' : ''}`} onClick={() => setShowStats((v) => !v)} aria-label="Mostrar qualidade da transmissão" aria-pressed={showStats} data-tip="Qualidade"><Activity size={17} /></button>}
          {hasVideo && 'pictureInPictureEnabled' in document && <button className="icon-btn" onClick={pip} aria-label="Janela flutuante" data-tip="Janela flutuante"><PictureInPicture2 size={17} /></button>}
          {hasVideo && <button className="icon-btn" onClick={fullscreen} aria-label="Tela cheia" data-tip="Tela cheia"><Maximize size={17} /></button>}
        </div>
      )}
    </div>
  )
}

export function Controls({ compact }: { compact?: boolean }) {
  const muted = useVoice((v) => v.muted)
  const deafened = useVoice((v) => v.deafened)
  const camera = useVoice((v) => v.camera)
  const screen = useVoice((v) => v.screen)
  return (
    <div className={`call-controls${compact ? ' compact' : ''}`} role="toolbar" aria-label="Controles da chamada">
      <button data-prisma="mute" className={`ctl${muted ? ' off' : ''}`} onClick={() => void toggleMute()} aria-pressed={muted} aria-label={muted ? 'Ativar microfone' : 'Silenciar microfone'} data-tip={muted ? 'Ativar microfone' : 'Silenciar'}>{muted ? <MicOff size={20} /> : <Mic size={20} />}</button>
      {!compact && <button data-prisma="deafen" className={`ctl${deafened ? ' off' : ''}`} onClick={toggleDeafen} aria-pressed={deafened} aria-label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'} data-tip={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}>{deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}</button>}
      <button data-prisma="voice-camera" className={`ctl${camera ? ' live' : ''}`} onClick={() => void toggleCamera()} aria-pressed={camera} aria-label={camera ? 'Desligar câmera' : 'Ligar câmera'} data-tip={camera ? 'Desligar câmera' : 'Ligar câmera'}>{camera ? <Video size={20} /> : <VideoOff size={20} />}</button>
      <button data-prisma="voice-screen" className={`ctl${screen ? ' live' : ''}`} onClick={() => openModal({ type: 'screenShare' })} aria-pressed={screen} aria-label={screen ? 'Ajustar ou parar transmissão de tela' : 'Compartilhar tela'} data-tip={screen ? 'Transmissão' : 'Compartilhar tela'}>{screen ? <MonitorUp size={20} /> : <MonitorOff size={20} />}</button>
      <button data-prisma="voice-leave" className="ctl hang" onClick={() => void leaveVoice()} aria-label="Sair da chamada" data-tip="Sair da chamada"><PhoneOff size={20} /></button>
    </div>
  )
}

function Elapsed() {
  const joinedAt = useVoice((v) => v.joinedAt)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  return <>{mmss((Date.now() - joinedAt) / 1000)}</>
}

/** Tela da chamada: participantes, câmeras e transmissões. */
export function VoiceStage() {
  const channelId = useVoice((v) => v.channelId)
  const status = useVoice((v) => v.status)
  const focus = useVoice((v) => v.focus)
  const me = useApp((s) => s.userId)!
  const channel = useApp((s) => s.channels.find((c) => c.id === channelId))
  const title = useApp((s) => channelTitle(s, channel))
  const server = useApp((s) => s.servers.find((x) => x.id === channel?.server_id))
  const roster = useMembers()
  const local = useVoice(useShallow((v) => ({ muted: v.muted, deafened: v.deafened, camera: v.camera, screen: v.screen })))
  const members = useMemo(() => {
    const mine: VoiceMember = { user_id: me, channel_id: channelId || '', ...local, streams: {} }
    return [mine, ...roster.filter((m) => m.user_id !== me)]
  }, [roster, me, channelId, local])
  const tiles = useMemo(() => members.flatMap((m) => [
    ...(m.screen ? [{ id: `${m.user_id}:screen`, member: m, kind: 'screen' as const }] : []),
    { id: `${m.user_id}:user`, member: m, kind: 'user' as const },
  ]), [members])
  const focused = tiles.find((t) => t.id === focus) || (tiles.length > 1 ? tiles.find((t) => t.kind === 'screen') : undefined)
  const rest = focused ? tiles.filter((t) => t.id !== focused.id) : tiles
  return (
    <section className="stage" aria-label="Chamada">
      <header className="stage-head">
        <span className="head-glyph"><Volume2 size={19} /></span>
        <div className="chat-head-title">
          <h1>{title || 'Chamada'}</h1>
          <span className="chat-head-sub">{server ? server.name : 'Chamada privada'} · <Elapsed /></span>
        </div>
        <AudioUnlock />
        <Ping />
        <button className="icon-btn" onClick={() => useVoice.setState({ stageOpen: false })} aria-label="Minimizar chamada e voltar ao chat" data-tip="Voltar ao chat" data-tip-side="left"><Minimize2 size={19} /></button>
      </header>
      <div className={`stage-body${focused ? ' has-focus' : ''}`}>
        {status === 'connecting' ? <div className="stage-wait"><span className="pulse-ring" /><p>Conectando à sala…</p></div> : (
          <>
            {focused && <div className="stage-focus"><Tile key={focused.id} {...focused} focused /></div>}
            <div className={`stage-grid n${Math.min(rest.length, 9)}${focused ? ' strip' : ''}`}>
              {rest.map((t) => <Tile key={t.id} {...t} focused={false} small={!!focused} />)}
            </div>
            {members.length === 1 && !focused && <p className="stage-alone">Só você por aqui. Quando alguém entrar, a conexão é direta entre vocês.</p>}
          </>
        )}
      </div>
      <footer className="stage-foot"><Controls /></footer>
    </section>
  )
}

/** Barra de chamada na lateral, acima do painel do usuário. */
export function VoiceBar() {
  const channelId = useVoice((v) => v.channelId)
  const status = useVoice((v) => v.status)
  const stageOpen = useVoice((v) => v.stageOpen)
  const channel = useApp((s) => s.channels.find((c) => c.id === channelId))
  const title = useApp((s) => channelTitle(s, channel))
  const server = useApp((s) => s.servers.find((x) => x.id === channel?.server_id))
  if (!channelId) return null
  return (
    <div className="voice-bar">
      <button className="voice-bar-info" onClick={() => useVoice.setState({ stageOpen: !stageOpen })} aria-label="Abrir a chamada">
        <strong className={status}>{status === 'connecting' ? 'Conectando…' : 'Voz conectada'}</strong>
        <span>{server ? `${title} · ${server.name}` : title}</span>
      </button>
      <Ping compact />
      <AudioUnlock />
      <Controls compact />
    </div>
  )
}

/** Aviso flutuante quando a chamada está minimizada (principalmente no celular). */
export function CallPill() {
  const channelId = useVoice((v) => v.channelId)
  const stageOpen = useVoice((v) => v.stageOpen)
  const live = useVoice((v) => (v.scopeId ? v.rosters[v.scopeId] : undefined)?.some((m) => m.channel_id === v.channelId && m.screen) ?? false)
  if (!channelId || stageOpen) return null
  return (
    <button className="call-pill" onClick={() => useVoice.setState({ stageOpen: true })}>
      <Phone size={15} /> Em chamada · <Elapsed /> {live && <span className="live-tag">AO VIVO</span>} <span className="call-pill-go">Abrir</span>
    </button>
  )
}

// ---- compartilhamento de tela
const RES_ORDER: Resolution[] = ['source', '2160', '1440', '1080', '720']

export function ScreenShareModal() {
  const sharing = useVoice((v) => v.screen)
  const saved = useVoice((v) => v.screenSettings)
  const stats = useVoice((v) => v.screenOut)
  const [s, setS] = useState<ScreenSettings>(saved)
  const [busy, setBusy] = useState(false)
  const supported = canShareScreen()
  const mbps = (screenBitrate(s) / 1_000_000).toFixed(0)
  async function go() {
    setBusy(true)
    if (sharing) { await updateScreenQuality(s); closeModal() }
    else if (await startScreen(s)) closeModal()
    setBusy(false)
  }
  return (
    <Modal title={sharing ? 'Sua transmissão' : 'Compartilhar tela'} onClose={closeModal}>
      <div className="modal-body">
        {!supported ? (
          <p className="notice">Este navegador não permite capturar a tela — isso acontece nos celulares. Você pode assistir às transmissões dos outros normalmente; para transmitir, abra o Krata em um computador.</p>
        ) : (
          <>
            <p className="muted">Qualidade máxima liberada para todo mundo. Se a sua internet oscilar, a transmissão se ajusta sozinha e volta ao máximo quando puder.</p>
            <fieldset className="choice">
              <legend>Resolução</legend>
              <div className="seg">
                {RES_ORDER.map((r) => <button key={r} type="button" aria-pressed={s.resolution === r} className={s.resolution === r ? 'on' : ''} onClick={() => setS({ ...s, resolution: r })}>{RES[r].label}</button>)}
              </div>
            </fieldset>
            <fieldset className="choice">
              <legend>Quadros por segundo</legend>
              <div className="seg">
                {([15, 30, 60] as const).map((f) => <button key={f} type="button" aria-pressed={s.fps === f} className={s.fps === f ? 'on' : ''} onClick={() => setS({ ...s, fps: f })}>{f} fps</button>)}
              </div>
            </fieldset>
            <fieldset className="choice">
              <legend>O que importa mais</legend>
              <div className="seg two">
                <button type="button" aria-pressed={s.mode === 'motion'} className={s.mode === 'motion' ? 'on' : ''} onClick={() => setS({ ...s, mode: 'motion' })}><strong>Fluidez</strong><span>Jogos e vídeos</span></button>
                <button type="button" aria-pressed={s.mode === 'text'} className={s.mode === 'text' ? 'on' : ''} onClick={() => setS({ ...s, mode: 'text' })}><strong>Nitidez</strong><span>Texto e código</span></button>
              </div>
            </fieldset>
            {!sharing && (
              <label className="switch-row">
                <span><strong>Transmitir o som</strong><span className="muted">O navegador pergunta se quer incluir o áudio da aba ou do sistema.</span></span>
                <input type="checkbox" className="switch" checked={s.audio} onChange={(e) => setS({ ...s, audio: e.target.checked })} />
              </label>
            )}
            <p className="fine">Usa até {mbps} Mbps de envio. {sharing && stats?.width ? `Agora: ${stats.width}×${stats.height} a ${stats.fps} fps.` : ''}</p>
          </>
        )}
      </div>
      <footer className="modal-foot">
        {sharing && <button className="btn danger" onClick={() => { stopScreen(); closeModal() }}><MonitorOff size={17} /> Parar transmissão</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={closeModal}>{supported ? 'Cancelar' : 'Entendi'}</button>
        {supported && <button className="btn primary" disabled={busy} onClick={() => void go()}>{sharing ? <><Settings2 size={17} /> Aplicar</> : <><MonitorUp size={17} /> Escolher o que compartilhar</>}</button>}
      </footer>
    </Modal>
  )
}

export function IncomingCall() {
  const incoming = useVoice((v) => v.incoming)
  const caller = useApp((s) => (incoming ? s.profiles[incoming.from] : undefined))
  const channel = useApp((s) => s.channels.find((c) => c.id === incoming?.channelId))
  const title = useApp((s) => channelTitle(s, channel))
  if (!incoming) return null
  return (
    <div className="incoming" role="alertdialog" aria-label="Chamada recebida">
      <div className="incoming-card">
        <div className="incoming-avatar"><span className="pulse-ring" /><span className="pulse-ring late" /><Avatar profile={caller} name={caller?.display_name} seed={incoming.from} size={88} /></div>
        <h2>{caller?.display_name || 'Alguém'}</h2>
        <p className="muted">{channel?.kind === 'group' ? `Chamando o grupo ${title}` : 'Está ligando para você'}</p>
        <div className="incoming-actions">
          <button className="ctl hang big" onClick={declineIncoming} aria-label="Recusar chamada"><PhoneOff size={24} /></button>
          <button className="ctl accept big" onClick={() => void acceptIncoming()} aria-label="Atender chamada" autoFocus><Phone size={24} /></button>
        </div>
      </div>
    </div>
  )
}
