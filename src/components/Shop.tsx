// Loja do Krata: vitrine de bundles, compra por PIX, inventário, painel da artista e do desenvolvedor.
import { BadgeCheck, Check, Clock, Copy, Gem as GemIcon, ImagePlus, Paintbrush, QrCode, RefreshCw, ShieldCheck, ShoppingBag, Sparkles, Trash2, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Bundle, Profile } from '../lib/types'
import { safeMediaUrl } from '../lib/supabase'
import {
  AVATAR_FRAME, CARD_FRAME, FEE_PERCENT, MAX_CENTS, MIN_CENTS, archiveBundle, artistKeys, artistStats, brl, checkOrder, detectPix, devConfirm, devOrders,
  devRetryPayout, devStats, equip, imageSize, loadInventory, myPixKey, parseBrl, paymentsLive, reviewBundle, savePixKey, setBundlePrice, startPurchase,
  statusLabel, submitBundle, uploadArt, validCpf, type DevStats, type Order, type OrderRow, type PayoutRow, type PixType,
} from '../lib/shop'
import { ensureProfiles, loadExtras } from '../store/actions'
import { closeModal, openModal, toast, useApp } from '../store/app'
import { Avatar, CardFrame, Modal, Spinner } from './ui'

// ============================================================ prévia (card de perfil em miniatura com as molduras)
export function BundlePreview({ bundle, who, size = 'md' }: { bundle: Pick<Bundle, 'avatar_frame' | 'card_frame'>; who?: Profile | null; size?: 'sm' | 'md' }) {
  const me = useApp((s) => s.me)
  const p = who || me
  return (
    <div className={`bundle-preview ${size}`} style={{ ['--accent' as string]: p?.accent_color || '#00A86B' }}>
      <div className="bp-banner" style={safeMediaUrl(p?.banner_url) ? { backgroundImage: `url("${safeMediaUrl(p?.banner_url)}")` } : undefined} />
      <div className="bp-avatar"><Avatar profile={p} size={size === 'sm' ? 54 : 74} frame={bundle.avatar_frame} /></div>
      <div className="bp-lines"><b>{p?.display_name || 'Seu nome'}</b><span>@{p?.username || 'voce'}</span><i /><i /></div>
      <CardFrame src={bundle.card_frame} />
    </div>
  )
}

const ArtistTag = ({ id }: { id: string }) => {
  const p = useApp((s) => s.profiles[id])
  return <span className="artist-tag"><BadgeCheck size={13} /> {p ? `@${p.username}` : 'Artista oficial'}</span>
}

// ============================================================ loja
export function ShopModal({ tab: initial }: { tab?: 'loja' | 'inventario' }) {
  const bundles = useApp((s) => s.bundles)
  const meId = useApp((s) => s.userId)!
  const equipped = useApp((s) => s.me?.equipped_bundle || null)
  const [tab, setTab] = useState<'loja' | 'inventario'>(initial || 'loja')
  const [owned, setOwned] = useState<string[] | null>(null)
  const [buying, setBuying] = useState<Bundle | null>(null)
  const forSale = useMemo(() => Object.values(bundles).filter((b) => b.status === 'approved').sort((a, b) => b.sales - a.sales || b.created_at.localeCompare(a.created_at)), [bundles])
  useEffect(() => { void loadExtras(); void loadInventory().then(setOwned) }, [])
  useEffect(() => { void ensureProfiles([...new Set(Object.values(bundles).map((b) => b.artist_id))]) }, [bundles])
  const has = (b: Bundle) => b.artist_id === meId || !!owned?.includes(b.id)

  if (buying) return <BuyFlow bundle={buying} onBack={() => setBuying(null)} onDone={() => { setBuying(null); setTab('inventario'); void loadInventory().then(setOwned) }} />
  return (
    <Modal title="Loja do Krata" onClose={closeModal} wide>
      <div className="tabs pad" role="tablist">
        <button role="tab" aria-selected={tab === 'loja'} className={`tab${tab === 'loja' ? ' on' : ''}`} onClick={() => setTab('loja')}><ShoppingBag size={15} /> Loja</button>
        <button role="tab" aria-selected={tab === 'inventario'} className={`tab${tab === 'inventario' ? ' on' : ''}`} onClick={() => setTab('inventario')}><GemIcon size={15} /> Inventário</button>
      </div>
      <div className="modal-body tall">
        {tab === 'inventario' ? <Inventory /> : (
          <>
            <p className="muted shop-intro"><Sparkles size={15} /> Molduras exclusivas feitas pelos artistas oficiais do Krata. Comprou, equipou: todo mundo vê na hora.</p>
            {forSale.length === 0 ? (
              <div className="shop-empty"><ShoppingBag size={34} /><strong>A loja abre em breve</strong><span className="muted">Os primeiros bundles estão sendo preparados pelos nossos artistas.</span></div>
            ) : (
              <div className="shop-grid">
                {forSale.map((b) => (
                  <article key={b.id} className="shop-item">
                    <BundlePreview bundle={b} />
                    <div className="shop-item-info">
                      <strong>{b.name}</strong>
                      <ArtistTag id={b.artist_id} />
                      {b.description && <p className="muted">{b.description}</p>}
                    </div>
                    <div className="shop-item-buy">
                      {has(b) ? (
                        equipped === b.id ? <button className="btn ghost small" onClick={() => void equip(null)}><Check size={15} /> Equipado</button>
                          : <button className="btn primary small" onClick={() => void equip(b.id).then((ok) => ok && toast('Moldura equipada!', 'ok'))}>Equipar</button>
                      ) : <button className="btn primary small" onClick={() => setBuying(b)}><QrCode size={15} /> {brl(b.price_cents)}</button>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

// ============================================================ compra por PIX
function BuyFlow({ bundle, onBack, onDone }: { bundle: Bundle; onBack: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'start' | 'cpf' | 'pix' | 'paid' | 'error'>('start')
  const [order, setOrder] = useState<Order | null>(null)
  const [cpf, setCpf] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(0)
  const [live, setLive] = useState<boolean | null>(null)
  useEffect(() => { void paymentsLive().then(setLive) }, [])

  async function go(withCpf?: string) {
    setBusy(true); setMessage('')
    const r = await startPurchase(bundle.id, withCpf)
    setBusy(false)
    if ('order' in r) { setOrder(r.order); setStep(r.order.status === 'paid' ? 'paid' : 'pix'); return }
    if (r.error === 'cpf_required') { setStep('cpf'); return }
    if (r.error === 'cpf_invalid') { setStep('cpf'); setMessage('CPF inválido. Confira os números.'); return }
    setMessage(r.message || 'Não foi possível abrir a compra.'); setStep('error')
  }
  // confirma sozinho: tempo real + consulta a cada 4 s (que também pergunta ao Asaas)
  useEffect(() => {
    if (step !== 'pix' || !order) return
    let alive = true
    const done = () => { if (alive) { alive = false; setStep('paid') } }
    const onRow = (e: Event) => { const row = (e as CustomEvent<{ id: string; status: string }>).detail; if (row.id === order.id && row.status === 'paid') done() }
    window.addEventListener('krata-order', onRow)
    const t = setInterval(async () => { const o = await checkOrder(order.id); if (o?.status === 'paid') done(); else if (o && o.status !== 'pending') { setStep('error'); setMessage('Este PIX venceu. Gere outro para comprar.') } }, 4000)
    const c = setInterval(() => setLeft(Math.max(0, Math.round((new Date(order.expires_at).getTime() - Date.now()) / 1000))), 1000)
    return () => { alive = false; window.removeEventListener('krata-order', onRow); clearInterval(t); clearInterval(c) }
  }, [step, order])

  const cpfDigits = cpf.replace(/\D/g, '')
  const cpfPretty = cpfDigits.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2').slice(0, 14)
  return (
    <Modal title={step === 'paid' ? 'Compra concluída' : `Comprar ${bundle.name}`} onClose={closeModal}>
      <div className="modal-body buy-flow">
        <div className="buy-head">
          <BundlePreview bundle={bundle} size="sm" />
          <div><strong>{bundle.name}</strong><ArtistTag id={bundle.artist_id} /><span className="buy-price">{brl(bundle.price_cents)}</span></div>
        </div>
        {step === 'start' && (
          <>
            <p className="muted">O pagamento é por PIX e confirma sozinho em segundos. O bundle vai direto para o seu Inventário.</p>
            {live === false && <p className="notice">Modo de teste: o PIX de verdade ainda não foi ligado no servidor. O pedido fica esperando a confirmação do desenvolvedor.</p>}
            <button className="btn primary block" disabled={busy} onClick={() => void go()}>{busy ? 'Gerando PIX…' : <><QrCode size={17} /> Pagar com PIX</>}</button>
          </>
        )}
        {step === 'cpf' && (
          <form onSubmit={(e) => { e.preventDefault(); if (validCpf(cpfDigits)) void go(cpfDigits); else setMessage('CPF inválido. Confira os números.') }}>
            <p className="muted">O PIX precisa do CPF de quem paga (pedido só na primeira compra; o Krata não guarda o número).</p>
            <label className="field"><span className="field-label">Seu CPF</span><input className="input" inputMode="numeric" autoFocus value={cpfPretty} placeholder="000.000.000-00" onChange={(e) => { setCpf(e.target.value); setMessage('') }} /></label>
            {message && <p className="field-error">{message}</p>}
            <button className="btn primary block" disabled={busy || cpfDigits.length !== 11}>{busy ? 'Gerando PIX…' : 'Continuar'}</button>
          </form>
        )}
        {step === 'pix' && order && (
          <div className="pix-box">
            {order.test ? (
              <div className="pix-test"><ShieldCheck size={28} /><strong>Pedido de teste criado</strong><span className="muted">Os pagamentos reais ainda não foram ligados. Assim que o desenvolvedor confirmar este pedido no painel dele, o bundle aparece aqui sozinho.</span></div>
            ) : (
              <>
                {order.pix_image && <img className="pix-qr" src={`data:image/png;base64,${order.pix_image}`} alt="QR Code do PIX" />}
                <p className="muted">Abra o app do seu banco, escolha PIX → Ler QR Code, ou copie o código abaixo.</p>
                <div className="copy-row">
                  <input className="input" readOnly value={order.pix_payload || ''} aria-label="PIX copia e cola" onFocus={(e) => e.target.select()} />
                  <button className="btn primary" onClick={() => void navigator.clipboard?.writeText(order.pix_payload || '').then(() => toast('Código PIX copiado', 'ok'))}><Copy size={16} /> Copiar</button>
                </div>
              </>
            )}
            <p className="pix-wait"><span className="pix-dot" /> Esperando o pagamento… {left > 0 && <span className="muted"><Clock size={13} /> {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}</p>
          </div>
        )}
        {step === 'paid' && (
          <div className="buy-done">
            <Sparkles size={30} />
            <strong>Pagamento confirmado!</strong>
            <span className="muted">O {bundle.name} já está no seu Inventário.</span>
            <button className="btn primary block" onClick={() => void equip(bundle.id).then((ok) => { if (ok) { toast('Moldura equipada! Todo mundo já está vendo.', 'ok'); onDone() } })}>Equipar agora</button>
            <button className="btn ghost block" onClick={onDone}>Ver inventário</button>
          </div>
        )}
        {step === 'error' && (
          <>
            <p className="notice">{message}</p>
            <button className="btn primary block" onClick={() => { setStep('start'); setOrder(null) }}><RefreshCw size={16} /> Tentar de novo</button>
          </>
        )}
      </div>
      <footer className="modal-foot">
        {step !== 'paid' && <button className="btn ghost" onClick={onBack}>Voltar para a loja</button>}
      </footer>
    </Modal>
  )
}

// ============================================================ inventário (loja e configurações)
export function Inventory() {
  const bundles = useApp((s) => s.bundles)
  const meId = useApp((s) => s.userId)!
  const equipped = useApp((s) => s.me?.equipped_bundle || null)
  const [owned, setOwned] = useState<string[] | null>(null)
  useEffect(() => { void loadInventory().then(setOwned) }, [])
  const mine = useMemo(() => Object.values(bundles).filter((b) => owned?.includes(b.id) || (b.artist_id === meId && (b.status === 'approved' || b.status === 'archived'))), [bundles, owned, meId])
  if (!owned) return <Spinner />
  if (!mine.length) return (
    <div className="shop-empty"><GemIcon size={32} /><strong>Seu inventário está vazio</strong><span className="muted">Os bundles que você comprar aparecem aqui para equipar.</span>
      <button className="btn primary small" onClick={() => openModal({ type: 'shop' })}><ShoppingBag size={15} /> Abrir a loja</button></div>
  )
  return (
    <div className="shop-grid">
      {mine.map((b) => (
        <article key={b.id} className={`shop-item${equipped === b.id ? ' equipped' : ''}`}>
          <BundlePreview bundle={b} />
          <div className="shop-item-info"><strong>{b.name}</strong><ArtistTag id={b.artist_id} /></div>
          <div className="shop-item-buy">
            {equipped === b.id ? <button className="btn ghost small" onClick={() => void equip(null)}><X size={15} /> Tirar</button>
              : <button className="btn primary small" onClick={() => void equip(b.id).then((ok) => ok && toast('Moldura equipada!', 'ok'))}>Equipar</button>}
          </div>
        </article>
      ))}
    </div>
  )
}

// ============================================================ painel da artista
const PIX_LABEL: Record<PixType, string> = { cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', phone: 'Celular', evp: 'Chave aleatória' }

function ArtPick({ label, hint, value, need, onChange }: { label: string; hint: string; value: string; need: { w: number; h: number }; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function pick(file: File) {
    setError('')
    if (!/^image\/(png|webp|gif)$/.test(file.type)) return setError('Use PNG, WebP ou GIF com fundo transparente.')
    if (file.size > 4 * 1024 * 1024) return setError('A imagem passa de 4 MB.')
    const sz = await imageSize(file)
    if (!sz) return setError('Não consegui ler esta imagem.')
    if (sz.w !== need.w || sz.h !== need.h) return setError(`A arte precisa ter exatamente ${need.w} × ${need.h} px (esta tem ${sz.w} × ${sz.h}).`)
    setBusy(true)
    try { onChange(await uploadArt(file)) } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  return (
    <div className="art-pick">
      <span className="field-label">{label}</span>
      <button type="button" className={`art-drop${value ? ' has' : ''}`} onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Spinner /> : value ? <img src={safeMediaUrl(value) || undefined} alt="" /> : <><ImagePlus size={22} /><span>{need.w} × {need.h} px</span></>}
      </button>
      <span className="fine">{hint}</span>
      {error && <span className="field-error">{error}</span>}
      <input ref={input} type="file" hidden accept="image/png,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }} />
    </div>
  )
}

export function ArtistPanel() {
  const bundles = useApp((s) => s.bundles)
  const meId = useApp((s) => s.userId)!
  const [pix, setPix] = useState('')
  const [saved, setSaved] = useState<{ pix_key: string; pix_type: PixType } | null | undefined>(undefined)
  const [stats, setStats] = useState<Awaited<ReturnType<typeof artistStats>>>(null)
  const empty = { id: '', name: '', description: '', price: '', avatar_frame: '', card_frame: '' }
  const [f, setF] = useState(empty)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void myPixKey().then((k) => { setSaved(k); if (k) setPix(k.pix_key) }); void artistStats().then(setStats); void loadExtras() }, [])
  const det = detectPix(pix)
  const mine = useMemo(() => Object.values(bundles).filter((b) => b.artist_id === meId).sort((a, b) => b.created_at.localeCompare(a.created_at)), [bundles, meId])
  const price = parseBrl(f.price)
  const priceOk = price !== null && price >= MIN_CENTS && price <= MAX_CENTS
  const ready = f.name.trim().length >= 2 && priceOk && f.avatar_frame && f.card_frame

  async function send() {
    if (!ready || price === null) return
    setBusy(true)
    const ok = await submitBundle({ id: f.id || undefined, name: f.name.trim(), description: f.description.trim(), avatar_frame: f.avatar_frame, card_frame: f.card_frame, price_cents: price })
    setBusy(false)
    if (ok) { toast('Enviado! O bundle aparece na loja assim que for aprovado.', 'ok'); setF(empty); void loadExtras() }
  }
  return (
    <div className="artist-panel">
      <div className="panel-hero"><Paintbrush size={20} /><div><strong>Painel da artista</strong><span className="muted">Publicar é de graça. A cada venda, {100 - FEE_PERCENT}% vão direto para a sua chave PIX e {FEE_PERCENT}% ficam com o Krata.</span></div></div>
      {stats && (
        <div className="stat-row">
          <div><b>{stats.sales}</b><span>vendas</span></div>
          <div><b>{brl(stats.earned_cents)}</b><span>seus ganhos</span></div>
          <div><b>{brl(stats.paid_out_cents)}</b><span>já no seu PIX</span></div>
        </div>
      )}

      <section className="panel-card">
        <h4><Wallet size={16} /> Sua chave PIX</h4>
        <div className="pix-field">
          <input className="input" value={pix} placeholder="CPF, celular, e-mail ou chave aleatória" onChange={(e) => setPix(e.target.value)} aria-label="Chave PIX" />
          {pix && <span className={`pix-kind${det.valid ? ' ok' : ' bad'}`}>{det.valid && det.type ? PIX_LABEL[det.type] : det.label || 'Inválida'}</span>}
        </div>
        {pix && det.valid && det.pretty !== pix && <span className="fine">Vai ficar assim: <b>{det.pretty}</b></span>}
        <div className="row-end">
          {saved && saved.pix_key === det.key ? <span className="fine ok-text"><Check size={14} /> Chave salva</span> : null}
          <button className="btn primary small" disabled={!det.valid || !det.type || (saved?.pix_key === det.key)} onClick={async () => { if (det.type && await savePixKey(det.key, det.type)) { setSaved({ pix_key: det.key, pix_type: det.type }); toast('Chave PIX salva', 'ok') } }}>Salvar chave</button>
        </div>
        {saved === null && <p className="notice">Sem a chave PIX, seus bundles aparecem na loja mas não podem ser comprados.</p>}
      </section>

      <section className="panel-card">
        <h4><Sparkles size={16} /> {f.id ? 'Editar bundle' : 'Novo bundle'}</h4>
        <div className="bundle-form">
          <div className="bundle-form-fields">
            <label className="field"><span className="field-label">Nome</span><input className="input" maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Aurora de Jade" /></label>
            <label className="field"><span className="field-label">Descrição (opcional)</span><textarea className="input" rows={2} maxLength={240} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <label className="field"><span className="field-label">Preço</span>
              <div className="input with-prefix"><span>R$</span><input inputMode="decimal" value={f.price} placeholder="9,90" onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
            </label>
            {f.price && !priceOk && <span className="field-error">Entre {brl(MIN_CENTS)} e {brl(MAX_CENTS)}.</span>}
            {priceOk && price !== null && <span className="fine">Você recebe {brl(price - Math.round(price * FEE_PERCENT / 100))} por venda.</span>}
            <div className="art-picks">
              <ArtPick label="Moldura da foto" need={{ w: AVATAR_FRAME.w, h: AVATAR_FRAME.h }} value={f.avatar_frame} onChange={(u) => setF((x) => ({ ...x, avatar_frame: u }))}
                hint={`PNG transparente de ${AVATAR_FRAME.w}×${AVATAR_FRAME.h}. A foto fica no círculo central de ${AVATAR_FRAME.hole} px; desenhe em volta.`} />
              <ArtPick label="Moldura do card" need={{ w: CARD_FRAME.w, h: CARD_FRAME.h }} value={f.card_frame} onChange={(u) => setF((x) => ({ ...x, card_frame: u }))}
                hint={`PNG transparente de ${CARD_FRAME.w}×${CARD_FRAME.h}. Desenhe só na borda de ${CARD_FRAME.edge} px: os cantos ficam intactos e os lados esticam com o card.`} />
            </div>
          </div>
          <div className="bundle-form-preview">
            <span className="field-label">Prévia</span>
            <BundlePreview bundle={{ avatar_frame: f.avatar_frame, card_frame: f.card_frame }} />
          </div>
        </div>
        <div className="row-end">
          {f.id && <button className="btn ghost small" onClick={() => setF(empty)}>Cancelar edição</button>}
          <button className="btn primary" disabled={!ready || busy} onClick={() => void send()}>{busy ? 'Enviando…' : f.id ? 'Reenviar para aprovação' : 'Enviar para aprovação'}</button>
        </div>
      </section>

      <section className="panel-card">
        <h4>Seus bundles</h4>
        {mine.length === 0 ? <p className="muted">Nenhum ainda. Envie o primeiro acima.</p> : (
          <ul className="bundle-list">
            {mine.map((b) => (
              <li key={b.id}>
                <BundlePreview bundle={b} size="sm" />
                <div className="grow">
                  <strong>{b.name}</strong>
                  <span className={`status-pill ${b.status}`}>{statusLabel[b.status]}</span>
                  <span className="fine">{brl(b.price_cents)}{b.price_cents !== b.asked_cents ? ` (você pediu ${brl(b.asked_cents)})` : ''} · {b.sales} {b.sales === 1 ? 'venda' : 'vendas'}</span>
                  {b.status === 'rejected' && b.review_note && <span className="fine bad-text">Motivo: {b.review_note}</span>}
                </div>
                <div className="bundle-list-actions">
                  {(b.status === 'pending' || b.status === 'rejected') && <button className="btn ghost small" onClick={() => setF({ id: b.id, name: b.name, description: b.description, price: (b.asked_cents / 100).toFixed(2).replace('.', ','), avatar_frame: b.avatar_frame, card_frame: b.card_frame })}>Editar</button>}
                  {b.status !== 'archived' && <button className="icon-btn" aria-label={b.status === 'approved' ? 'Tirar da loja' : 'Apagar'} data-tip={b.status === 'approved' ? 'Tirar da loja' : 'Apagar'} onClick={() => openModal({ type: 'confirm', title: b.status === 'approved' ? 'Tirar da loja' : 'Apagar bundle', text: b.status === 'approved' ? 'Ele sai da loja, mas quem já comprou continua com ele.' : 'O envio será apagado.', action: 'Confirmar', danger: true, onConfirm: async () => { await archiveBundle(b.id); await loadExtras(); openModal({ type: 'settings', tab: 'artista' }) } })}><Trash2 size={16} /></button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ============================================================ painel do desenvolvedor
export function DevPanel() {
  const bundles = useApp((s) => s.bundles)
  const profiles = useApp((s) => s.profiles)
  const [stats, setStats] = useState<DevStats | null>(null)
  const [data, setData] = useState<{ orders: OrderRow[]; payouts: PayoutRow[] } | null>(null)
  const [keys, setKeys] = useState<Record<string, { pix_key: string; pix_type: string }>>({})
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const refresh = async () => {
    await loadExtras()
    const [s, d, k] = await Promise.all([devStats(), devOrders(), artistKeys()])
    setStats(s); setData(d); setKeys(k)
    void ensureProfiles([...new Set([...d.orders.flatMap((o) => [o.buyer_id, o.artist_id]), ...Object.values(useApp.getState().bundles).map((b) => b.artist_id)])])
  }
  useEffect(() => { void refresh() }, [])
  const list = Object.values(bundles)
  const pending = list.filter((b) => b.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at))
  const live = list.filter((b) => b.status === 'approved')
  const who = (id: string | null) => (id && profiles[id] ? `@${profiles[id].username}` : '—')
  const priceOf = (b: Bundle) => prices[b.id] ?? (b.price_cents / 100).toFixed(2).replace('.', ',')

  return (
    <div className="dev-panel">
      <div className="panel-hero"><ShieldCheck size={20} /><div><strong>Painel do desenvolvedor</strong><span className="muted">Aprovação de bundles, preços, pedidos e repasses.</span></div><button className="icon-btn" aria-label="Atualizar" onClick={() => void refresh()}><RefreshCw size={16} /></button></div>
      {stats && (
        <div className="stat-row">
          <div><b>{stats.pending_bundles}</b><span>para aprovar</span></div>
          <div><b>{stats.sales}</b><span>vendas</span></div>
          <div><b>{brl(stats.gross_cents)}</b><span>vendido</span></div>
          <div><b>{brl(stats.krata_cents)}</b><span>Krata ({FEE_PERCENT}%)</span></div>
        </div>
      )}

      <section className="panel-card">
        <h4>Esperando aprovação {pending.length > 0 && <span className="badge inline">{pending.length}</span>}</h4>
        {pending.length === 0 ? <p className="muted">Nada para aprovar agora.</p> : pending.map((b) => {
          const cents = parseBrl(priceOf(b))
          const ok = cents !== null && cents >= MIN_CENTS && cents <= MAX_CENTS
          return (
            <div key={b.id} className="review-item">
              <BundlePreview bundle={b} />
              <div className="review-info">
                <strong>{b.name}</strong>
                <span className="fine">por {who(b.artist_id)} · pediu {brl(b.asked_cents)} · chave PIX {keys[b.artist_id] ? `${keys[b.artist_id].pix_type}: ${keys[b.artist_id].pix_key}` : 'não cadastrada'}</span>
                {b.description && <p className="muted">{b.description}</p>}
                <div className="review-links"><a href={safeMediaUrl(b.avatar_frame) || '#'} target="_blank" rel="noreferrer">Ver moldura da foto</a> · <a href={safeMediaUrl(b.card_frame) || '#'} target="_blank" rel="noreferrer">Ver moldura do card</a></div>
                <label className="field"><span className="field-label">Preço final</span><div className="input with-prefix"><span>R$</span><input inputMode="decimal" value={priceOf(b)} onChange={(e) => setPrices({ ...prices, [b.id]: e.target.value })} /></div></label>
                <input className="input" placeholder="Recado para a artista (opcional; aparece se recusar)" value={notes[b.id] || ''} onChange={(e) => setNotes({ ...notes, [b.id]: e.target.value })} />
                <div className="row-end">
                  <button className="btn ghost small" onClick={async () => { if (await reviewBundle(b.id, false, null, notes[b.id] || '')) { toast('Recusado', 'ok'); void refresh() } }}><X size={15} /> Recusar</button>
                  <button className="btn primary small" disabled={!ok} onClick={async () => { if (await reviewBundle(b.id, true, cents, '')) { toast('Aprovado: já está na loja!', 'ok'); void refresh() } }}><Check size={15} /> Aprovar por {ok && cents !== null ? brl(cents) : '…'}</button>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      <section className="panel-card">
        <h4>À venda</h4>
        {live.length === 0 ? <p className="muted">Nenhum bundle à venda.</p> : (
          <ul className="bundle-list">
            {live.map((b) => {
              const cents = parseBrl(priceOf(b))
              const changed = cents !== null && cents !== b.price_cents
              return (
                <li key={b.id}>
                  <BundlePreview bundle={b} size="sm" />
                  <div className="grow"><strong>{b.name}</strong><span className="fine">{who(b.artist_id)} · {b.sales} vendas · artista pediu {brl(b.asked_cents)}</span></div>
                  <div className="price-edit">
                    <div className="input with-prefix"><span>R$</span><input inputMode="decimal" value={priceOf(b)} aria-label={`Preço de ${b.name}`} onChange={(e) => setPrices({ ...prices, [b.id]: e.target.value })} /></div>
                    {changed && <button className="btn primary small" disabled={!cents || cents < MIN_CENTS || cents > MAX_CENTS} onClick={async () => { if (cents && await setBundlePrice(b.id, cents)) { toast('Preço atualizado', 'ok'); void refresh() } }}>Salvar</button>}
                    <button className="icon-btn" aria-label="Tirar da loja" data-tip="Tirar da loja" onClick={async () => { await archiveBundle(b.id); void refresh() }}><Trash2 size={16} /></button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="panel-card">
        <h4>Pedidos recentes</h4>
        {!data ? <Spinner /> : data.orders.length === 0 ? <p className="muted">Nenhum pedido ainda.</p> : (
          <table className="order-table"><tbody>
            {data.orders.map((o) => (
              <tr key={o.id}>
                <td>{new Date(o.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{bundles[o.bundle_id]?.name || 'bundle'}<span className="fine"> · {who(o.buyer_id)}</span></td>
                <td>{brl(o.price_cents)}</td>
                <td><span className={`status-pill ${o.status}`}>{o.status === 'paid' ? (o.manual ? 'pago (manual)' : 'pago') : o.status === 'pending' ? (o.provider_id ? 'esperando PIX' : 'teste') : o.status}</span></td>
                <td>{o.status === 'pending' && <button className="btn ghost small" onClick={() => openModal({ type: 'confirm', title: 'Confirmar pagamento', text: 'Entrega o bundle sem conferir no banco. Os repasses ficam como "manual" (você paga a artista por fora). Use só para teste ou suporte.', action: 'Confirmar', onConfirm: async () => { await devConfirm(o.id); openModal({ type: 'settings', tab: 'dev' }) } })}>Confirmar</button>}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </section>

      <section className="panel-card">
        <h4>Repasses</h4>
        {!data ? <Spinner /> : data.payouts.length === 0 ? <p className="muted">Nenhum repasse ainda.</p> : (
          <table className="order-table"><tbody>
            {data.payouts.map((p) => (
              <tr key={p.id}>
                <td>{p.kind === 'artist' ? `Artista ${who(p.user_id)}` : 'Krata (3%)'}</td>
                <td>{brl(p.cents)}</td>
                <td className="fine">{p.pix_type}: {p.pix_key}</td>
                <td><span className={`status-pill ${p.status}`}>{({ pending: 'na fila', sending: 'enviando', sent: 'enviado', done: 'recebido', failed: 'falhou', manual: 'manual' } as Record<string, string>)[p.status] || p.status}</span>{p.error && <span className="fine bad-text"> {p.error}</span>}</td>
                <td>{p.status === 'failed' && <button className="btn ghost small" onClick={async () => { await devRetryPayout(p.id); void refresh() }}>Tentar de novo</button>}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </section>
    </div>
  )
}

/** Selo de equipe oficial no perfil. */
export function StaffBadge({ username }: { username: string }) {
  const role = useApp((s) => s.staff[username])
  if (!role) return null
  return <span className={`staff-badge ${role}`}>{role === 'dev' ? <><ShieldCheck size={13} /> Desenvolvedor do Krata</> : <><Paintbrush size={13} /> Artista oficial do Krata</>}</span>
}

