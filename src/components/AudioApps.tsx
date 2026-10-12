// Escolher de quais apps o som entra na transmissão (app Android, como no GoLive) e,
// no computador, se o som da própria chamada vai junto.
import { Check, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

interface AppItem { pkg: string; label: string; icon?: string }
let cache: AppItem[] | null = null
const load = (): AppItem[] => {
  if (cache) return cache
  try { cache = (JSON.parse(window.KrataNative?.listAudioApps?.() || '[]') as AppItem[]).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')) } catch { cache = [] }
  return cache
}
export const canPickAudioApps = () => { try { return !!window.KrataNative?.listAudioApps && window.KrataNative.canChooseAudioApps?.() !== false } catch { return false } }

/** Lista com busca. `value` vazio = todos os apps. */
export function AudioAppsPicker({ value, onChange }: { value: string[]; onChange: (apps: string[]) => void }) {
  const [mode, setMode] = useState<'all' | 'some'>(value.length ? 'some' : 'all')
  const [q, setQ] = useState('')
  const apps = useMemo(load, [])
  const shown = apps.filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase()))
  const toggle = (pkg: string) => onChange(value.includes(pkg) ? value.filter((p) => p !== pkg) : [...value, pkg])
  return (
    <fieldset className="choice audio-apps">
      <legend>Som de quais apps</legend>
      <div className="seg two">
        <button type="button" aria-pressed={mode === 'all'} className={mode === 'all' ? 'on' : ''} onClick={() => { setMode('all'); onChange([]) }}><strong>Todos</strong><span>Tudo que tocar no celular</span></button>
        <button type="button" aria-pressed={mode === 'some'} className={mode === 'some' ? 'on' : ''} onClick={() => setMode('some')}><strong>Escolher apps</strong><span>{value.length ? `${value.length} selecionado${value.length > 1 ? 's' : ''}` : 'Só o jogo, só a música…'}</span></button>
      </div>
      {mode === 'some' && (
        <>
          <div className="input with-prefix"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar app" aria-label="Procurar app" /></div>
          <ul className="audio-app-list">
            {shown.map((a) => (
              <li key={a.pkg}>
                <button type="button" className={value.includes(a.pkg) ? 'on' : ''} onClick={() => toggle(a.pkg)} aria-pressed={value.includes(a.pkg)}>
                  {a.icon ? <img src={a.icon} alt="" /> : <span className="audio-app-ph" />}
                  <span className="grow">{a.label}</span>
                  {value.includes(a.pkg) && <Check size={16} />}
                </button>
              </li>
            ))}
            {!shown.length && <li className="muted">Nenhum app encontrado.</li>}
          </ul>
          <p className="fine">Alguns apps (como os de vídeo com proteção) não deixam o som ser transmitido. O som da chamada nunca vai junto.</p>
        </>
      )}
    </fieldset>
  )
}

export const savedAudioApps = (): string[] => { try { return JSON.parse(localStorage.getItem('krata-audio-apps') || '[]') } catch { return [] } }
export const saveAudioApps = (apps: string[]) => { try { localStorage.setItem('krata-audio-apps', JSON.stringify(apps)) } catch { /* sem armazenamento */ } }
