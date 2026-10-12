// Aviso de versão nova dentro do app Android, com o botão que baixa e instala ali mesmo.
import { Download, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export interface UpdateInfo {
  state: 'idle' | 'available' | 'downloading' | 'permission' | 'installing' | 'error' | 'latest'
  progress: number
  error: string
  installed: string
  versionName?: string
  notes?: string
  size?: number
}

export function readUpdate(): UpdateInfo | null {
  try { const raw = window.KrataNative?.updateInfo?.(); return raw ? JSON.parse(raw) as UpdateInfo : null } catch { return null }
}

/** Acompanha o estado da atualização (o app responde na hora; aqui só consulta). */
export function useUpdate(active = true): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(readUpdate)
  useEffect(() => {
    if (!active || !window.KrataNative?.updateInfo) return
    const tick = () => setInfo(readUpdate())
    const busy = () => { const s = readUpdate()?.state; return s === 'downloading' || s === 'installing' || s === 'permission' }
    let t = setTimeout(function loop() { tick(); t = setTimeout(loop, busy() ? 300 : 1000) }, 300)
    window.addEventListener('krata-update', tick)
    return () => { clearTimeout(t); window.removeEventListener('krata-update', tick) }
  }, [active])
  return info
}

const SNOOZE = 'krata-update-snooze'
const mb = (n?: number) => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : '')

/** Cartão que aparece no topo quando sai versão nova do app. */
export function UpdateBanner() {
  const info = useUpdate()
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(SNOOZE) || '' } catch { return '' } })
  const [forced, setForced] = useState(false)
  useEffect(() => {
    const show = () => setForced(true)
    window.addEventListener('krata-update', show)
    return () => window.removeEventListener('krata-update', show)
  }, [])
  if (!info || !info.versionName) return null
  const working = info.state === 'downloading' || info.state === 'installing' || info.state === 'permission'
  if (!['available', 'downloading', 'permission', 'installing', 'error'].includes(info.state)) return null
  if (!working && !forced && hidden === info.versionName) return null
  return (
    <div className="app-update" role="status">
      <span className="app-update-icon">{working ? <RefreshCw size={18} className="spin" /> : <Download size={18} />}</span>
      <span className="app-update-text">
        <strong>{info.state === 'downloading' ? `Baixando a versão ${info.versionName}… ${info.progress}%` : info.state === 'installing' ? 'Abrindo a instalação…' : info.state === 'permission' ? 'Libere “Permitir desta fonte” e volte aqui' : info.state === 'error' ? 'A atualização não deu certo' : `Krata ${info.versionName} disponível`}</strong>
        <span>{info.state === 'error' ? info.error : info.state === 'permission' ? 'É só uma vez: o Android pede para o Krata poder instalar as próprias atualizações.' : info.notes || `Você está na ${info.installed}.`}</span>
        {info.state === 'downloading' && <span className="app-update-bar"><i style={{ width: `${info.progress}%` }} /></span>}
      </span>
      {!working && (
        <>
          <button className="btn primary small" onClick={() => { window.KrataNative?.installUpdate?.(); setForced(true); window.dispatchEvent(new Event('krata-update')) }}>{info.state === 'error' ? 'Tentar de novo' : `Atualizar${info.size ? ` · ${mb(info.size)}` : ''}`}</button>
          <button className="icon-btn" aria-label="Depois" onClick={() => { setHidden(info.versionName!); setForced(false); try { localStorage.setItem(SNOOZE, info.versionName!) } catch { /* sem armazenamento */ } }}><X size={16} /></button>
        </>
      )}
    </div>
  )
}

/** Linha nas configurações: versão instalada e botão de procurar/atualizar. */
export function UpdateRow() {
  const info = useUpdate()
  const [checking, setChecking] = useState(false)
  if (!info) return null
  const has = info.versionName && ['available', 'error', 'permission'].includes(info.state)
  return (
    <div className="switch-row">
      <span><strong>Versão do app: {info.installed}</strong><span className="muted">{has ? `A versão ${info.versionName} está disponível.` : info.state === 'downloading' ? `Baixando… ${info.progress}%` : checking ? 'Procurando…' : info.state === 'latest' ? 'Você está na versão mais nova.' : 'O app confere sozinho quando abre.'}</span></span>
      {has ? <button className="btn primary small" onClick={() => window.KrataNative?.installUpdate?.()}>Atualizar</button>
        : <button className="btn ghost small" disabled={checking || info.state === 'downloading'} onClick={() => { setChecking(true); window.KrataNative?.checkUpdate?.(); setTimeout(() => setChecking(false), 2500) }}>Procurar atualização</button>}
    </div>
  )
}
