import { useEffect } from 'react'
import { Login, SetupNeeded } from './components/Auth'
import { ChatView } from './components/Chat'
import { Empty, FriendsView, MembersPanel, Rail, Sidebar, UserPanel } from './components/Layout'
import { ModalRoot } from './components/Modals'
import { AudioSink, CallPill, IncomingCall, VoiceBar, VoiceStage } from './components/Voice'
import { ErrorBoundary, Gem, Toasts } from './components/ui'
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

export default function App() {
  const booting = useApp((s) => s.booting)
  const userId = useApp((s) => s.userId)
  const me = useApp((s) => s.me)
  const ready = useApp((s) => s.structureLoaded)
  useEffect(() => { if (isConfigured) void boot() }, [])
  let screen
  if (!isConfigured) screen = <SetupNeeded />
  else if (booting || (userId && !me) || (me && !ready)) screen = <div className="splash"><Gem size={150} /><span className="wordmark"><span>Krata</span></span></div>
  else if (!userId || !me) screen = <Login />
  else screen = <Shell />
  return (
    <>
      {screen}
      <AudioSink />
      <IncomingCall />
      <ModalRoot />
      <Toasts />
    </>
  )
}
