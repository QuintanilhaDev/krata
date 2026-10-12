import { Eye, EyeOff, MonitorUp, Paperclip, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { USERNAME_RX, errorText, loginEmail, supabase } from '../lib/supabase'
import { usernameAvailable } from '../store/actions'
import { Field, Gem, Logo, ShardField, useParallax } from './ui'

function Stage({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  useParallax(root)
  return (
    <div className="auth" ref={root}>
      <div className="auth-scene" aria-hidden="true">
        <div className="auth-aurora" />
        <div className="auth-floor-wrap"><div className="auth-floor" /></div>
        <ShardField />
      </div>
      <div className="auth-gem-wrap"><Gem size={260} className="auth-gem" interactive /></div>
      <section className="auth-pitch">
        <div className="wordmark"><Logo size={34} /><span>Krata</span></div>
        <h1>{'Voz, chat e tela em 4K. Tudo liberado, para todo mundo.'.split(' ').map((word, i) => <span key={i} className="word" style={{ ['--i' as string]: i }}>{word} </span>)}</h1>
        <ul className="auth-points">
          <li style={{ ['--i' as string]: 0 }}><MonitorUp size={18} /><span>Compartilhe a tela em até 4K a 60 quadros por segundo, com som.</span></li>
          <li style={{ ['--i' as string]: 1 }}><Paperclip size={18} /><span>Envie fotos e vídeos de até 200 MB no chat.</span></li>
          <li style={{ ['--i' as string]: 2 }}><Sparkles size={18} /><span>Avatar animado, banner, emojis próprios e mensagens longas sem pagar nada.</span></li>
        </ul>
      </section>
      <div className="auth-card-wrap">{children}</div>
    </div>
  )
}

export function PasswordInput({ value, onChange, label, autoComplete, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="input with-prefix password">
      <input type={show ? 'text' : 'password'} value={value} maxLength={72} autoComplete={autoComplete} autoFocus={autoFocus} aria-label={label}
        onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="icon-btn tiny" onClick={() => setShow((v) => !v)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'} aria-pressed={show}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

/** 0 a 4: quanto mais variedade e tamanho, mais forte. */
export function passwordScore(p: string): number {
  if (p.length < 8) return 0
  let score = 1
  if (p.length >= 12) score++
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score++
  else if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) score += 0.5
  return Math.min(4, Math.floor(score))
}
const SCORE_LABEL = ['Muito curta', 'Fraca', 'Razoável', 'Boa', 'Forte']
export function passwordError(p: string): string | null {
  if (p.length < 8) return 'Use pelo menos 8 caracteres.'
  if (/^\d+$/.test(p) || /^[a-zA-Z]+$/.test(p)) return 'Misture letras com números ou símbolos.'
  return null
}
export function Strength({ password }: { password: string }) {
  const score = passwordError(password) ? Math.min(1, passwordScore(password)) : Math.max(2, passwordScore(password))
  return (
    <div className="strength" aria-live="polite">
      <div className={`strength-bar s${password ? score : 0}`}><i /><i /><i /><i /></div>
      <span>{password ? SCORE_LABEL[score] : 'Mínimo de 8 caracteres, com letras e números'}</span>
    </div>
  )
}

export function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [free, setFree] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const userFormat = username && !USERNAME_RX.test(username)
    ? (username.length < 3 ? 'Use pelo menos 3 caracteres.' : 'Use só letras minúsculas, números, ponto e sublinhado.') : null
  const userError = mode === 'signup' ? userFormat || (free === false ? 'Esse nome de usuário já está em uso.' : null) : null
  const passError = mode === 'signup' && touched ? passwordError(password) : null
  const confirmError = mode === 'signup' && touched && confirm && confirm !== password ? 'As senhas não são iguais.' : null

  useEffect(() => {
    setFree(null)
    if (mode !== 'signup' || !USERNAME_RX.test(username)) return
    let live = true
    const t = setTimeout(async () => { const ok = await usernameAvailable(username); if (live) setFree(ok) }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [username, mode])

  const [flips, setFlips] = useState(0)
  const switchMode = (m: 'login' | 'signup') => {
    if (m === mode) return
    setMode(m); setError(null); setTouched(false); setConfirm(''); setFlips((n) => n + 1)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (mode === 'login') {
      if (!username || !password) return setError('Preencha o nome de usuário e a senha.')
      setBusy(true)
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(username.replace(/^@/, '')), password })
      setBusy(false)
      if (error) setError(errorText(error))
      return
    }
    setTouched(true)
    if (!name.trim()) return setError('Escreva como quer ser chamado.')
    if (!USERNAME_RX.test(username) || free === false) return setError(userError || 'Escolha um nome de usuário válido.')
    if (passwordError(password)) return
    if (confirm !== password) return
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: loginEmail(username), password,
      options: { data: { username, display_name: name.trim() } },
    })
    setBusy(false)
    if (error) return setError(errorText(error))
    if (!data.session) setError('Conta criada, mas o Supabase pediu confirmação por e-mail. Desligue "Confirm email" em Authentication → Providers → Email.')
    // com sessão, a tela muda sozinha
  }

  return (
    <Stage>
      <form className={`auth-card${flips ? (flips % 2 ? ' flip-a' : ' flip-b') : ''}${mode === 'signup' ? ' to-right' : ' to-left'}`} onSubmit={submit} noValidate>
        <div className={`auth-tabs ${mode}`} role="tablist">
          <span className="auth-tabs-pill" aria-hidden="true" />
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => switchMode('login')}>Entrar</button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchMode('signup')}>Criar conta</button>
        </div>
        <div className="auth-fields" key={mode}>
          {mode === 'signup' && (
            <Field label="Nome de exibição" hint="É assim que as pessoas vão ver você. Dá para mudar depois.">
              <input className="input" value={name} maxLength={32} autoFocus autoComplete="nickname" placeholder="Como quer ser chamado" onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <Field label="Nome de usuário" error={userError} hint={mode === 'signup' ? (free && username ? 'Disponível' : 'Você entra com ele, e seus amigos te adicionam por ele. Não muda depois.') : undefined}>
            <div className="input with-prefix">
              <span>@</span>
              <input value={username} maxLength={20} autoFocus={mode === 'login'} autoComplete="username" placeholder="seunome" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Nome de usuário"
                onChange={(e) => { setUsername(e.target.value.toLowerCase().replace(/[\s@]/g, '')); setError(null) }} />
            </div>
          </Field>
          <Field label="Senha" error={passError}>
            <PasswordInput value={password} onChange={(v) => { setPassword(v); setError(null) }} label="Senha" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </Field>
          {mode === 'signup' && (
            <>
              <Strength password={password} />
              <Field label="Confirmar senha" error={confirmError}>
                <PasswordInput value={confirm} onChange={setConfirm} label="Confirmar senha" autoComplete="new-password" />
              </Field>
            </>
          )}
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy || (mode === 'signup' && free === false)}>
          {busy ? (mode === 'login' ? 'Entrando…' : 'Criando conta…') : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
        <p className="fine center">
          {mode === 'login' ? <>Ainda não tem conta? <button type="button" className="link" onClick={() => switchMode('signup')}>Criar conta</button></>
            : <>Já tem conta? <button type="button" className="link" onClick={() => switchMode('login')}>Entrar</button></>}
        </p>
      </form>
    </Stage>
  )
}

export function SetupNeeded() {
  return (
    <Stage>
      <div className="auth-card">
        <h2>Falta conectar o Supabase</h2>
        <p className="muted">O Krata precisa de duas variáveis de ambiente para funcionar. Defina as duas na Vercel (Settings → Environment Variables) e publique de novo:</p>
        <pre className="code-block">VITE_SUPABASE_URL{'\n'}VITE_SUPABASE_ANON_KEY</pre>
        <p className="muted">O passo a passo completo está no arquivo LEIA-ME.md do projeto.</p>
      </div>
    </Stage>
  )
}
