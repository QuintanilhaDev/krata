import {
  Camera, Check, Copy, Crown, Download, Hash, ImagePlus, LogOut, MessageCircle, Phone, RefreshCw, Search, Shield, Trash2, UserMinus,
  UserRoundPlus, Users, Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { errorText, safeMediaUrl, supabase } from '../lib/supabase'
import { stamp } from '../lib/time'
import type { Message, Profile } from '../lib/types'
import { MAX_AVATAR_BYTES, uploadFile } from '../lib/upload'
import {
  addEmoji, createGroup, createServer, deleteChannel, deleteServer, fetchPins, inviteCodeFrom, invitePreview, joinServer, kickMember,
  loadMembers, navigate, openDm, regenerateInvite, removeEmoji, removeFriend, saveChannel, searchMessages, sendFriendRequest,
  setMemberRole, signOut, transferServer, updateProfile, updateServer,
} from '../store/actions'
import { channelTitle, closeModal, friendIds, openModal, presenceOf, toast, useApp, type ModalState } from '../store/app'
import { joinVoice, reloadMic, saveVoiceSettings, voiceSettings } from '../voice/engine'
import { Markdown, plain } from './Markdown'
import { Avatar, ErrorBoundary, Field, Modal, STATUS_LABEL, Spinner, Tilt } from './ui'
import { PasswordInput, Strength, passwordError } from './Auth'
import { motionLevel, setMotion } from '../lib/motion'
import { AppDownload, AppInstallSteps, AppNotificationSettings } from './AppDownload'
import { UpdateRow } from './AppUpdate'
import { PrismaSettings } from './Prisma'
import { ScreenShareModal } from './Voice'

type Of<T extends ModalState['type']> = Extract<ModalState, { type: T }>

async function pickImage(file: File | undefined, userId: string): Promise<string | null> {
  if (!file) return null
  if (!file.type.startsWith('image/')) { toast('Escolha um arquivo de imagem.', 'error'); return null }
  if (file.size > MAX_AVATAR_BYTES) { toast('A imagem pode ter até 10 MB.', 'error'); return null }
  try { return await uploadFile('avatars', userId, file).promise } catch (e) { toast(errorText(e), 'error'); return null }
}

function ImagePick({ url, name, seed, square, onChange, label }: { url: string | null; name: string; seed: string; square?: boolean; onChange: (url: string | null) => void; label: string }) {
  const uid = useApp((s) => s.userId)!
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="image-pick">
      <button type="button" className="avatar-pick" onClick={() => input.current?.click()} aria-label={label}>
        <Avatar url={url} name={name || '?'} seed={seed} size={84} square={square} />
        <span className="avatar-pick-badge">{busy ? '…' : <Camera size={15} />}</span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = ''
        setBusy(true); const u = await pickImage(f, uid); setBusy(false)
        if (u) onChange(u)
      }} />
      {url && <button type="button" className="link" onClick={() => onChange(null)}>Remover imagem</button>}
    </div>
  )
}

// ============================================================ servidores
function CreateServer() {
  const me = useApp((s) => s.me)!
  const [name, setName] = useState(`Servidor de ${me.display_name.split(' ')[0]}`)
  const [icon, setIcon] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Criar um servidor" onClose={closeModal}>
      <form onSubmit={async (e) => { e.preventDefault(); if (busy || !name.trim()) return; setBusy(true); if (await createServer(name, icon)) closeModal(); setBusy(false) }}>
        <div className="modal-body">
          <p className="muted">Um servidor é o lugar do seu grupo: canais de texto, salas de voz e transmissões.</p>
          <ImagePick url={icon} name={name} seed={name} square onChange={setIcon} label="Escolher ícone do servidor" />
          <Field label="Nome do servidor"><input className="input" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <footer className="modal-foot">
          <button type="button" className="link" onClick={() => openModal({ type: 'joinServer' })}>Tenho um convite</button>
          <span className="grow" />
          <button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Criando…' : 'Criar servidor'}</button>
        </footer>
      </form>
    </Modal>
  )
}

function JoinServer({ code: initial }: Of<'joinServer'>) {
  const [value, setValue] = useState(initial || '')
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof invitePreview>> | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const code = inviteCodeFrom(value)
  useEffect(() => {
    setPreview(undefined)
    if (code.length < 6) return
    let live = true
    const t = setTimeout(async () => { const p = await invitePreview(code); if (live) setPreview(p) }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [code])
  async function go(e: React.FormEvent) {
    e.preventDefault()
    if (!preview || busy) return
    setBusy(true)
    if (preview.already_member) { navigate({ serverId: preview.id, channelId: null }); closeModal() }
    else if (await joinServer(code)) closeModal()
    setBusy(false)
  }
  return (
    <Modal title="Entrar em um servidor" onClose={closeModal}>
      <form onSubmit={go}>
        <div className="modal-body">
          <Field label="Link ou código do convite" error={code.length >= 6 && preview === null ? 'Convite inválido. Peça um novo link para quem te convidou.' : null}>
            <input className="input" value={value} autoFocus placeholder="Cole o link que você recebeu" onChange={(e) => setValue(e.target.value)} />
          </Field>
          {preview && (
            <div className="invite-preview">
              <Avatar url={preview.icon_url} name={preview.name} seed={preview.id} size={56} square />
              <span className="two-line"><strong>{preview.name}</strong><span>{preview.member_count} {Number(preview.member_count) === 1 ? 'pessoa' : 'pessoas'}{preview.already_member ? ' · você já participa' : ''}</span></span>
            </div>
          )}
        </div>
        <footer className="modal-foot">
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={closeModal}>Cancelar</button>
          <button className="btn primary" disabled={!preview || busy}>{preview?.already_member ? 'Abrir servidor' : busy ? 'Entrando…' : 'Entrar no servidor'}</button>
        </footer>
      </form>
    </Modal>
  )
}

const inviteLink = (code: string) => `${location.origin}${location.pathname}#/invite/${code}`
const copy = (text: string, done: string) => navigator.clipboard?.writeText(text).then(() => toast(done, 'ok'), () => toast('Não foi possível copiar. Selecione e copie manualmente.', 'error'))

function Invite({ serverId }: Of<'invite'>) {
  const server = useApp((s) => s.servers.find((x) => x.id === serverId))
  if (!server) return null
  const link = inviteLink(server.invite_code)
  return (
    <Modal title={`Convidar para ${server.name}`} onClose={closeModal}>
      <div className="modal-body">
        <p className="muted">Mande este link para quem você quer no servidor. Ele funciona até você gerar outro.</p>
        <div className="copy-row">
          <input className="input" readOnly value={link} aria-label="Link do convite" onFocus={(e) => e.target.select()} />
          <button className="btn primary" autoFocus onClick={() => void copy(link, 'Link copiado')}><Copy size={16} /> Copiar</button>
        </div>
      </div>
    </Modal>
  )
}

function ServerSettings({ serverId }: Of<'serverSettings'>) {
  const server = useApp((s) => s.servers.find((x) => x.id === serverId))
  const members = useApp((s) => s.members[serverId])
  const profiles = useApp((s) => s.profiles)
  const emojis = useApp((s) => s.emojis)
  const role = useApp((s) => s.roles[serverId])
  const uid = useApp((s) => s.userId)
  const [tab, setTab] = useState<'geral' | 'pessoas' | 'emojis' | 'convite'>('geral')
  const [name, setName] = useState(server?.name || '')
  const [icon, setIcon] = useState(server?.icon_url ?? null)
  const [emojiName, setEmojiName] = useState('')
  const [busy, setBusy] = useState(false)
  const emojiFile = useRef<HTMLInputElement>(null)
  useEffect(() => { void loadMembers(serverId) }, [serverId])
  if (!server) return null
  const owner = role === 'owner'
  const list = Object.values(emojis).filter((e) => e.server_id === serverId)
  const dirty = name.trim() !== server.name || icon !== server.icon_url
  return (
    <Modal title={`Configurações de ${server.name}`} onClose={closeModal} wide>
      <div className="tabs pad" role="tablist">
        {(['geral', 'pessoas', 'emojis', 'convite'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{{ geral: 'Visão geral', pessoas: 'Pessoas', emojis: 'Emojis', convite: 'Convite' }[t]}</button>
        ))}
      </div>
      <div className="modal-body tall">
        {tab === 'geral' && (
          <>
            <ImagePick url={icon} name={name} seed={server.id} square onChange={setIcon} label="Trocar ícone do servidor" />
            <Field label="Nome do servidor"><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
            <button className="btn primary" disabled={!dirty || !name.trim() || busy} onClick={async () => { setBusy(true); if (await updateServer(serverId, { name: name.trim(), icon_url: icon })) toast('Servidor atualizado', 'ok'); setBusy(false) }}>Salvar alterações</button>
            {owner && (
              <div className="danger-zone">
                <div><strong>Apagar servidor</strong><p className="muted">Apaga canais, mensagens e emojis para todo mundo. Não dá para desfazer.</p></div>
                <button className="btn danger" onClick={() => openModal({ type: 'confirm', title: `Apagar ${server.name}`, text: 'Todos os canais e mensagens somem para todo mundo. Não dá para desfazer.', action: 'Apagar servidor', danger: true, onConfirm: () => deleteServer(serverId) })}><Trash2 size={16} /> Apagar servidor</button>
              </div>
            )}
          </>
        )}
        {tab === 'pessoas' && (!members ? <Spinner /> : (
          <ul className="friend-list">
            {[...members].sort((a, b) => 'owner admin member'.indexOf(a.role) - 'owner admin member'.indexOf(b.role)).map((m) => {
              const p = profiles[m.user_id]
              if (!p) return null
              return (
                <li key={m.user_id} className="friend-row">
                  <Avatar profile={p} size={36} />
                  <span className="grow two-line"><strong>{p.display_name}</strong><span>@{p.username}</span></span>
                  {m.role === 'owner' ? <span className="role-tag"><Crown size={13} /> Dono</span> : owner ? (
                    <select className="input small" value={m.role} aria-label={`Cargo de ${p.display_name}`} onChange={(e) => void setMemberRole(serverId, m.user_id, e.target.value as 'admin' | 'member')}>
                      <option value="member">Membro</option><option value="admin">Administrador</option>
                    </select>
                  ) : <span className="role-tag">{m.role === 'admin' ? <><Shield size={13} /> Admin</> : 'Membro'}</span>}
                  {owner && m.user_id !== uid && <button className="icon-btn" data-tip="Tornar dono" aria-label={`Transferir servidor para ${p.display_name}`} onClick={() => openModal({ type: 'confirm', title: 'Transferir servidor', text: `${p.display_name} vira o dono e você passa a ser administrador.`, action: 'Transferir', danger: true, onConfirm: () => transferServer(serverId, m.user_id) })}><Crown size={16} /></button>}
                  {m.user_id !== uid && m.role !== 'owner' && (owner || m.role === 'member') && (
                    <button className="icon-btn danger" data-tip="Expulsar" aria-label={`Expulsar ${p.display_name}`} onClick={() => openModal({ type: 'confirm', title: `Expulsar ${p.display_name}`, text: 'A pessoa sai do servidor, mas pode voltar com um convite.', action: 'Expulsar', danger: true, onConfirm: () => kickMember(serverId, m.user_id) })}><UserMinus size={16} /></button>
                  )}
                </li>
              )
            })}
          </ul>
        ))}
        {tab === 'emojis' && (
          <>
            <p className="muted">Emojis do servidor podem ser usados por qualquer pessoa, em qualquer conversa. PNG, GIF animado ou WebP de até 10 MB.</p>
            <div className="copy-row">
              <div className="input with-prefix"><span>:</span><input value={emojiName} maxLength={24} placeholder="nome_do_emoji" aria-label="Nome do emoji" onChange={(e) => setEmojiName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} /></div>
              <button className="btn primary" disabled={emojiName.length < 2 || busy} onClick={() => emojiFile.current?.click()}><ImagePlus size={16} /> Escolher imagem</button>
              <input ref={emojiFile} type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = ''
                if (!f) return
                if (f.size > MAX_AVATAR_BYTES) return toast('A imagem pode ter até 10 MB.', 'error')
                setBusy(true); if (await addEmoji(serverId, emojiName, f)) setEmojiName(''); setBusy(false)
              }} />
            </div>
            {list.length === 0 ? <p className="muted pad">Nenhum emoji ainda. Dê um nome e escolha uma imagem.</p> : (
              <ul className="emoji-admin">
                {list.map((e) => (
                  <li key={e.id}>{safeMediaUrl(e.url) && <img src={safeMediaUrl(e.url)!} alt="" />}<code>:{e.name}:</code><button className="icon-btn danger" aria-label={`Apagar emoji ${e.name}`} onClick={() => void removeEmoji(e.id)}><Trash2 size={15} /></button></li>
                ))}
              </ul>
            )}
          </>
        )}
        {tab === 'convite' && (
          <>
            <p className="muted">Quem tiver este link entra no servidor. Gerar um novo cancela o anterior.</p>
            <div className="copy-row">
              <input className="input" readOnly value={inviteLink(server.invite_code)} aria-label="Link do convite" onFocus={(e) => e.target.select()} />
              <button className="btn primary" onClick={() => void copy(inviteLink(server.invite_code), 'Link copiado')}><Copy size={16} /> Copiar</button>
            </div>
            <button className="btn ghost" onClick={async () => { if (await regenerateInvite(serverId)) toast('Novo convite gerado', 'ok') }}><RefreshCw size={16} /> Gerar novo link</button>
          </>
        )}
      </div>
    </Modal>
  )
}

function ChannelModal({ serverId, channel, kind: initialKind, category: initialCategory }: Of<'channel'>) {
  const [kind, setKind] = useState<'text' | 'voice'>(channel ? (channel.kind as 'text' | 'voice') : initialKind || 'text')
  const [name, setName] = useState(channel?.name || '')
  const [topic, setTopic] = useState(channel?.topic || '')
  const [category, setCategory] = useState(channel?.category ?? initialCategory ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={channel ? 'Editar canal' : 'Criar canal'} onClose={closeModal}>
      <form onSubmit={async (e) => { e.preventDefault(); if (busy) return; setBusy(true); if (await saveChannel(serverId, channel, { name, topic, category, kind })) closeModal(); setBusy(false) }}>
        <div className="modal-body">
          {!channel && (
            <fieldset className="choice">
              <legend>Tipo</legend>
              <div className="seg two">
                <button type="button" aria-pressed={kind === 'text'} className={kind === 'text' ? 'on' : ''} onClick={() => setKind('text')}><strong><Hash size={15} /> Texto</strong><span>Mensagens, fotos e arquivos</span></button>
                <button type="button" aria-pressed={kind === 'voice'} className={kind === 'voice' ? 'on' : ''} onClick={() => setKind('voice')}><strong><Volume2 size={15} /> Voz</strong><span>Voz, câmera e tela em 4K</span></button>
              </div>
            </fieldset>
          )}
          <Field label="Nome do canal"><input className="input" value={name} maxLength={60} autoFocus placeholder={kind === 'text' ? 'novo-canal' : 'Nova sala'} onChange={(e) => setName(e.target.value)} /></Field>
          {kind === 'text' && <Field label="Assunto" hint="Aparece no topo do canal. Opcional."><input className="input" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} /></Field>}
          <Field label="Categoria" hint="Canais com a mesma categoria ficam agrupados."><input className="input" value={category} maxLength={40} placeholder={kind === 'text' ? 'Canais de texto' : 'Canais de voz'} onChange={(e) => setCategory(e.target.value)} /></Field>
        </div>
        <footer className="modal-foot">
          {channel && <button type="button" className="btn danger" onClick={() => openModal({ type: 'confirm', title: `Apagar ${channel.name}`, text: channel.kind === 'text' ? 'Todas as mensagens do canal são apagadas. Não dá para desfazer.' : 'A sala de voz é removida.', action: 'Apagar canal', danger: true, onConfirm: () => deleteChannel(channel) })}><Trash2 size={16} /> Apagar canal</button>}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={closeModal}>Cancelar</button>
          <button className="btn primary" disabled={busy || !name.trim()}>{channel ? 'Salvar' : 'Criar canal'}</button>
        </footer>
      </form>
    </Modal>
  )
}

// ============================================================ perfil
const COLORS = ['#00A86B', '#3DDBA4', '#2BB8C9', '#4C8DF6', '#9B7BFF', '#E35BC2', '#F0565B', '#F2A33B', '#F5F8F6']

function ProfileFace({ p, status }: { p: Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url' | 'banner_url' | 'accent_color' | 'bio' | 'custom_status'>; status?: ReturnType<typeof presenceOf> }) {
  return (
    <div className="profile-face" style={{ ['--accent' as string]: p.accent_color }}>
      <div className="profile-banner" style={safeMediaUrl(p.banner_url) ? { backgroundImage: `url("${safeMediaUrl(p.banner_url)}")` } : undefined} />
      <div className="profile-avatar"><Avatar profile={p} size={92} status={status} /></div>
      <div className="profile-info">
        <h3>{p.display_name || 'Seu nome'}</h3>
        <span className="muted">@{p.username}</span>
        {p.custom_status && <p className="profile-status">{p.custom_status}</p>}
        {p.bio && <div className="profile-bio"><span className="field-label">Sobre mim</span><Markdown text={p.bio} /></div>}
      </div>
    </div>
  )
}

function ProfileCard({ userId }: Of<'profile'>) {
  const state = useApp()
  const p = state.profiles[userId]
  if (!p) return null
  const me = userId === state.userId
  const friendship = state.friends.find((f) => f.requester_id === userId || f.addressee_id === userId)
  const status = presenceOf(state, userId)
  return (
    <Modal onClose={closeModal} bare label={`Perfil de ${p.display_name}`}>
      <Tilt className="profile-card" max={6}>
        <ProfileFace p={p} status={status} />
        <div className="profile-meta">
          <span>{STATUS_LABEL[status]}</span>
          <span>No Krata desde {new Date(p.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
        </div>
        <div className="profile-actions">
          {me ? <button className="btn primary block" onClick={() => openModal({ type: 'settings' })}>Editar perfil</button> : (
            <>
              <button className="btn primary" onClick={() => void openDm(userId)}><MessageCircle size={16} /> Mensagem</button>
              <button className="btn ghost" onClick={() => void openDm(userId).then(() => { const ch = useApp.getState().nav.channelId; if (ch && !useApp.getState().nav.serverId) void joinVoice(ch, { ring: true }) })}><Phone size={16} /> Ligar</button>
              {!friendship ? <button className="btn ghost" onClick={() => void sendFriendRequest(p.username)}><UserRoundPlus size={16} /> Adicionar</button>
                : friendship.status === 'pending' ? <button className="btn ghost" disabled>Pedido pendente</button>
                  : <button className="btn ghost" onClick={() => void removeFriend(friendship.id)}><UserMinus size={16} /> Desfazer amizade</button>}
            </>
          )}
        </div>
      </Tilt>
    </Modal>
  )
}

function Settings({ tab: initialTab }: Of<'settings'>) {
  const me = useApp((s) => s.me)!
  const [tab, setTab] = useState<'perfil' | 'voz' | 'avisos' | 'visual' | 'prisma' | 'app' | 'conta'>(
    (['perfil', 'voz', 'avisos', 'visual', 'prisma', 'app', 'conta'].includes(initialTab || '') ? initialTab : 'perfil') as 'perfil')
  const [motion, setMotionState] = useState(motionLevel())
  const [f, setF] = useState({ display_name: me.display_name, bio: me.bio, avatar_url: me.avatar_url, banner_url: me.banner_url, accent_color: me.accent_color, pronoun: me.pronoun ?? null })
  const [busy, setBusy] = useState(false)
  const [pass, setPass] = useState({ next: '', confirm: '', busy: false, touched: false })
  const [voice, setVoice] = useState(voiceSettings())
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [sound, setSound] = useState(localStorage.getItem('krata-sounds') !== 'off')
  const [notify, setNotify] = useState(localStorage.getItem('krata-notify') === 'on' && 'Notification' in window && Notification.permission === 'granted')
  const banner = useRef<HTMLInputElement>(null)
  const dirty = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== (me[k] ?? null))

  useEffect(() => {
    if (tab !== 'voz' || !navigator.mediaDevices?.enumerateDevices) return
    void navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === 'audioinput')))
  }, [tab])

  async function save() {
    if (!f.display_name.trim()) return toast('Escreva um nome de exibição.', 'error')
    setBusy(true)
    if (await updateProfile({ ...f, display_name: f.display_name.trim(), bio: f.bio.trim() })) toast('Perfil salvo', 'ok')
    setBusy(false)
  }
  const changeVoice = (patch: Partial<typeof voice>) => { const next = { ...voice, ...patch }; setVoice(next); saveVoiceSettings(next); void reloadMic() }
  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPass((p) => ({ ...p, touched: true }))
    if (passwordError(pass.next) || pass.next !== pass.confirm) return
    setPass((p) => ({ ...p, busy: true }))
    const { error } = await supabase.auth.updateUser({ password: pass.next })
    if (error) { toast(errorText(error), 'error'); setPass((p) => ({ ...p, busy: false })); return }
    toast('Senha alterada', 'ok')
    setPass({ next: '', confirm: '', busy: false, touched: false })
  }

  return (
    <Modal title="Configurações" onClose={closeModal} wide>
      <div className="tabs pad" role="tablist">
        {(['perfil', 'prisma', 'voz', 'avisos', 'visual', 'app', 'conta'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{{ perfil: 'Perfil', prisma: 'Prisma', voz: 'Voz e vídeo', avisos: 'Avisos', visual: 'Animações', app: 'App Android', conta: 'Conta' }[t]}</button>
        ))}
      </div>
      <div className="modal-body tall">
        {tab === 'perfil' && (
          <div className="settings-profile">
            <div className="settings-form">
              <ImagePick url={f.avatar_url} name={f.display_name} seed={me.id} onChange={(u) => setF({ ...f, avatar_url: u })} label="Trocar foto de perfil" />
              <p className="fine">Fotos animadas (GIF) funcionam para todo mundo.</p>
              <Field label="Nome de exibição"><input className="input" value={f.display_name} maxLength={32} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
              <Field label="Nome de usuário" hint="É o seu login, por isso não muda.">
                <div className="input with-prefix"><span>@</span><input value={me.username} readOnly aria-label="Nome de usuário" /></div>
              </Field>
              <div className="field">
                <span className="field-label">Como a Prisma te chama</span>
                <div className="seg two" role="radiogroup" aria-label="Pronome">
                  {(['ele', 'ela'] as const).map((p) => <button type="button" key={p} role="radio" aria-checked={f.pronoun === p} className={f.pronoun === p ? 'on' : ''} onClick={() => setF({ ...f, pronoun: p })}><strong>{p === 'ele' ? 'Ele' : 'Ela'}</strong><span>{p === 'ele' ? 'bem-vindo' : 'bem-vinda'}</span></button>)}
                </div>
              </div>
              <Field label="Sobre mim" hint={`${f.bio.length}/300`}><textarea className="input" rows={3} maxLength={300} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
              <div className="field">
                <span className="field-label">Cor do perfil</span>
                <div className="swatches" role="radiogroup" aria-label="Cor do perfil">
                  {COLORS.map((c) => <button type="button" key={c} role="radio" aria-checked={c.toLowerCase() === f.accent_color.toLowerCase()} aria-label={`Cor ${c}`} className={c.toLowerCase() === f.accent_color.toLowerCase() ? 'on' : ''} style={{ background: c }} onClick={() => setF({ ...f, accent_color: c })}>{c.toLowerCase() === f.accent_color.toLowerCase() && <Check size={13} />}</button>)}
                  <input type="color" value={f.accent_color} aria-label="Outra cor" onChange={(e) => setF({ ...f, accent_color: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <span className="field-label">Banner</span>
                <div className="row-gap">
                  <button className="btn ghost small" onClick={() => banner.current?.click()}><ImagePlus size={15} /> Escolher imagem</button>
                  {f.banner_url && <button className="link" onClick={() => setF({ ...f, banner_url: null })}>Remover</button>}
                  <input ref={banner} type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; const u = await pickImage(file, me.id); if (u) setF((x) => ({ ...x, banner_url: u })) }} />
                </div>
              </div>
            </div>
            <div className="settings-preview">
              <span className="field-label">Prévia</span>
              <Tilt className="profile-card" max={7}><ProfileFace p={{ ...me, ...f }} /></Tilt>
            </div>
          </div>
        )}
        {tab === 'prisma' && <PrismaSettings />}
        {tab === 'app' && <div className="app-tab"><AppDownload /><UpdateRow /><AppNotificationSettings /><AppInstallSteps /></div>}
        {tab === 'voz' && (
          <>
            <Field label="Microfone">
              <select className="input" value={voice.inputId} onChange={(e) => changeVoice({ inputId: e.target.value })}>
                <option value="">Padrão do sistema</option>
                {devices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfone ${i + 1}`}</option>)}
              </select>
            </Field>
            <label className="switch-row"><span><strong>Redução de ruído</strong><span className="muted">Tira ventilador, teclado e barulho de fundo.</span></span><input type="checkbox" className="switch" checked={voice.noise} onChange={(e) => changeVoice({ noise: e.target.checked })} /></label>
            <label className="switch-row"><span><strong>Cancelamento de eco</strong><span className="muted">Evita que os outros ouçam a própria voz quando você usa caixa de som.</span></span><input type="checkbox" className="switch" checked={voice.echo} onChange={(e) => changeVoice({ echo: e.target.checked })} /></label>
            <label className="switch-row"><span><strong>Ajuste automático de volume</strong><span className="muted">Mantém sua voz em um nível parecido o tempo todo.</span></span><input type="checkbox" className="switch" checked={voice.agc} onChange={(e) => changeVoice({ agc: e.target.checked })} /></label>
            <p className="notice">A qualidade da transmissão de tela (até 4K a 60 fps) é escolhida na hora de compartilhar e vale para qualquer conta.</p>
          </>
        )}
        {tab === 'avisos' && (
          <>
            <label className="switch-row"><span><strong>Sons</strong><span className="muted">Mensagem nova, alguém entrando na sala, chamada recebida.</span></span><input type="checkbox" className="switch" checked={sound} onChange={(e) => { setSound(e.target.checked); localStorage.setItem('krata-sounds', e.target.checked ? 'on' : 'off') }} /></label>
            <label className="switch-row"><span><strong>Notificações do navegador</strong><span className="muted">Avisa de mensagens diretas e menções quando o Krata está em segundo plano.</span></span>
              <input type="checkbox" className="switch" checked={notify} onChange={async (e) => {
                if (!e.target.checked) { setNotify(false); localStorage.setItem('krata-notify', 'off'); return }
                if (!('Notification' in window)) return toast('Este navegador não tem notificações.', 'error')
                const perm = await Notification.requestPermission()
                if (perm !== 'granted') return toast('As notificações estão bloqueadas neste navegador. Libere no cadeado da barra de endereço.', 'error')
                setNotify(true); localStorage.setItem('krata-notify', 'on')
              }} /></label>
          </>
        )}
        {tab === 'visual' && (
          <fieldset className="choice">
            <legend>Animações</legend>
            <div className="seg two">
              <button type="button" aria-pressed={motion === 'full'} className={motion === 'full' ? 'on' : ''} onClick={() => { setMotion('full'); setMotionState('full') }}><strong>Completas</strong><span>Transições e efeitos 3D em tudo</span></button>
              <button type="button" aria-pressed={motion === 'reduced'} className={motion === 'reduced' ? 'on' : ''} onClick={() => { setMotion('reduced'); setMotionState('reduced') }}><strong>Reduzidas</strong><span>Movimentos curtos e mais calmos</span></button>
            </div>
          </fieldset>
        )}
        {tab === 'conta' && (
          <>
            <form className="pass-form" onSubmit={changePassword}>
              <h3 className="sub-title">Trocar senha</h3>
              <Field label="Nova senha" error={pass.touched ? passwordError(pass.next) : null}>
                <PasswordInput value={pass.next} onChange={(v) => setPass((p) => ({ ...p, next: v }))} label="Nova senha" autoComplete="new-password" />
              </Field>
              <Strength password={pass.next} />
              <Field label="Confirmar nova senha" error={pass.touched && pass.confirm && pass.confirm !== pass.next ? 'As senhas não são iguais.' : null}>
                <PasswordInput value={pass.confirm} onChange={(v) => setPass((p) => ({ ...p, confirm: v }))} label="Confirmar nova senha" autoComplete="new-password" />
              </Field>
              <button className="btn primary" disabled={pass.busy || !pass.next}>{pass.busy ? 'Salvando…' : 'Trocar senha'}</button>
            </form>
            <p className="fine">Você entra como <strong>@{me.username}</strong>. Guarde sua senha: sem e-mail cadastrado, só o administrador do Krata consegue redefini-la.</p>
            <button className="btn danger" onClick={() => { closeModal(); void signOut() }}><LogOut size={16} /> Sair da conta</button>
          </>
        )}
      </div>
      {tab === 'perfil' && (
        <footer className="modal-foot">
          <span className="grow" />
          <button className="btn ghost" onClick={closeModal}>Fechar</button>
          <button className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar perfil'}</button>
        </footer>
      )}
    </Modal>
  )
}

// ============================================================ conversas
function NewDm() {
  const state = useApp()
  const friends = friendIds(state).map((id) => state.profiles[id]).filter(Boolean).sort((a, b) => a.display_name.localeCompare(b.display_name, 'pt-BR'))
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 9 ? p : [...p, id]))
  async function go() {
    setBusy(true)
    if (picked.length === 1) await openDm(picked[0])
    else if (await createGroup(picked, name)) closeModal()
    setBusy(false)
  }
  return (
    <Modal title="Nova conversa" onClose={closeModal}>
      <div className="modal-body">
        {friends.length === 0 ? <p className="muted">Você ainda não tem amigos adicionados. Adicione alguém pelo nome de usuário na aba Amigos.</p> : (
          <>
            <p className="muted">Escolha uma pessoa para conversar ou até 9 para criar um grupo.</p>
            <ul className="pick-list">
              {friends.map((p) => (
                <li key={p.id}>
                  <label className={picked.includes(p.id) ? 'on' : ''}>
                    <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                    <Avatar profile={p} size={32} status={presenceOf(state, p.id)} />
                    <span className="grow two-line"><strong>{p.display_name}</strong><span>@{p.username}</span></span>
                  </label>
                </li>
              ))}
            </ul>
            {picked.length > 1 && <Field label="Nome do grupo" hint="Opcional"><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>}
          </>
        )}
      </div>
      <footer className="modal-foot">
        <span className="grow" />
        <button className="btn ghost" onClick={closeModal}>Cancelar</button>
        <button className="btn primary" disabled={!picked.length || busy} onClick={() => void go()}>{picked.length > 1 ? <><Users size={16} /> Criar grupo</> : 'Abrir conversa'}</button>
      </footer>
    </Modal>
  )
}

function Switcher() {
  const state = useApp()
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const items = useMemo(() => {
    const query = q.trim().toLowerCase()
    const list = [
      ...state.channels.filter((c) => !c.server_id).map((c) => ({ key: c.id, label: channelTitle(state, c), sub: c.kind === 'group' ? 'Grupo' : 'Conversa', go: () => navigate({ serverId: null, channelId: c.id }) })),
      ...state.servers.map((s) => ({ key: s.id, label: s.name, sub: 'Servidor', go: () => navigate({ serverId: s.id, channelId: null }) })),
      ...state.channels.filter((c) => c.server_id && c.kind === 'text').map((c) => ({ key: c.id, label: `#${c.name}`, sub: state.servers.find((s) => s.id === c.server_id)?.name || '', go: () => navigate({ serverId: c.server_id, channelId: c.id }) })),
    ]
    return (query ? list.filter((i) => i.label.toLowerCase().includes(query)) : list).slice(0, 12)
  }, [q, state])
  const run = (i: number) => { const it = items[i]; if (it) { closeModal(); it.go() } }
  return (
    <Modal onClose={closeModal} bare label="Buscar ou ir para">
      <div className="switcher">
        <div className="input with-prefix big"><Search size={18} /><input value={q} autoFocus placeholder="Para onde você quer ir?" aria-label="Buscar conversas, servidores e canais"
          onChange={(e) => { setQ(e.target.value); setIndex(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
            if (e.key === 'Enter') { e.preventDefault(); run(index) }
          }} /></div>
        <ul role="listbox">
          {items.length === 0 && <li className="muted pad">Nada encontrado.</li>}
          {items.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onMouseEnter={() => setIndex(i)} onClick={() => run(i)}>
              <strong>{it.label}</strong><span className="muted">{it.sub}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}

function MessageResults({ list, empty }: { list: Message[] | null; empty: string }) {
  const profiles = useApp((s) => s.profiles)
  if (!list) return <Spinner />
  if (!list.length) return <p className="muted pad">{empty}</p>
  return (
    <ul className="result-list">
      {list.map((m) => (
        <li key={m.id}>
          <button onClick={() => { closeModal(); setTimeout(() => { const el = document.getElementById(`msg-${m.id}`); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600) } else toast('Essa mensagem é antiga. Role o canal para cima para encontrá-la.') }, 60) }}>
            <Avatar profile={profiles[m.author_id]} size={32} />
            <span className="grow two-line"><strong>{profiles[m.author_id]?.display_name || 'Usuário'} <small className="muted">{stamp(m.created_at)}</small></strong><span>{plain(m.content).slice(0, 160) || `${m.attachments.length} anexo(s)`}</span></span>
          </button>
        </li>
      ))}
    </ul>
  )
}
function Pins({ channelId }: Of<'pins'>) {
  const [list, setList] = useState<Message[] | null>(null)
  useEffect(() => { void fetchPins(channelId).then(setList) }, [channelId])
  return <Modal title="Mensagens fixadas" onClose={closeModal}><div className="modal-body tall"><MessageResults list={list} empty="Nada fixado aqui ainda. Passe o mouse sobre uma mensagem e clique no alfinete." /></div></Modal>
}
function SearchModal({ channelId, query }: Of<'search'>) {
  const [q, setQ] = useState(query || '')
  const [list, setList] = useState<Message[] | null>([])
  useEffect(() => {
    if (q.trim().length < 2) { setList([]); return }
    setList(null)
    let live = true
    const t = setTimeout(() => void searchMessages(channelId, q).then((r) => { if (live) setList(r) }), 300)
    return () => { live = false; clearTimeout(t) }
  }, [q, channelId])
  return (
    <Modal title="Buscar neste canal" onClose={closeModal}>
      <div className="modal-body tall">
        <div className="input with-prefix"><Search size={16} /><input value={q} autoFocus placeholder="Digite pelo menos 2 letras" aria-label="Texto para buscar" onChange={(e) => setQ(e.target.value)} /></div>
        <MessageResults list={list} empty={q.trim().length < 2 ? 'Busque por uma palavra que apareceu na conversa.' : 'Nenhuma mensagem com esse texto.'} />
      </div>
    </Modal>
  )
}

function ImageViewer({ url, name }: Of<'image'>) {
  return (
    <Modal onClose={closeModal} bare label={`Imagem ${name}`}>
      <div className="viewer">
        <img src={url} alt={name} />
        <a className="btn ghost small" href={url} target="_blank" rel="noopener noreferrer" download={name}><Download size={15} /> Abrir original</a>
      </div>
    </Modal>
  )
}

function Confirm({ title, text, action, danger, onConfirm }: Of<'confirm'>) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={title} onClose={closeModal}>
      <div className="modal-body"><p>{text}</p></div>
      <footer className="modal-foot">
        <span className="grow" />
        <button className="btn ghost" onClick={closeModal}>Cancelar</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} autoFocus disabled={busy} onClick={async () => { setBusy(true); closeModal(); await onConfirm() }}>{action}</button>
      </footer>
    </Modal>
  )
}

export function ModalRoot() {
  const modal = useApp((s) => s.modal)
  // mantém a janela na tela por um instante ao fechar, para a animação de saída
  const [shown, setShown] = useState<ModalState | null>(modal)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (modal) { setShown(modal); setClosing(false); return }
    setClosing(true)
    const t = setTimeout(() => { setShown(null); setClosing(false) }, 220)
    return () => clearTimeout(t)
  }, [modal])
  const loggedIn = useApp((s) => !!s.me)
  if (!shown || !loggedIn) return null
  return (
    <div className={`modal-layer${closing ? ' closing' : ''}`}>
      <ErrorBoundary label="Esta janela não carregou."><ModalView modal={shown} /></ErrorBoundary>
    </div>
  )
}

function ModalView({ modal }: { modal: ModalState }) {
  switch (modal.type) {
    case 'createServer': return <CreateServer />
    case 'joinServer': return <JoinServer {...modal} />
    case 'serverSettings': return <ServerSettings {...modal} />
    case 'channel': return <ChannelModal key={modal.channel?.id || 'new'} {...modal} />
    case 'settings': return <Settings {...modal} />
    case 'profile': return <ProfileCard {...modal} />
    case 'newDm': return <NewDm />
    case 'invite': return <Invite {...modal} />
    case 'switcher': return <Switcher />
    case 'screenShare': return <ScreenShareModal />
    case 'image': return <ImageViewer {...modal} />
    case 'pins': return <Pins {...modal} />
    case 'search': return <SearchModal {...modal} />
    case 'confirm': return <Confirm {...modal} />
  }
}
