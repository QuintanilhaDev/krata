import { AlertTriangle, Bell, BatteryCharging, CheckCircle2, Download, Smartphone } from 'lucide-react'
import { inboxProblem } from '../lib/appNotify'
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

interface Delivery { notifications?: boolean; background?: boolean; configured?: boolean; service?: boolean; live?: boolean; lastOk?: number; lastTry?: number; lastError?: string }
const ago = (t?: number) => { if (!t) return 'nunca'; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `há ${s} s` : s < 3600 ? `há ${Math.round(s / 60)} min` : `há ${Math.round(s / 3600)} h` }

/** Dentro do app: notificações, segundo plano, diagnóstico e teste. */
export function AppNotificationSettings() {
  const n = window.KrataNative
  const read = (): Delivery => {
    let d: Delivery = {}
    try { d = JSON.parse(n?.deliveryStatus?.() || '{}') as Delivery } catch { /* app antigo */ }
    try { d.notifications ??= n?.notificationsAllowed?.() ?? true } catch { d.notifications = true }
    try { d.background ??= n?.backgroundAllowed?.() ?? true } catch { d.background = true }
    return d
  }
  const [st, setSt] = useState(read)
  const [live, setLive] = useState(() => { try { return localStorage.getItem('krata-live-sync') !== 'off' } catch { return true } })
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    const t = setInterval(() => setSt(read()), 1500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!n?.setInbox) return null
  const problem = inboxProblem === 'sql' ? 'O servidor do Krata ainda não tem as notificações do app: rode o arquivo supabase/notificacoes.sql no Supabase.' : st.lastError || ''
  const healthy = st.notifications && st.configured !== false && !problem && (!st.lastOk || Date.now() - st.lastOk < 5 * 60_000)
  const rows: [boolean | undefined, string, string][] = [
    [st.notifications, 'Permissão de notificação', st.notifications ? 'Liberada' : 'Bloqueada no Android'],
    [st.background, 'Economia de bateria', st.background ? 'Liberada: chega com a tela apagada' : 'Segurando o Krata: as mensagens atrasam'],
    [st.configured !== false && inboxProblem !== 'sql', 'Conta ligada a este celular', st.configured === false ? 'Ainda não (abra uma conversa para ligar)' : inboxProblem === 'sql' ? 'Falta configurar o servidor' : 'Sim'],
    [!!st.lastOk && !st.lastError, 'Última conferência de mensagens', st.lastError ? 'Com erro' : ago(st.lastOk)],
  ]
  return (
    <div className="app-notify">
      <div className={`notify-health${healthy ? ' ok' : ' bad'}`}>
        <strong>{healthy ? <><CheckCircle2 size={16} /> Notificações funcionando</> : <><AlertTriangle size={16} /> As notificações podem não chegar</>}</strong>
        <ul>{rows.map(([ok, k, v]) => <li key={k} className={ok === false ? 'bad' : ok ? 'ok' : ''}><span>{k}</span><b>{v}</b></li>)}</ul>
        {problem && <p className="notify-health-err">{problem}</p>}
        <div className="notify-health-actions">
          {!st.notifications && <button className="btn primary small" onClick={() => n.requestNotifications?.()}>Liberar notificações</button>}
          {!st.background && <button className="btn primary small" onClick={() => n.openBackgroundSettings?.()}><BatteryCharging size={15} /> Liberar bateria</button>}
          {n.syncNow && <button className="btn ghost small" disabled={checking} onClick={() => {
            setChecking(true)
            setTimeout(() => {
              try { const r = JSON.parse(n.syncNow!() || '{}') as { ok?: boolean; error?: string }; setResult(r.ok ? 'Tudo certo: conferi agora e a conexão com o servidor está funcionando.' : `Deu erro: ${r.error || 'sem resposta do servidor'}`) } catch { setResult('Não consegui conferir agora.') }
              setSt(read()); setChecking(false)
            }, 30)
          }}>{checking ? 'Conferindo…' : 'Conferir agora'}</button>}
          {n.testNotification && <button className="btn ghost small" onClick={() => n.testNotification?.()}><Bell size={15} /> Testar</button>}
        </div>
        {result && <p className="notify-health-result">{result}</p>}
      </div>
      <label className="switch-row">
        <span><strong>Receber na hora, mesmo com o app fechado</strong><span className="muted">Confere as mensagens a cada poucos segundos em segundo plano, sem aviso fixo na barra. Desligado, elas chegam com alguns minutos de atraso (gasta menos bateria).</span></span>
        <input type="checkbox" className="switch" checked={live} onChange={(e) => { setLive(e.target.checked); try { localStorage.setItem('krata-live-sync', e.target.checked ? 'on' : 'off') } catch { /* sem armazenamento */ } n.setLiveSync?.(e.target.checked) }} />
      </label>
      <p className="fine">Celular Xiaomi, Samsung ou Motorola? Além da bateria, procure o Krata em Configurações → Apps e ligue "Inicialização automática" (ou desligue "Colocar app em suspensão").</p>
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
