// Convite caprichado para ligar as notificações (computador e app Android), na hora certa:
// alguns segundos depois de abrir o Krata, só se ainda faltar algo, e sem insistir.
import { BatteryCharging, Bell, BellRing, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { desktopOn, desktopSupported, enableDesktop } from '../lib/push'
import { toast, useApp } from '../store/app'
import { Gem } from './ui'

type Need = 'web' | 'app-perm' | 'app-battery' | null
const KEY = 'krata-coach'
const snoozed = (need: string) => { try { return Date.now() < Number(localStorage.getItem(`${KEY}:${need}`) || 0) } catch { return false } }
const snooze = (need: string, days: number) => { try { localStorage.setItem(`${KEY}:${need}`, String(Date.now() + days * 86400_000)) } catch { /* sem armazenamento */ } }

function currentNeed(): Need {
  const n = window.KrataNative
  if (n?.setInbox) {
    try { if (n.notificationsAllowed && !n.notificationsAllowed()) return 'app-perm' } catch { /* app antigo */ }
    try { if (n.backgroundAllowed && !n.backgroundAllowed()) return 'app-battery' } catch { /* app antigo */ }
    return null
  }
  if (desktopSupported() && Notification.permission !== 'denied' && !desktopOn()) return 'web'
  return null
}

export function NotifyCoach() {
  const me = useApp((s) => s.me)
  const [need, setNeed] = useState<Need>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => { const n = currentNeed(); if (n && !snoozed(n)) setNeed(n) }, 6000)
    // voltou das configurações do Android: confere de novo
    const again = () => { if (document.visibilityState === 'visible') setNeed((cur) => (cur ? currentNeed() : cur)) }
    document.addEventListener('visibilitychange', again)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', again) }
  }, [])
  if (!need || !me) return null
  const close = (days = 3) => { snooze(need, days); setNeed(null) }
  const copy = {
    web: { icon: <BellRing size={18} />, title: 'Receba as mensagens no computador', text: 'Ative as notificações para saber na hora quando alguém te chamar no privado, num grupo ou te marcar com @ — mesmo com o Krata minimizado ou a aba fechada.', cta: 'Ativar notificações' },
    'app-perm': { icon: <Bell size={18} />, title: 'Libere as notificações do Krata', text: 'O Android está bloqueando os avisos. Sem isso, você não fica sabendo das mensagens privadas e menções.', cta: 'Liberar' },
    'app-battery': { icon: <BatteryCharging size={18} />, title: 'Não perca nenhuma mensagem', text: 'A economia de bateria do Android segura o Krata com a tela apagada, e as notificações chegam só às vezes. Toque em Liberar e escolha "Permitir" (ou "Sem restrições").', cta: 'Liberar' },
  }[need]
  async function go() {
    const n = window.KrataNative
    if (need === 'web') {
      setBusy(true)
      const r = await enableDesktop(me!)
      setBusy(false)
      if (r === 'on') { toast('Notificações ligadas. Você vai receber cada mensagem privada e menção.', 'ok'); setNeed(null) }
      else if (r === 'blocked') { toast('O navegador bloqueou. Libere as notificações no cadeado ao lado do endereço do site.', 'error'); close(7) }
      return
    }
    if (need === 'app-perm') n?.requestNotifications?.()
    if (need === 'app-battery') n?.openBackgroundSettings?.()
  }
  return (
    <aside className={`notify-coach ${need}`} role="dialog" aria-labelledby="notify-coach-title">
      <button className="icon-btn tiny notify-coach-x" onClick={() => close()} aria-label="Fechar"><X size={15} /></button>
      <div className="notify-coach-art" aria-hidden="true">
        <Gem size={46} speed={1.2} />
        <span className="notify-coach-ping">{copy.icon}</span>
      </div>
      <div className="notify-coach-body">
        <strong id="notify-coach-title">{copy.title}</strong>
        <p>{copy.text}</p>
        <div className="notify-coach-sample" aria-hidden="true">
          <span className="notify-coach-avatar">A</span>
          <span><b>Ana</b><i>bora jogar hoje? 🎮</i></span>
        </div>
        <div className="notify-coach-actions">
          <button className="btn primary small" disabled={busy} onClick={() => void go()}>{busy ? 'Ativando…' : copy.cta}</button>
          <button className="btn ghost small" onClick={() => close()}>Agora não</button>
        </div>
      </div>
    </aside>
  )
}
