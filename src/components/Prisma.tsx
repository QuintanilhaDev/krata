// Tudo o que aparece da Prisma na tela: a fadinha que voa, o balão de fala, o botão
// flutuante (celular), o chat com ela, as telinhas próprias (foto nova, tela, convite…)
// e a aba de configurações.
import { Check, Copy, ImagePlus, Keyboard, Mic, MicOff, MonitorUp, Send, Share2, Sparkles, Trash2, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { safeMediaUrl } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { MAX_AVATAR_BYTES, uploadFile } from '../lib/upload'
import { addEmoji, updateProfile, updateServer } from '../store/actions'
import { get as app, toast, useApp } from '../store/app'
import { RES, canShareScreen, startScreen, useVoice, type Resolution } from '../voice/engine'
import { EXAMPLES, cancelPending, forgetLearning, handle, initPrisma, panelDone, stopPrisma } from '../prisma/agent'
import { celebrate, registerSprite } from '../prisma/fairy'
import { say } from '../prisma/persona'
import { pget, pset, usePrisma, type PanelState } from '../prisma/store'
import { canContinuous, chosenVoice, femaleVoices, isIOS, pushToTalk, setListening, speak, speechSupport, volume } from '../prisma/voice'
import { savedAudioApps } from './AudioApps'
import { cropImage } from './Cropper'
import { Gem } from './ui'

/** Perfil "de mentira" para a Prisma aparecer na lista de menções. */
export const PRISMA_PROFILE = {
  id: 'prisma', username: 'prisma', display_name: 'Prisma', avatar_url: null, banner_url: null, bio: '', accent_color: '#00d68f',
  status: 'online', custom_status: '', created_at: '', pronoun: 'ela',
} as unknown as Profile

/** Marca leve (sem animação contínua) para avatares e listas. */
export function PrismaMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="prisma-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="pm-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b8ffe4" /><stop offset="0.5" stopColor="#00d68f" /><stop offset="1" stopColor="#00744a" /></linearGradient>
      </defs>
      <path d="M12 1.5 20 8.5 12 22.5 4 8.5Z" fill="url(#pm-a)" />
      <path d="M4 8.5h16M12 1.5 9 8.5l3 14 3-14Z" fill="none" stroke="#eafff6" strokeOpacity=".55" strokeWidth=".8" />
    </svg>
  )
}

// ============================================================ raiz
export function PrismaRoot() {
  useEffect(() => {
    void initPrisma()
    return () => stopPrisma()
  }, [])
  // humor e "fora de casa" viram atributos no <html> para o CSS brilhar o botão certo
  useEffect(() => usePrisma.subscribe((s) => {
    const root = document.documentElement
    root.dataset.prismaMood = s.mood
    if (s.out) root.dataset.prismaOut = '1'
    else delete root.dataset.prismaOut
    root.dataset.prismaListen = s.listening ? '1' : '0'
  }), [])
  return (
    <>
      <Sprite />
      <Bubble />
      <Fab />
      <ChatPanel />
      <Panel />
    </>
  )
}

function Sprite() {
  const sprite = useRef<HTMLDivElement>(null)
  const trail = useRef<HTMLDivElement>(null)
  useEffect(() => {
    registerSprite(sprite.current, trail.current)
    return () => registerSprite(null, null)
  }, [])
  return (
    <div className="prisma-layer" aria-hidden="true">
      <div ref={trail} className="prisma-trail" />
      <div ref={sprite} className="prisma-sprite">
        <span className="prisma-body">
          <span className="wing l" /><span className="wing r" />
          <span className="wing l low" /><span className="wing r low" />
          <span className="prisma-core"><Gem size={26} speed={1.6} /></span>
        </span>
      </div>
    </div>
  )
}

function Bubble() {
  const bubble = usePrisma((s) => s.bubble)
  if (!bubble) return null
  return (
    <div className="prisma-bubble" key={bubble} role="status" aria-live="polite">
      <span className="prisma-bubble-head"><PrismaMark size={14} /> Prisma</span>
      <p>{bubble}</p>
      <button className="icon-btn tiny" onClick={() => pset({ bubble: null })} aria-label="Fechar"><X size={14} /></button>
    </div>
  )
}

// ============================================================ botão flutuante (celular)
function Fab() {
  const { mood, recording, out, listening } = usePrisma(useShallow((s) => ({ mood: s.mood, recording: s.recording, out: s.out, listening: s.listening })))
  const hold = useRef<number | null>(null)
  const longPressed = useRef(false)
  const start = () => {
    longPressed.current = false
    hold.current = window.setTimeout(() => { longPressed.current = true; pset((s) => ({ chatOpen: !s.chatOpen })); navigator.vibrate?.(12) }, 480)
  }
  const end = () => { if (hold.current) clearTimeout(hold.current); hold.current = null }
  return (
    <div className={`prisma-fab-wrap mood-${mood}${recording ? ' recording' : ''}${out ? ' away' : ''}`}>
      <button className="prisma-fab-chat" onClick={() => pset((s) => ({ chatOpen: !s.chatOpen }))} aria-label="Escrever para a Prisma"><Keyboard size={15} /></button>
      <button
        data-prisma="fab" className="prisma-fab"
        aria-label={recording ? 'Parar e enviar para a Prisma' : 'Falar com a Prisma'}
        aria-pressed={recording}
        onPointerDown={start} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => { if (longPressed.current) return; void pushToTalk() }}
      >
        <span className="prisma-fab-ring" />
        <span className="prisma-fab-gem"><Gem size={30} speed={recording ? 2.4 : 0.9} /></span>
        {listening && !recording && <span className="prisma-fab-ear" title="Ouvindo “Prisma”" />}
      </button>
    </div>
  )
}

/** No celular, dentro de uma conversa: a Prisma fica no topo (não cobre o campo de texto). Toque fala; segurar abre o chat. */
export function PrismaHeadButton() {
  const { mood, recording } = usePrisma(useShallow((s) => ({ mood: s.mood, recording: s.recording })))
  const hold = useRef<number | null>(null)
  const longPressed = useRef(false)
  const start = () => { longPressed.current = false; hold.current = window.setTimeout(() => { longPressed.current = true; pset((s) => ({ chatOpen: !s.chatOpen })); navigator.vibrate?.(12) }, 480) }
  const end = () => { if (hold.current) clearTimeout(hold.current); hold.current = null }
  return (
    <button data-prisma="fab-head" className={`icon-btn prisma-head only-mobile mood-${mood}${recording ? ' recording' : ''}`} aria-label={recording ? 'Parar e enviar para a Prisma' : 'Falar com a Prisma (segure para escrever)'} aria-pressed={recording}
      onPointerDown={start} onPointerUp={end} onPointerLeave={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()}
      onClick={() => { if (longPressed.current) return; void pushToTalk() }}>
      <Gem size={22} speed={recording ? 2.4 : 0.9} />
    </button>
  )
}

/** Botão da Prisma no painel do usuário (computador e celular). */
export function PrismaButton() {
  const open = usePrisma((s) => s.chatOpen)
  return (
    <button className={`icon-btn prisma-btn${open ? ' on' : ''}`} onClick={() => pset((s) => ({ chatOpen: !s.chatOpen }))} aria-label="Conversar com a Prisma" aria-expanded={open} data-tip="Prisma">
      <Sparkles size={18} />
    </button>
  )
}

/** Entrada da Prisma na lista de conversas. */
export function PrismaEntry() {
  const open = usePrisma((s) => s.chatOpen)
  return (
    <button className={`side-item prisma-entry${open ? ' on' : ''}`} onClick={() => pset((s) => ({ chatOpen: !s.chatOpen }))}>
      <span className="prisma-entry-face"><PrismaMark size={20} /></span>
      <span className="grow two-line"><strong>Prisma</strong><span>Tua assistente: fala “Prisma…”</span></span>
    </button>
  )
}

// ============================================================ chat com a Prisma
function ChatPanel() {
  const { open, chat, mood, listening, canListen, recording, server } = usePrisma(useShallow((s) => ({ open: s.chatOpen, chat: s.chat, mood: s.mood, listening: s.listening, canListen: s.canListen, recording: s.recording, server: s.server })))
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { list.current?.scrollTo({ top: 1e6 }); if (!matchMedia('(pointer: coarse)').matches) input.current?.focus() } }, [open, chat.length])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') pset({ chatOpen: false }) }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  const send = (value: string) => {
    const t = value.trim()
    if (!t) return
    setText('')
    void handle(t.replace(/^\s*prisma[,!:]?\s*/i, '') || t, 'text')
  }
  return (
    <section className="prisma-chat" role="dialog" aria-label="Conversa com a Prisma">
      <header className="prisma-chat-head">
        <span className={`prisma-chat-face mood-${mood}`}><Gem size={30} speed={mood === 'thinking' ? 2.2 : 0.8} /></span>
        <span className="grow two-line">
          <strong>Prisma</strong>
          <span>{mood === 'thinking' ? 'pensando…' : mood === 'speaking' ? 'falando…' : recording ? 'ouvindo você…' : listening ? 'ouvindo “Prisma”' : 'assistente do Krata'}</span>
        </span>
        {canListen && (
          <button className={`icon-btn${listening ? ' on' : ''}`} onClick={() => setListening(!listening)} aria-pressed={listening} aria-label={listening ? 'Parar de ouvir o tempo todo' : 'Ouvir “Prisma” o tempo todo'} data-tip={listening ? 'Escuta ligada' : 'Escuta desligada'}>
            {listening ? <Mic size={17} /> : <MicOff size={17} />}
          </button>
        )}
        <button className="icon-btn" onClick={() => pset({ chatOpen: false })} aria-label="Fechar conversa com a Prisma"><X size={18} /></button>
      </header>
      <div className="prisma-chat-list" ref={list} aria-live="polite">
        {chat.length === 0 && (
          <div className="prisma-chat-empty">
            <p>Eae! Eu faço qualquer coisa no Krata pra você. {canListen ? 'É só falar “Prisma” e pedir, ou escrever aqui.' : 'Toca no meu botão pra falar, ou escreve aqui.'}</p>
            <div className="prisma-chips">
              {EXAMPLES.slice(0, 6).map((e) => <button key={e} className="chip" onClick={() => send(e)}>{e.replace(/^Prisma, /, '')}</button>)}
            </div>
          </div>
        )}
        {chat.map((t, i) => <div key={`${t.at}-${i}`} className={`prisma-turn ${t.role}`}>{t.content}</div>)}
        {mood === 'thinking' && <div className="prisma-turn assistant typing" aria-label="Prisma está pensando"><i /><i /><i /></div>}
      </div>
      <form className="prisma-chat-form" onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <button type="button" className={`icon-btn${recording ? ' rec' : ''}`} onClick={() => void pushToTalk()} aria-label={recording ? 'Parar gravação' : 'Falar'} aria-pressed={recording}><Mic size={18} /></button>
        <input ref={input} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Pede qualquer coisa…" aria-label="Mensagem para a Prisma" maxLength={800} enterKeyHint="send" />
        <button className="icon-btn send" disabled={!text.trim()} aria-label="Enviar"><Send size={17} /></button>
      </form>
      {server && server.groq && server.limit > 0 && <p className="prisma-usage">Papo com a IA hoje: {server.used}/{server.limit}. Comandos não contam.</p>}
      {server && !server.groq && <p className="prisma-usage">Modo local: comandos funcionam; o papo livre liga quando a chave da Groq estiver no servidor.</p>}
    </section>
  )
}

// ============================================================ telinhas da Prisma
function Panel() {
  const panel = usePrisma((s) => s.panel)
  const [closing, setClosing] = useState(false)
  const [shown, setShown] = useState<PanelState | null>(panel)
  useEffect(() => {
    if (panel) { setShown(panel); setClosing(false); return }
    if (!shown) return
    setClosing(true)
    const t = setTimeout(() => { setShown(null); setClosing(false) }, 260)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel])
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [panel])
  if (!shown) return null
  const title = shown.kind === 'screen' ? 'Compartilhar tela' : shown.title
  return (
    <div className={`prisma-panel-veil${closing ? ' closing' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <section className="prisma-panel" role="dialog" aria-modal="true" aria-label={title}>
        <span className="prisma-panel-sheen" aria-hidden="true" />
        <header className="prisma-panel-head">
          <span className="prisma-panel-face"><PrismaMark size={18} /></span>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Fechar"><X size={18} /></button>
        </header>
        {shown.kind === 'upload' && <UploadPanel p={shown} />}
        {shown.kind === 'confirm' && <ConfirmPanel p={shown} />}
        {shown.kind === 'screen' && <ScreenPanel quality={shown.quality} />}
        {shown.kind === 'link' && <LinkPanel url={shown.url} />}
        {shown.kind === 'list' && <ul className="prisma-list">{shown.items.map((x) => <li key={x}>{x}</li>)}</ul>}
      </section>
    </div>
  )
}
function close() {
  cancelPending()
  if (pget().panel) panelDone('')
}

function UploadPanel({ p }: { p: Extract<PanelState, { kind: 'upload' }> }) {
  const me = useApp((s) => s.me)!
  const server = useApp((s) => s.servers.find((x) => x.id === p.serverId))
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [name, setName] = useState(p.emojiName || '')
  const input = useRef<HTMLInputElement>(null)
  const current = p.target === 'avatar' ? me.avatar_url : p.target === 'banner' ? me.banner_url : p.target === 'server_icon' ? server?.icon_url ?? null : null

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) void choose(f) }
    addEventListener('paste', onPaste)
    return () => removeEventListener('paste', onPaste)
  })

  async function choose(picked: File | undefined) {
    if (!picked) return
    if (!picked.type.startsWith('image/')) return toast('Escolhe um arquivo de imagem.', 'error')
    if (picked.size > MAX_AVATAR_BYTES) return toast('A imagem pode ter até 10 MB.', 'error')
    const f = await cropImage(picked, p.target === 'banner' ? 'wide' : p.target === 'avatar' ? 'circle' : 'rounded', p.target === 'banner' ? 'Ajustar banner' : 'Ajustar imagem')
    if (!f) return
    setFile(f)
    setUrl(URL.createObjectURL(f))
  }
  const cleanName = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)

  async function apply() {
    if (!file || busy) return
    if (p.target === 'emoji' && cleanName.length < 2) return toast('Dá um nome pro emoji (2 letras ou mais).', 'error')
    setBusy(true)
    try {
      let ok = false
      if (p.target === 'emoji') ok = await addEmoji(p.serverId!, cleanName, file)
      else {
        const uploaded = await uploadFile('avatars', me.id, file, setProgress).promise
        if (p.target === 'avatar') ok = await updateProfile({ avatar_url: uploaded })
        else if (p.target === 'banner') ok = await updateProfile({ banner_url: uploaded })
        else ok = await updateServer(p.serverId!, { icon_url: uploaded })
      }
      if (!ok) { setBusy(false); return }
      celebrate()
      panelDone(p.target === 'avatar' ? say.avatarDone() : p.target === 'banner' ? say.bannerDone() : p.target === 'server_icon' ? say.iconDone() : `Emoji :${cleanName}: adicionado!`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não deu pra enviar a imagem.', 'error')
      setBusy(false)
    }
  }

  const shape = p.target === 'banner' ? 'wide' : p.target === 'avatar' ? 'round' : 'square'
  const shownUrl = url || safeMediaUrl(current)
  return (
    <>
      <div className="prisma-panel-body">
        <button
          type="button" className={`prisma-drop ${shape}${drag ? ' drag' : ''}${shownUrl ? ' has' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void choose(e.dataTransfer.files[0]) }}
          aria-label="Escolher imagem"
        >
          {shownUrl ? <img src={shownUrl} alt="" /> : <span className="prisma-drop-empty"><ImagePlus size={28} /><span>Toca pra escolher<br /><small>ou arrasta/cola uma imagem</small></span></span>}
          {busy && <span className="prisma-drop-progress" style={{ '--p': progress } as CSSProperties} />}
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = '' }} />
        {p.target === 'emoji' && (
          <label className="field"><span className="field-label">Nome do emoji</span>
            <div className="input with-prefix"><span>:</span><input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="nome_do_emoji" aria-label="Nome do emoji" /></div>
          </label>
        )}
        <p className="fine">{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : p.target === 'banner' ? 'Imagens largas ficam melhores. GIF animado vale.' : 'Até 10 MB. GIF animado vale pra todo mundo.'}</p>
      </div>
      <footer className="prisma-panel-foot">
        <button className="btn ghost" onClick={() => (file ? input.current?.click() : close())}>{file ? 'Escolher outra' : 'Cancelar'}</button>
        <button className="btn primary" disabled={!file || busy} onClick={() => void apply()}>{busy ? (progress > 0 && progress < 1 ? `Enviando ${Math.round(progress * 100)}%` : 'Salvando…') : <><Check size={16} /> Usar esta</>}</button>
      </footer>
    </>
  )
}

function ConfirmPanel({ p }: { p: Extract<PanelState, { kind: 'confirm' }> }) {
  const [busy, setBusy] = useState(false)
  return (
    <>
      <div className="prisma-panel-body"><p>{p.text}</p></div>
      <footer className="prisma-panel-foot">
        <button className="btn ghost" onClick={close}>Cancelar</button>
        <button className={`btn ${p.danger ? 'danger' : 'primary'}`} disabled={busy} onClick={async () => { setBusy(true); pset({ panel: null }); await p.onYes() }}>{p.action}</button>
      </footer>
    </>
  )
}

const QUALITIES: Resolution[] = ['2160', '1440', '1080', '720', 'source']
function ScreenPanel({ quality }: { quality?: string }) {
  const saved = useVoice((v) => v.screenSettings)
  const [res, setRes] = useState<Resolution>((QUALITIES as string[]).includes(quality || '') ? quality as Resolution : saved.resolution)
  const [fps, setFps] = useState<15 | 30 | 60>(saved.fps)
  const [audio, setAudio] = useState(saved.audio)
  const [busy, setBusy] = useState(false)
  const supported = canShareScreen()
  async function go() {
    setBusy(true)
    const ok = await startScreen({ ...saved, resolution: res, fps, audio, apps: savedAudioApps() })
    setBusy(false)
    if (ok) { celebrate(); panelDone(`Tá no ar em ${RES[res].label}! GG.`) }
  }
  if (!supported) return (
    <>
      <div className="prisma-panel-body"><p>{isIOS() ? 'O iPhone e o iPad não deixam nenhum site transmitir a tela.' : 'Este navegador não deixa transmitir a tela.'} Você assiste às transmissões normalmente; pra transmitir em 4K, abre o Krata no computador.</p></div>
      <footer className="prisma-panel-foot"><button className="btn primary" onClick={close}>Entendi</button></footer>
    </>
  )
  return (
    <>
      <div className="prisma-panel-body">
        <div className="seg" role="radiogroup" aria-label="Resolução">
          {QUALITIES.map((r) => <button key={r} type="button" role="radio" aria-checked={res === r} className={res === r ? 'on' : ''} onClick={() => setRes(r)}>{RES[r].label}</button>)}
        </div>
        <div className="seg" role="radiogroup" aria-label="Quadros por segundo">
          {([30, 60] as const).map((f) => <button key={f} type="button" role="radio" aria-checked={fps === f} className={fps === f ? 'on' : ''} onClick={() => setFps(f)}>{f} fps</button>)}
        </div>
        <label className="switch-row"><span><strong>Com som</strong></span><input type="checkbox" className="switch" checked={audio} onChange={(e) => setAudio(e.target.checked)} /></label>
        <p className="fine">O navegador pede um toque teu pra escolher a janela. Qualidade máxima liberada pra todo mundo.</p>
      </div>
      <footer className="prisma-panel-foot">
        <button className="btn ghost" onClick={close}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => void go()}><MonitorUp size={16} /> Escolher o que mostrar</button>
      </footer>
    </>
  )
}

function LinkPanel({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600) }
    catch { toast('Seleciona o link e copia manualmente.', 'error') }
  }
  return (
    <>
      <div className="prisma-panel-body">
        <input className="input mono" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link" />
      </div>
      <footer className="prisma-panel-foot">
        {'share' in navigator && <button className="btn ghost" onClick={() => void navigator.share({ title: 'Convite do Krata', url }).catch(() => {})}><Share2 size={16} /> Compartilhar</button>}
        <button className="btn primary" onClick={() => void copy()}>{copied ? <><Check size={16} /> Copiado</> : <><Copy size={16} /> Copiar</>}</button>
      </footer>
    </>
  )
}

// ============================================================ configurações
export function PrismaSettings() {
  const { listening, captions, server } = usePrisma(useShallow((s) => ({ listening: s.listening, captions: s.captions, server: s.server })))
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => femaleVoices())
  const [voiceName, setVoiceName] = useState(chosenVoice())
  const [vol, setVol] = useState(volume())
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return
    const load = () => setVoices(femaleVoices())
    speechSynthesis.addEventListener?.('voiceschanged', load)
    const t = setTimeout(load, 600)
    return () => { speechSynthesis.removeEventListener?.('voiceschanged', load); clearTimeout(t) }
  }, [])
  const store = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }
  const continuous = canContinuous()
  return (
    <div className="prisma-settings">
      <div className="prisma-settings-hero">
        <Gem size={64} interactive speed={0.9} />
        <div>
          <strong>Prisma</strong>
          <p className="muted">Fala “Prisma” no começo ou no meio da frase e ela faz: cria servidor, manda mensagem, troca tua foto, entra na call, compartilha a tela…</p>
        </div>
      </div>
      <label className="switch-row">
        <span><strong>Ouvir “Prisma” o tempo todo</strong><span className="muted">{continuous ? 'O microfone fica ligado só pra ouvir o nome dela. Nada é gravado; ela só reage quando ouve “Prisma”.' : speechSupport() ? 'Neste aparelho o navegador não deixa ouvir o tempo todo. Toca no botão dela pra falar.' : 'Este navegador não reconhece fala contínua. Toca no botão dela pra falar (usa o servidor).'}</span></span>
        <input type="checkbox" className="switch" disabled={!continuous} checked={listening} onChange={(e) => setListening(e.target.checked)} />
      </label>
      <label className="switch-row">
        <span><strong>Legenda das respostas</strong><span className="muted">Mostra num balão o que ela fala.</span></span>
        <input type="checkbox" className="switch" checked={captions} onChange={(e) => { pset({ captions: e.target.checked }); store('krata-prisma-captions', e.target.checked ? 'on' : 'off') }} />
      </label>
      {!server?.tts && (
        <label className="field"><span className="field-label">Voz</span>
          <select className="input" value={voiceName} onChange={(e) => { setVoiceName(e.target.value); store('krata-prisma-voice', e.target.value) }}>
            <option value="">Automática (melhor voz feminina do aparelho)</option>
            {voices.map((v) => <option key={v.name} value={v.name}>{v.name.replace(/Microsoft |Google /, '')} · {v.lang}</option>)}
          </select>
        </label>
      )}
      <label className="field"><span className="field-label">Volume da voz</span>
        <div className="row-gap">
          <Volume2 size={16} />
          <input type="range" min={0} max={1} step={0.05} value={vol} aria-label="Volume da voz da Prisma" onChange={(e) => { setVol(Number(e.target.value)); store('krata-prisma-volume', e.target.value) }} />
          <button type="button" className="btn ghost small" onClick={() => void speak(`Oi, ${app().me?.display_name.split(' ')[0] || ''}! Essa é minha voz.`)}>Testar</button>
        </div>
      </label>
      <p className="notice">
        {server?.groq ? `Conversa livre ligada (IA da Groq). Hoje: ${server.used}/${server.limit} papos. Comandos do app não contam no limite e funcionam até offline.` : 'Conversa livre desligada: falta a chave da Groq no servidor. Todos os comandos do app funcionam normalmente.'}
      </p>
      <div className="prisma-examples">
        <span className="field-label">Experimenta falar</span>
        <ul>{EXAMPLES.map((e) => <li key={e}>“{e}”</li>)}</ul>
      </div>
      <button type="button" className="btn ghost small" onClick={() => { forgetLearning(); toast('A Prisma esqueceu o que aprendeu neste aparelho.', 'ok') }}><Trash2 size={15} /> Apagar o que ela aprendeu aqui</button>
    </div>
  )
}
