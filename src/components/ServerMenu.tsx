// Menu do servidor: no cabeçalho da lista de canais e com o botão direito (ou segurando) no ícone do servidor.
import { Bell, BellOff, BellRing, Check, CheckCheck, Copy, LogOut, Plus, Settings, UserPlus, AtSign } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NotifyLevel } from '../lib/types'
import { leaveServer, markServerRead, setNotifyPref } from '../store/actions'
import { openModal, toast, useApp } from '../store/app'

const LEVELS: { v: NotifyLevel; label: string; hint: string; icon: typeof Bell }[] = [
  { v: 'all', label: 'Todas as mensagens', hint: 'Avisa de tudo que chegar', icon: BellRing },
  { v: 'mentions', label: 'Só menções', hint: '@você, respostas e @everyone', icon: Bell },
  { v: 'none', label: 'Nada', hint: 'Silencia este servidor', icon: BellOff },
]

export function ServerMenuItems({ serverId, onDone }: { serverId: string; onDone: () => void }) {
  const server = useApp((s) => s.servers.find((x) => x.id === serverId))
  const role = useApp((s) => s.roles[serverId])
  const pref = useApp((s) => s.notifyPrefs[serverId])
  const hasUnread = useApp((s) => s.channels.some((c) => c.server_id === serverId && s.unread[c.id] > 0))
  if (!server) return null
  const admin = role === 'owner' || role === 'admin'
  const level = pref?.level || server.default_notify || 'mentions'
  const run = (fn: () => void) => () => { onDone(); fn() }
  return (
    <>
      <button className="menu-item accent" role="menuitem" onClick={run(() => openModal({ type: 'invite', serverId }))}><UserPlus size={16} /> Convidar pessoas</button>
      {hasUnread && <button className="menu-item" role="menuitem" onClick={run(() => void markServerRead(serverId))}><CheckCheck size={16} /> Marcar como lido</button>}
      <div className="menu-sep" />
      <div className="menu-label">Notificações</div>
      {LEVELS.map((l) => (
        <button key={l.v} className="menu-item two" role="menuitemradio" aria-checked={level === l.v} onClick={() => void setNotifyPref(serverId, { level: l.v })}>
          <l.icon size={16} /><span className="grow"><span>{l.label}</span><small>{l.hint}</small></span>{level === l.v && <Check size={15} className="end" />}
        </button>
      ))}
      <button className="menu-item" role="menuitemcheckbox" aria-checked={!!pref?.suppress_everyone} onClick={() => void setNotifyPref(serverId, { suppress_everyone: !pref?.suppress_everyone })}>
        <AtSign size={16} /><span className="grow">Ignorar @everyone e @here</span>{pref?.suppress_everyone && <Check size={15} className="end" />}
      </button>
      <div className="menu-sep" />
      {admin && <button className="menu-item" role="menuitem" onClick={run(() => openModal({ type: 'serverSettings', serverId }))}><Settings size={16} /> Configurações do servidor</button>}
      {admin && <button className="menu-item" role="menuitem" onClick={run(() => openModal({ type: 'channel', serverId, kind: 'text' }))}><Plus size={16} /> Criar canal</button>}
      <button className="menu-item" role="menuitem" onClick={run(() => void navigator.clipboard?.writeText(serverId).then(() => toast('ID do servidor copiado', 'ok')))}><Copy size={16} /> Copiar ID do servidor</button>
      {role !== 'owner' && (
        <button className="menu-item danger" role="menuitem" onClick={run(() => openModal({ type: 'confirm', title: `Sair de ${server.name}`, text: 'Você só volta com um novo convite.', action: 'Sair do servidor', danger: true, onConfirm: () => leaveServer(serverId) }))}><LogOut size={16} /> Sair do servidor</button>
      )}
    </>
  )
}

/** Menu flutuante no ponto do clique. */
export function ServerContextMenu({ serverId, x, y, onClose }: { serverId: string; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const name = useApp((s) => s.servers.find((v) => v.id === serverId)?.name)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) })
  }, [x, y])
  useEffect(() => {
    const out = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => document.addEventListener('pointerdown', out), 0)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', onClose)
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', key); window.removeEventListener('resize', onClose) }
  }, [onClose])
  return createPortal(
    <div ref={ref} className="pop context-menu" role="menu" aria-label={`Menu de ${name}`} style={pos} onContextMenu={(e) => e.preventDefault()}>
      <div className="menu-title">{name}</div>
      <ServerMenuItems serverId={serverId} onDone={onClose} />
    </div>,
    document.body,
  )
}
