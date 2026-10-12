import { Download, Smartphone } from 'lucide-react'
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
          <span>As novidades do site chegam sozinhas. {installed && installed !== APP_VERSION ? `Tem a versão ${APP_VERSION} do app para baixar.` : 'Seu app está em dia.'}</span>
        </span>
        {installed && installed !== APP_VERSION && <a className="btn primary small" href={APK_URL} download="Krata.apk"><Download size={16} /> Atualizar</a>}
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
