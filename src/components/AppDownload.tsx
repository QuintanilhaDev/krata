import { Bell, BatteryCharging, Download, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { APK_URL, APP_VERSION, isApp, isIOSDevice } from '../lib/native'

/** Botão para baixar o app Android (some quando já estamos dentro do app). */
export function AppDownload({ variant = 'card' }: { variant?: 'card' | 'login' }) {
  if (isApp()) {
    if (variant !== 'card') return null
    let installed = ''
    try { installed = window.KrataNative?.version() || '' } catch { /* ponte antiga */ }
    return (
      <div className="app-download">
        <span className="app-download-icon"><Smartphone size={22} /></span>
        <span className="app-download-text">
          <strong>Você já está no app (versão {installed || '?'})</strong>
          <span>{window.KrataNative?.updateInfo ? 'As novidades do site chegam sozinhas, e as do app aparecem aqui com um botão de atualizar.' : `As novidades do site chegam sozinhas. ${installed && installed !== APP_VERSION ? `Tem a versão ${APP_VERSION} do app para baixar.` : 'Seu app está em dia.'}`}</span>
        </span>
        {installed && installed !== APP_VERSION && !window.KrataNative?.updateInfo && <a className="btn primary small" href={APK_URL} download="Krata.apk"><Download size={16} /> Atualizar</a>}
      </div>
    )
  }
  const ios = isIOSDevice()
  return (
    <div className={`app-download ${variant}`}>
      <span className="app-download-icon"><Smartphone size={22} /></span>
      <span className="app-download-text">
        <strong>App do Krata para Android</strong>
        <span>{ios ? 'Por enquanto só para Android. No iPhone, use pelo navegador.' : 'Compartilhe a tela pelo celular, com a Prisma ouvindo e tudo do site.'}</span>
      </span>
      {!ios && (
        <a className="btn primary small" href={APK_URL} download="Krata.apk" rel="noopener">
          <Download size={16} /> Baixar .apk
        </a>
      )}
    </div>
  )
}

/** Dentro do app: notificações, segundo plano e conexão em tempo real. */
export function AppNotificationSettings() {
  const n = window.KrataNative
  const read = () => ({
    allowed: (() => { try { return n?.notificationsAllowed?.() ?? true } catch { return true } })(),
    background: (() => { try { return n?.backgroundAllowed?.() ?? true } catch { return true } })(),
  })
  const [st, setSt] = useState(read)
  const [live, setLive] = useState(() => { try { return localStorage.getItem('krata-live-sync') !== 'off' } catch { return true } })
  useEffect(() => {
    const t = setInterval(() => setSt(read()), 1500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!n?.setInbox) return null
  return (
    <div className="app-notify">
      <div className="switch-row">
        <span><strong><Bell size={15} /> Notificações de mensagens</strong><span className="muted">{st.allowed ? 'Ligadas: conversas privadas, grupos e quando te marcam com @ num servidor.' : 'Bloqueadas no Android. Toque para liberar.'}</span></span>
        {!st.allowed && <button className="btn primary small" onClick={() => n.requestNotifications?.()}>Liberar</button>}
      </div>
      <label className="switch-row">
        <span><strong>Receber na hora, mesmo com o app fechado</strong><span className="muted">Mantém uma conexão leve em segundo plano (aparece um ícone discreto na barra). Desligado, as mensagens chegam a cada 15 minutos.</span></span>
        <input type="checkbox" className="switch" checked={live} onChange={(e) => { setLive(e.target.checked); try { localStorage.setItem('krata-live-sync', e.target.checked ? 'on' : 'off') } catch { /* sem armazenamento */ } n.setLiveSync?.(e.target.checked) }} />
      </label>
      {!st.background && (
        <div className="switch-row">
          <span><strong><BatteryCharging size={15} /> Economia de bateria está segurando o Krata</strong><span className="muted">Sem liberar, o Android pode atrasar as notificações quando a tela está apagada.</span></span>
          <button className="btn ghost small" onClick={() => n.openBackgroundSettings?.()}>Liberar</button>
        </div>
      )}
    </div>
  )
}

/** Passo a passo de instalação (aparece nas configurações). */
export function AppInstallSteps() {
  if (isApp()) return null
  return (
    <ol className="app-steps">
      <li>Toque em <strong>Baixar .apk</strong> no celular Android.</li>
      <li>Abra o arquivo baixado. Se o Android avisar, toque em <strong>Configurações → Permitir desta fonte</strong> e volte.</li>
      <li>Toque em <strong>Instalar</strong>. Pronto: o Krata aparece na tela inicial.</li>
    </ol>
  )
}
