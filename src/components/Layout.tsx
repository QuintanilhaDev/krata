import {
  Check, ChevronDown, Compass, Headphones, HeadphoneOff, LogOut, Menu, MessageCircle, Mic, MicOff, Phone, Plus, Search, Settings,
  Hash, UserPlus, Users, Video, Volume2, X, Pencil, UserRoundPlus,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Channel, Profile, Status } from '../lib/types'
import {
  acceptFriend, byPosition, leaveGroup, leaveServer, navigate, openDm, removeFriend, sendFriendRequest, updateProfile,
} from '../store/actions'
import { channelTitle, dmPartnerIds, friendIds, openModal, presenceOf, set, useApp, type AppState } from '../store/app'
import { joinVoice, toggleDeafen, toggleMute, useVoice, type VoiceMember } from '../voice/engine'
import { Avatar, Logo, STATUS_LABEL, StatusDot, useClickOutside } from './ui'

const NONE: VoiceMember[] = []

// ============================================================ trilho de servidores
export function Rail() {
  const servers = useApp((s) => s.servers)
  const channels = useApp((s) => s.channels)
  const unread = useApp((s) => s.unread)
  const nav = useApp((s) => s.nav)
  const state = useApp()
  const dmUnread = channels.filter((c) => !c.server_id && unread[c.id] > 0)
  const totalDm = dmUnread.reduce((n, c) => n + unread[c.id], 0)
  const serverUnread = (id: string) => channels.some((c) => c.server_id === id && unread[c.id] > 0)
  return (
    <nav className="rail" aria-label="Servidores">
      <button className={`rail-item home${!nav.serverId ? ' on' : ''}`} onClick={() => navigate({ serverId: null, channelId: null }, { keepPanel: true })} aria-label="Conversas e amigos" data-tip="Conversas" data-tip-side="right">
        <span className="rail-face"><Logo size={30} /></span>
        {totalDm > 0 && <span className="badge">{totalDm > 99 ? '99+' : totalDm}</span>}
      </button>
      {dmUnread.slice(0, 4).map((c) => {
        const partner = state.profiles[dmPartnerIds(state, c.id)[0]]
        const title = channelTitle(state, c)
        return (
          <button key={c.id} className="rail-item dm" onClick={() => navigate({ serverId: null, channelId: c.id })} aria-label={`${title}: ${unread[c.id]} mensagens novas`} data-tip={title} data-tip-side="right">
            <span className="rail-face">{c.kind === 'dm' ? <Avatar profile={partner} name={title} size={48} /> : <Users size={22} />}</span>
            <span className="badge">{unread[c.id]}</span>
          </button>
        )
      })}
      <span className="rail-sep" />
      <div className="rail-scroll">
        {servers.map((sv) => (
          <button key={sv.id} className={`rail-item${nav.serverId === sv.id ? ' on' : ''}${serverUnread(sv.id) ? ' unread' : ''}`} onClick={() => navigate({ serverId: sv.id, channelId: null }, { keepPanel: true })} aria-label={sv.name} aria-current={nav.serverId === sv.id} data-tip={sv.name} data-tip-side="right">
            <span className="rail-face"><Avatar url={sv.icon_url} name={sv.name} seed={sv.id} size={48} square /></span>
          </button>
        ))}
        <button className="rail-item add" onClick={() => openModal({ type: 'createServer' })} aria-label="Criar um servidor" data-tip="Criar um servidor" data-tip-side="right"><span className="rail-face"><Plus size={22} /></span></button>
        <button className="rail-item add" onClick={() => openModal({ type: 'joinServer' })} aria-label="Entrar com um convite" data-tip="Entrar com convite" data-tip-side="right"><span className="rail-face"><Compass size={21} /></span></button>
      </div>
    </nav>
  )
}

// ============================================================ painel do usuário
const STATUSES: Status[] = ['online', 'idle', 'dnd', 'invisible']

export function UserPanel() {
  const me = useApp((s) => s.me)!
  const muted = useVoice((v) => v.muted)
  const deafened = useVoice((v) => v.deafened)
  const speaking = useVoice((v) => !!v.speaking[me.id])
  const [menu, setMenu] = useState(false)
  const [custom, setCustom] = useState(me.custom_status)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setMenu(false), menu)
  useEffect(() => { if (menu) setCustom(me.custom_status) }, [menu, me.custom_status])
  const shown = me.status === 'invisible' ? 'offline' : me.status
  return (
    <div className="user-panel" ref={ref}>
      {menu && (
        <div className="pop status-menu" role="menu">
          <form onSubmit={(e) => { e.preventDefault(); void updateProfile({ custom_status: custom.trim() }); setMenu(false) }}>
            <input className="input" value={custom} maxLength={80} placeholder="Defina um status personalizado" aria-label="Status personalizado" onChange={(e) => setCustom(e.target.value)} />
          </form>
          {STATUSES.map((st) => (
            <button key={st} role="menuitemradio" aria-checked={me.status === st} className="menu-item" onClick={() => { void updateProfile({ status: st }); setMenu(false) }}>
              <StatusDot status={st === 'invisible' ? 'offline' : st} /> {STATUS_LABEL[st]} {me.status === st && <Check size={15} className="end" />}
            </button>
          ))}
        </div>
      )}
      <button className="user-chip" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} aria-label="Mudar status">
        <Avatar profile={me} size={34} status={shown} speaking={speaking} />
        <span className="user-chip-text">
          <strong>{me.display_name}</strong>
          <span>{me.custom_status || STATUS_LABEL[me.status]}</span>
        </span>
      </button>
      <button className={`icon-btn${muted ? ' off' : ''}`} onClick={() => void toggleMute()} aria-label={muted ? 'Ativar microfone' : 'Silenciar microfone'} aria-pressed={muted} data-tip={muted ? 'Ativar microfone' : 'Silenciar'}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</button>
      <button className={`icon-btn${deafened ? ' off' : ''}`} onClick={toggleDeafen} aria-label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'} aria-pressed={deafened} data-tip={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}>{deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}</button>
      <button className="icon-btn" onClick={() => openModal({ type: 'settings' })} aria-label="Configurações" data-tip="Configurações"><Settings size={18} /></button>
    </div>
  )
}

// ============================================================ barra lateral: conversas
function HomeSidebar() {
  const state = useApp()
  const { channels, unread, nav, friends, userId } = state
  const pending = friends.filter((f) => f.status === 'pending' && f.addressee_id === userId).length
  const dms = useMemo(() => channels.filter((c) => !c.server_id).sort((a, b) => (b.last_message_at || b.created_at).localeCompare(a.last_message_at || a.created_at)), [channels])
  return (
    <>
      <header className="side-head">
        <button className="search-trigger" onClick={() => openModal({ type: 'switcher' })}><Search size={15} /> Buscar ou ir para…</button>
      </header>
      <div className="side-scroll">
        <button className={`side-item${!nav.channelId ? ' on' : ''}`} onClick={() => navigate({ serverId: null, channelId: null })}>
          <Users size={19} /> <span className="grow">Amigos</span>
          {pending > 0 && <span className="badge inline">{pending}</span>}
        </button>
        <div className="side-label">
          <span>Mensagens diretas</span>
          <button className="icon-btn tiny" onClick={() => openModal({ type: 'newDm' })} aria-label="Nova conversa" data-tip="Nova conversa"><Plus size={16} /></button>
        </div>
        {dms.length === 0 && <p className="side-empty">Nenhuma conversa ainda. Adicione um amigo e chame para conversar.</p>}
        {dms.map((c) => {
          const ids = dmPartnerIds(state, c.id)
          const partner = state.profiles[ids[0]]
          const title = channelTitle(state, c)
          const inVoice = c.kind === 'dm' && !!state.online[ids[0]]?.voice
          return (
            <button key={c.id} className={`side-item dm${nav.channelId === c.id ? ' on' : ''}${unread[c.id] ? ' unread' : ''}`} onClick={() => navigate({ serverId: null, channelId: c.id })}>
              {c.kind === 'dm' ? <Avatar profile={partner} name={title} size={34} status={presenceOf(state, ids[0])} /> : <span className="group-face"><Users size={17} /></span>}
              <span className="grow two-line">
                <strong>{title}</strong>
                <span>{c.kind === 'group' ? `${ids.length + 1} pessoas` : inVoice ? <><Volume2 size={12} /> Em chamada</> : partner?.custom_status || ''}</span>
              </span>
              {unread[c.id] > 0 && <span className="badge inline">{unread[c.id]}</span>}
            </button>
          )
        })}
      </div>
    </>
  )
}

// ============================================================ barra lateral: servidor
function VoiceRow({ m, profile }: { m: VoiceMember; profile?: Profile }) {
  const speaking = useVoice((v) => !!v.speaking[m.user_id])
  return (
    <button className="voice-user" onClick={() => openModal({ type: 'profile', userId: m.user_id })}>
      <Avatar profile={profile} size={24} speaking={speaking} />
      <span className="grow">{profile?.display_name || 'Usuário'}</span>
      {m.screen && <span className="live-tag">AO VIVO</span>}
      {m.camera && <Video size={14} />}
      {m.deafened ? <HeadphoneOff size={14} /> : m.muted ? <MicOff size={14} /> : null}
    </button>
  )
}

function ServerSidebar({ serverId }: { serverId: string }) {
  const server = useApp((s) => s.servers.find((x) => x.id === serverId))
  const channels = useApp((s) => s.channels)
  const unread = useApp((s) => s.unread)
  const nav = useApp((s) => s.nav)
  const role = useApp((s) => s.roles[serverId])
  const profiles = useApp((s) => s.profiles)
  const roster = useVoice((v) => v.rosters[serverId]) ?? NONE
  const voiceChannel = useVoice((v) => v.channelId)
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setMenu(false), menu)
  const admin = role === 'owner' || role === 'admin'
  const groups = useMemo(() => {
    const list = channels.filter((c) => c.server_id === serverId).sort((a, b) => (a.kind === b.kind ? byPosition(a, b) : a.kind === 'text' ? -1 : 1))
    const map = new Map<string, Channel[]>()
    for (const c of list) { const k = c.category || (c.kind === 'text' ? 'Canais de texto' : 'Canais de voz'); map.set(k, [...(map.get(k) || []), c]) }
    return [...map.entries()]
  }, [channels, serverId])
  if (!server) return null
  return (
    <>
      <header className="side-head server" ref={ref}>
        <button className="server-title" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}>
          <span>{server.name}</span><ChevronDown size={17} className={menu ? 'flip' : ''} />
        </button>
        {menu && (
          <div className="pop server-menu" role="menu" onClick={() => setMenu(false)}>
            <button className="menu-item accent" role="menuitem" onClick={() => openModal({ type: 'invite', serverId })}><UserPlus size={16} /> Convidar pessoas</button>
            {admin && <button className="menu-item" role="menuitem" onClick={() => openModal({ type: 'serverSettings', serverId })}><Settings size={16} /> Configurações do servidor</button>}
            {admin && <button className="menu-item" role="menuitem" onClick={() => openModal({ type: 'channel', serverId, kind: 'text' })}><Plus size={16} /> Criar canal</button>}
            {role !== 'owner' && (
              <button className="menu-item danger" role="menuitem" onClick={() => openModal({ type: 'confirm', title: `Sair de ${server.name}`, text: 'Você só volta com um novo convite.', action: 'Sair do servidor', danger: true, onConfirm: () => leaveServer(serverId) })}><LogOut size={16} /> Sair do servidor</button>
            )}
          </div>
        )}
      </header>
      <div className="side-scroll">
        {groups.length === 0 && <p className="side-empty">Este servidor ainda não tem canais.</p>}
        {groups.map(([category, list]) => (
          <div key={category} className="side-group">
            <div className="side-label">
              <span>{category}</span>
              {admin && <button className="icon-btn tiny" aria-label={`Criar canal em ${category}`} data-tip="Criar canal" onClick={() => openModal({ type: 'channel', serverId, kind: list[0].kind as 'text' | 'voice', category })}><Plus size={16} /></button>}
            </div>
            {list.map((c) => {
              const here = c.kind === 'voice' ? roster.filter((m) => m.channel_id === c.id) : NONE
              const on = c.kind === 'text' ? nav.channelId === c.id : voiceChannel === c.id
              return (
                <div key={c.id}>
                  <div className={`side-item channel${on ? ' on' : ''}${unread[c.id] ? ' unread' : ''}`}>
                    <button className="channel-main" onClick={() => (c.kind === 'text' ? navigate({ serverId, channelId: c.id }) : void joinVoice(c.id))} aria-current={on} aria-label={c.kind === 'voice' ? `Entrar na sala de voz ${c.name}` : `Canal ${c.name}`}>
                      {c.kind === 'text' ? <Hash size={18} /> : <Volume2 size={18} />}
                      <span className="grow">{c.name}</span>
                      {unread[c.id] > 0 && <span className="dot" aria-label="Mensagens novas" />}
                    </button>
                    {admin && <button className="icon-btn tiny reveal" aria-label={`Editar canal ${c.name}`} onClick={() => openModal({ type: 'channel', serverId, channel: c })}><Pencil size={14} /></button>}
                  </div>
                  {here.length > 0 && <div className="voice-users">{here.map((m) => <VoiceRow key={m.user_id} m={m} profile={profiles[m.user_id]} />)}</div>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

export function Sidebar({ children }: { children?: React.ReactNode }) {
  const serverId = useApp((s) => s.nav.serverId)
  return (
    <aside className="sidebar" key={serverId || 'home'}>
      {serverId ? <ServerSidebar serverId={serverId} /> : <HomeSidebar />}
      {children}
    </aside>
  )
}

// ============================================================ lista de pessoas
const ROLE_LABEL = { owner: 'Dono', admin: 'Administradores', member: 'Membros' } as const

function PersonRow({ p, status, tag, onClick }: { p: Profile; status: Status | 'offline'; tag?: string; onClick: () => void }) {
  return (
    <button className={`person${status === 'offline' ? ' off' : ''}`} onClick={onClick}>
      <Avatar profile={p} size={34} status={status} />
      <span className="grow two-line"><strong style={{ color: status !== 'offline' && p.accent_color.toLowerCase() !== '#00a86b' ? p.accent_color : undefined }}>{p.display_name}</strong><span>{p.custom_status}</span></span>
      {tag && <span className="role-tag">{tag}</span>}
    </button>
  )
}

export function MembersPanel({ channel }: { channel: Channel }) {
  const state = useApp()
  const sections = useMemo(() => {
    const out: { label: string; rows: { p: Profile; status: Status | 'offline'; tag?: string }[] }[] = []
    const row = (id: string, tag?: string) => ({ p: state.profiles[id], status: presenceOf(state, id), tag })
    if (channel.server_id) {
      const members = (state.members[channel.server_id] || []).filter((m) => state.profiles[m.user_id])
      const online = members.filter((m) => presenceOf(state, m.user_id) !== 'offline')
      for (const r of ['owner', 'admin', 'member'] as const) {
        const rows = online.filter((m) => m.role === r).map((m) => row(m.user_id))
        if (rows.length) out.push({ label: ROLE_LABEL[r], rows })
      }
      const off = members.filter((m) => presenceOf(state, m.user_id) === 'offline').map((m) => row(m.user_id, m.role === 'owner' ? 'Dono' : m.role === 'admin' ? 'Admin' : undefined))
      if (off.length) out.push({ label: 'Offline', rows: off })
    } else {
      const ids = [state.userId!, ...dmPartnerIds(state, channel.id)].filter((id) => state.profiles[id])
      out.push({ label: 'Pessoas no grupo', rows: ids.map((id) => row(id, id === channel.owner_id ? 'Criador' : undefined)) })
    }
    for (const s of out) s.rows.sort((a, b) => a.p.display_name.localeCompare(b.p.display_name, 'pt-BR'))
    return out
  }, [state, channel])
  return (
    <aside className="members" aria-label="Pessoas">
      <header className="members-head only-mobile">
        <strong>Pessoas</strong>
        <button className="icon-btn" onClick={() => set({ showMembers: false })} aria-label="Fechar lista de pessoas"><X size={18} /></button>
      </header>
      <div className="side-scroll">
        {sections.map((s) => (
          <div key={s.label}>
            <div className="side-label"><span>{s.label} — {s.rows.length}</span></div>
            {s.rows.map((r) => <PersonRow key={r.p.id} {...r} onClick={() => openModal({ type: 'profile', userId: r.p.id })} />)}
          </div>
        ))}
        {channel.kind === 'group' && (
          <button className="side-item danger" onClick={() => openModal({ type: 'confirm', title: 'Sair do grupo', text: 'Você deixa de receber as mensagens deste grupo.', action: 'Sair do grupo', danger: true, onConfirm: () => leaveGroup(channel.id) })}><LogOut size={17} /> Sair do grupo</button>
        )}
      </div>
    </aside>
  )
}

// ============================================================ amigos
const TABS: { id: AppState['homeTab']; label: string }[] = [
  { id: 'online', label: 'Disponíveis' }, { id: 'all', label: 'Todos' }, { id: 'pending', label: 'Pendentes' }, { id: 'add', label: 'Adicionar amigo' },
]

export function FriendsView() {
  const state = useApp()
  const { homeTab: tab, friends, userId, profiles } = state
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const accepted = friendIds(state).map((id) => profiles[id]).filter(Boolean)
  const pending = friends.filter((f) => f.status === 'pending')
  const incoming = pending.filter((f) => f.addressee_id === userId)
  const shown = (tab === 'online' ? accepted.filter((p) => presenceOf(state, p.id) !== 'offline') : accepted)
    .filter((p) => !filter || p.display_name.toLowerCase().includes(filter.toLowerCase()) || p.username.includes(filter.toLowerCase()))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pt-BR'))
  const friendshipOf = (id: string) => friends.find((f) => f.requester_id === id || f.addressee_id === id)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    if (await sendFriendRequest(name)) setName('')
    setBusy(false)
  }

  return (
    <section className="friends">
      <header className="chat-head">
        <button className="icon-btn only-mobile" onClick={() => set({ mobileNav: true })} aria-label="Abrir lista de conversas"><Menu size={20} /></button>
        <span className="head-glyph"><Users size={20} /></span>
        <div className="chat-head-title"><h1>Amigos</h1></div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' on' : ''}${t.id === 'add' ? ' cta' : ''}`} onClick={() => set({ homeTab: t.id })}>
              {t.label}{t.id === 'pending' && incoming.length > 0 && <span className="badge inline">{incoming.length}</span>}
            </button>
          ))}
        </div>
      </header>
      <div className="friends-body">
        {tab === 'add' ? (
          <div className="add-friend">
            <h2>Adicionar amigo</h2>
            <p className="muted">Digite o nome de usuário exatamente como a pessoa escolheu.</p>
            <form className="add-friend-form" onSubmit={add}>
              <div className="input with-prefix big"><span>@</span><input value={name} maxLength={21} autoFocus placeholder="nome.de.usuario" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Nome de usuário" onChange={(e) => setName(e.target.value.toLowerCase().replace(/[\s@]/g, ''))} /></div>
              <button className="btn primary" disabled={busy || name.trim().length < 3}><UserRoundPlus size={17} /> Enviar pedido</button>
            </form>
            <p className="fine">Seu nome de usuário é <strong>@{state.me?.username}</strong> — passe para quem quiser te adicionar.</p>
          </div>
        ) : tab === 'pending' ? (
          pending.length === 0 ? <Empty title="Nenhum pedido pendente" text="Quando alguém te adicionar, o pedido aparece aqui." /> : (
            <ul className="friend-list">
              {pending.map((f) => {
                const mine = f.requester_id === userId
                const p = profiles[mine ? f.addressee_id : f.requester_id]
                if (!p) return null
                return (
                  <li key={f.id} className="friend-row">
                    <Avatar profile={p} size={40} />
                    <span className="grow two-line"><strong>{p.display_name}</strong><span>{mine ? 'Pedido enviado' : 'Quer ser seu amigo'} · @{p.username}</span></span>
                    {!mine && <button className="btn primary small" onClick={() => void acceptFriend(f.id)}><Check size={16} /> Aceitar</button>}
                    <button className="btn ghost small" onClick={() => void removeFriend(f.id)}>{mine ? 'Cancelar' : 'Recusar'}</button>
                  </li>
                )
              })}
            </ul>
          )
        ) : accepted.length === 0 ? (
          <Empty title="Sua lista de amigos está vazia" text="Adicione alguém pelo nome de usuário para conversar e fazer chamadas." action={<button className="btn primary" onClick={() => set({ homeTab: 'add' })}><UserRoundPlus size={17} /> Adicionar amigo</button>} />
        ) : (
          <>
            <div className="input with-prefix friend-filter"><Search size={16} /><input value={filter} placeholder="Filtrar amigos" aria-label="Filtrar amigos" onChange={(e) => setFilter(e.target.value)} /></div>
            <div className="side-label"><span>{tab === 'online' ? 'Disponíveis' : 'Todos os amigos'} — {shown.length}</span></div>
            {shown.length === 0 ? <p className="muted pad">{tab === 'online' ? 'Nenhum amigo disponível agora.' : 'Ninguém com esse nome.'}</p> : (
              <ul className="friend-list">
                {shown.map((p) => {
                  const st = presenceOf(state, p.id)
                  return (
                    <li key={p.id} className="friend-row">
                      <button className="plain friend-main" onClick={() => openModal({ type: 'profile', userId: p.id })}>
                        <Avatar profile={p} size={40} status={st} />
                        <span className="grow two-line"><strong>{p.display_name}</strong><span>{p.custom_status || STATUS_LABEL[st]}</span></span>
                      </button>
                      <button className="icon-btn round" data-tip="Conversar" aria-label={`Conversar com ${p.display_name}`} onClick={() => void openDm(p.id)}><MessageCircle size={18} /></button>
                      <button className="icon-btn round hide-narrow" data-tip="Ligar" aria-label={`Ligar para ${p.display_name}`} onClick={() => void openDm(p.id).then(() => { const ch = useApp.getState().nav.channelId; if (ch) void joinVoice(ch, { ring: true }) })}><Phone size={17} /></button>
                      <button className="icon-btn round danger" data-tip="Desfazer amizade" aria-label={`Desfazer amizade com ${p.display_name}`} onClick={() => { const f = friendshipOf(p.id); if (f) openModal({ type: 'confirm', title: 'Desfazer amizade', text: `${p.display_name} sai da sua lista de amigos.`, action: 'Desfazer amizade', danger: true, onConfirm: () => removeFriend(f.id) }) }}><X size={17} /></button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  )
}

export function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true"><Logo size={56} /></div>
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      {action}
    </div>
  )
}

