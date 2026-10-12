import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Login, SetupNeeded } from './components/Auth'
import { ChatView } from './components/Chat'
import { Empty, FriendsView, MembersPanel, Rail, Sidebar, UserPanel } from './components/Layout'
import { ModalRoot } from './components/Modals'
import { AudioSink, CallPill, IncomingCall, VoiceBar, VoiceStage } from './components/Voice'
import { ErrorBoundary, Gem, ShardField, Toasts } from './components/ui'
import { applyMotion } from './lib/motion'
import { isConfigured } from './lib/supabase'
import { boot } from './store/actions'
import { openModal, set, useApp } from './store/app'
import { setViewScope, useVoice, voiceDebug } from './voice/engine'

function Shell() {
  const nav = useApp((s) => s.nav)
  const channel = useApp((s) => s.channels.find((c) => c.id === s.nav.channelId))
  const mobileNav = useApp((s) => s.mobileNav)
  const showMembers = useApp((s) => s.showMembers)
  const connection = useApp((s) => s.connection)
  const role = useApp((s) => (nav.serverId ? s.roles[nav.serverId] : null))
  const unreadTotal = useApp((s) => Object.values(s.unread).reduce((a, b) => a + b, 0))
  const inCall = useVoice((v) => !!v.channelId)
  const stage = useVoice((v) => !!v.channelId && v.stageOpen)

  useEffect(() => { setViewScope(nav.serverId ?? (channel && !channel.server_id ? channel.id : null)) }, [nav.serverId, channel])
  useEffect(() => { document.title = unreadTotal > 0 ? `(${unreadTotal > 99 ? '99+' : unreadTotal}) Krata` : 'Krata' }, [unreadTotal])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openModal({ type: 'switcher' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // avisa antes de fechar a aba no meio de uma chamada
  useEffect(() => {
    if (!inCall) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [inCall])

  const members = channel && channel.kind !== 'dm' && showMembers && !stage
  return (
    <div className={`shell${mobileNav && !stage ? ' nav-open' : ''}${members ? ' members-open' : ''}`}>
      <a className="skip" href="#main">Pular para o conteúdo</a>
      <div className="nav-col">
        <Rail />
        <Sidebar><VoiceBar /><UserPanel /></Sidebar>
      </div>
      <main className="main" id="main">
        {connection === 'reconnecting' && <div className="net-banner" role="status">Reconectando… as mensagens novas aparecem assim que a conexão voltar.</div>}
        <ErrorBoundary key={stage ? 'stage' : channel?.id || nav.serverId || 'home'}>
        <div className="view">
          {stage ? <VoiceStage /> : channel ? <ChatView key={channel.id} channel={channel} /> : nav.serverId ? (
            <section className="friends">
              <Empty title="Nenhum canal de texto por aqui" text={role === 'owner' || role === 'admin' ? 'Crie um canal para começar a conversa.' : 'Peça para um administrador criar um canal.'}
                action={<><button className="btn ghost only-mobile" onClick={() => set({ mobileNav: true })}>Ver canais</button>{(role === 'owner' || role === 'admin') && <button className="btn primary" onClick={() => openModal({ type: 'channel', serverId: nav.serverId!, kind: 'text' })}>Criar canal</button>}</>} />
            </section>
          ) : <FriendsView />}
        </div>
        </ErrorBoundary>
      </main>
      {members && (
        <>
          <div className="members-veil only-mobile" onClick={() => set({ showMembers: false })} />
          <MembersPanel channel={channel} />
        </>
      )}
      <CallPill />
    </div>
  )
}

// Ferramenta de diagnóstico: ative com localStorage.setItem('krata-debug', '1')
try { if (localStorage.getItem('krata-debug') === '1') Object.assign(window, { __krata: { app: useApp, voice: useVoice, debug: voiceDebug } }) } catch { /* sem armazenamento */ }

applyMotion()

/**
 * Troca de tela com transição: a tela que sai continua visível por um instante
 * (voando para frente e sumindo) enquanto a nova entra.
 */
function ScreenSwitch({ id, children }: { id: string; children: ReactNode }) {
  const last = useRef<{ id: string; node: ReactNode }>({ id, node: children })
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode }[]>([])
  useLayoutEffect(() => {
    const old = last.current
    if (old.id === id) return
    // só anima a saída de telas sem dados do usuário (login e carregamento)
    if (old.id === 'login' || old.id === 'splash' || old.id === 'setup') {
      setLeaving((l) => [...l.filter((x) => x.id !== old.id && x.id !== id), old])
      setTimeout(() => setLeaving((l) => l.filter((x) => x !== old)), 700)
    }
  }, [id])
  useEffect(() => { last.current = { id, node: children } })
  return (
    <>
      {leaving.filter((l) => l.id !== id).map((l) => <div key={l.id} className={`screen leaving from-${l.id}`} aria-hidden="true">{l.node}</div>)}
      <div key={id} className={`screen entering to-${id}`}>{children}</div>
    </>
  )
}

export default function App() {
  const booting = useApp((s) => s.booting)
  const userId = useApp((s) => s.userId)
  const me = useApp((s) => s.me)
  const ready = useApp((s) => s.structureLoaded)
  useEffect(() => { if (isConfigured) void boot() }, [])
  let screen, id
  if (!isConfigured) { screen = <SetupNeeded />; id = 'setup' }
  else if (booting || (userId && !me) || (me && !ready)) {
    id = 'splash'
    screen = <div className="splash"><ShardField density={0.6} /><Gem size={150} interactive /><span className="wordmark"><span>Krata</span></span></div>
  } else if (!userId || !me) { screen = <Login />; id = 'login' }
  else { screen = <Shell />; id = 'app' }
  return (
    <>
      <ScreenSwitch id={id}>{screen}</ScreenSwitch>
      <AudioSink />
      <IncomingCall />
      <ModalRoot />
      <Toasts />
    </>
  )
}
