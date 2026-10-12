// Cérebro local da Prisma: entende pedidos sem gastar a IA da nuvem.
//
// Como funciona (tudo roda no navegador, de graça):
// 1. Normalização: minúsculas, sem acentos, gírias e abreviações viram palavras comuns.
// 2. Vetorização: cada frase vira um vetor esparso de 16.384 dimensões (palavras, pares de
//    palavras e pedaços de 3 e 4 letras), com peso TF-IDF e normalização L2.
// 3. Classificador: regressão logística multinomial (softmax) treinada por gradiente
//    descendente estocástico com regularização L2.
// 4. Memória: vizinhos mais próximos por similaridade de cosseno sobre os exemplos que ela
//    aprendeu com o uso (vale na hora, sem precisar treinar de novo).
// 5. Entidades: nomes de servidores, canais e pessoas são achados por similaridade
//    Jaro-Winkler, tolerando erros do reconhecimento de voz.

import { INTENTS, seedExamples, type Intent } from './dataset'

const DIM = 1 << 14
const K = INTENTS.length
const intentIndex = new Map(INTENTS.map((x, i) => [x, i]))

// ------------------------------------------------------------------ texto
/** Minúsculas sem acento, mantendo a mesma posição de cada letra do texto original. */
export function fold(text: string): string {
  let out = ''
  for (const ch of text.toLowerCase()) out += ch.normalize('NFD')[0] ?? ch
  return out
}

const SLANG: [RegExp, string][] = [
  [/\bvc\b|\bvoce\b|\bce\b/g, 'voce'], [/\bq\b/g, 'que'], [/\bpq\b/g, 'porque'], [/\btb\b|\btbm\b/g, 'tambem'],
  [/\bpfv\b|\bpls\b|\bplz\b|\bpor gentileza\b|\bpor favorzinho\b/g, 'por favor'], [/\bmsg\b/g, 'mensagem'], [/\bserver\b|\bsv\b/g, 'servidor'],
  [/\bcall\b|\bligacao\b/g, 'chamada'], [/\bmic\b/g, 'microfone'], [/\bcam\b|\bwebcam\b/g, 'camera'], [/\badd\b/g, 'adiciona'],
  [/\bdm\b|\bpv\b|\bprivado\b/g, 'conversa privada'], [/\bstatus\b/g, 'status'], [/\bon\b/g, 'online'], [/\bpra\b|\bpro\b|\bpras\b|\bpros\b/g, 'para'],
  [/\bta\b/g, 'esta'], [/\bto\b/g, 'estou'], [/\bne\b/g, 'nao e'], [/\bmutar\b|\bmuta\b/g, 'mutar'], [/\bdesmuta\b|\bdesmutar\b/g, 'desmutar'],
  [/\bkk+\b|\bhaha+\b|\brs+\b/g, 'risada'],
]

/** Tira a palavra de chamada ("Prisma") e vícios de fala que não mudam o pedido. */
export function clean(text: string): string {
  let t = fold(text).replace(/[^\p{L}\p{N}@#._'"\s-]/gu, ' ')
  t = t.replace(/\b(ei|hey|oi|ola|e ai)\s+prisma\b/g, ' ').replace(/\bpri[sz]ma\b/g, ' ')
  for (const [rx, to] of SLANG) t = t.replace(rx, to)
  t = t.replace(FILLER, ' ').replace(FILLER_END, '')
  t = t.replace(FORMAL, (w) => FORMAL_MAP[w] || w).replace(/\bentre (no|na|nos|nas|em)\b/g, 'entra $1')
  return t.replace(/\s+/g, ' ').trim()
}

// imperativo formal → o jeito falado com que ela foi treinada ("crie" → "cria")
const FORMAL_MAP: Record<string, string> = {
  crie: 'cria', criem: 'cria', adicione: 'adiciona', mande: 'manda', envie: 'envia', coloque: 'coloca', bote: 'bota', apague: 'apaga', abra: 'abre',
  mude: 'muda', troque: 'troca', ligue: 'liga', desligue: 'desliga', saia: 'sai', faca: 'faz', tire: 'tira', mostre: 'mostra', delete: 'deleta',
  remova: 'remove', aceite: 'aceita', recuse: 'recusa', compartilhe: 'compartilha', transmita: 'transmite', silencie: 'silencia', ative: 'ativa',
  desative: 'desativa', renomeie: 'renomeia', fixe: 'fixa', edite: 'edita', procure: 'procura', pesquise: 'pesquisa', busque: 'busca', resuma: 'resume',
  convide: 'convida', expulse: 'expulsa', promova: 'promove', chame: 'chama', escreva: 'escreve', diga: 'diz', fale: 'fala', leve: 'leva', va: 'vai',
  volte: 'volta', reaja: 'reage', defina: 'define', deixe: 'deixa', monte: 'monta', gere: 'gera', copie: 'copia', desmute: 'desmuta', mute: 'muta',
}
const FORMAL = new RegExp(`\\b(${Object.keys(FORMAL_MAP).join('|')})\\b`, 'g')

// educação e enchimento não mudam o pedido ("crie um chat novo pra mim, por favor")
const FILLER = /\b(por favor|porfavor|por gentileza|faz favor|se puder|se possivel|pfvr?|pls|plz|rapidinho|ai pra mim)\b/g
const FILLER_END = /\s+(pra|para) (mim|gente|nois|nos)\s*$/
/** Tira o enchimento do fim da frase antes de extrair nomes e textos. */
export function trimFiller(raw: string): string {
  return raw.replace(/[\s,.!]*\b(por favor|porfavor|por gentileza|faz favor|se puder|pfvr?|pls|plz|rapidinho)\b[\s,.!?]*$/i, '')
    .replace(/[\s,]+(pra|para) (mim|gente|nós|nois)[\s,.!?]*$/i, '').trim()
}

const WAKE = /\b(pri[sz]ma|prysma|brisma|prisma's)\b/i
/** A frase chama a Prisma? (no começo ou no meio). Devolve o pedido sem a palavra de chamada. */
export function wake(text: string): { called: boolean; request: string } {
  const f = fold(text)
  const m = WAKE.exec(f)
  if (!m) return { called: false, request: text }
  const after = text.slice(m.index + m[0].length).replace(/^[\s,.:!?-]+/, '')
  const before = text.slice(0, m.index).replace(/[\s,.:!?-]+$/, '')
  // "Prisma, cria um servidor" → depois; "cria um servidor, Prisma" → antes
  const request = after.trim().length >= 2 ? after : before
  return { called: true, request: request.trim() }
}

// ------------------------------------------------------------------ vetores
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) & (DIM - 1)
}
const STOP = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'e', 'por', 'favor', 'mim', 'ai', 'mano', 'mana', 'ne', 'tipo', 'la', 'aqui', 'me', 'eu'])

function terms(text: string): string[] {
  const words = clean(text).split(' ').filter(Boolean)
  const out: string[] = []
  const content = words.filter((w) => !STOP.has(w))
  for (const w of content) {
    out.push(`w:${w}`)
    const p = `^${w}$`
    for (let n = 3; n <= 4; n++) for (let i = 0; i + n <= p.length; i++) out.push(`c:${p.slice(i, i + n)}`)
  }
  for (let i = 0; i + 1 < content.length; i++) out.push(`b:${content[i]}_${content[i + 1]}`)
  if (!content.length) for (const w of words) out.push(`w:${w}`)
  return out
}

export type Vec = { idx: Int32Array; val: Float32Array }

export class Brain {
  private idf = new Float32Array(DIM).fill(1)
  private W = new Float32Array(K * DIM)
  private b = new Float32Array(K)
  private memory: { vec: Vec; intent: Intent; text: string }[] = []
  ready = false

  vectorize(text: string): Vec {
    const counts = new Map<number, number>()
    for (const t of terms(text)) { const h = hash(t); counts.set(h, (counts.get(h) || 0) + 1) }
    const idx = new Int32Array(counts.size)
    const val = new Float32Array(counts.size)
    let i = 0, norm = 0
    for (const [h, c] of counts) { idx[i] = h; val[i] = (1 + Math.log(c)) * this.idf[h]; norm += val[i] * val[i]; i++ }
    norm = Math.sqrt(norm) || 1
    for (let j = 0; j < val.length; j++) val[j] /= norm
    return { idx, val }
  }

  /** Treina o classificador. Cede a vez ao navegador entre as épocas para não travar a tela. */
  async train(extra: { text: string; intent: Intent }[] = [], epochs = 22) {
    const data = [...seedExamples(), ...extra]
    // IDF
    const df = new Float32Array(DIM)
    for (const d of data) { const seen = new Set(terms(d.text).map(hash)); for (const h of seen) df[h]++ }
    for (let h = 0; h < DIM; h++) this.idf[h] = Math.log((1 + data.length) / (1 + df[h])) + 1
    const X = data.map((d) => this.vectorize(d.text))
    const y = data.map((d) => intentIndex.get(d.intent)!)
    this.W.fill(0); this.b.fill(0)
    const scores = new Float32Array(K)
    const order = data.map((_, i) => i)
    const lambda = 1e-5
    for (let ep = 0; ep < epochs; ep++) {
      const lr = 0.9 / (1 + ep * 0.15)
      for (let i = order.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]] }
      for (const n of order) {
        const v = X[n]
        let max = -Infinity
        for (let k = 0; k < K; k++) {
          let s = this.b[k]
          const off = k * DIM
          for (let j = 0; j < v.idx.length; j++) s += this.W[off + v.idx[j]] * v.val[j]
          scores[k] = s; if (s > max) max = s
        }
        let sum = 0
        for (let k = 0; k < K; k++) { scores[k] = Math.exp(scores[k] - max); sum += scores[k] }
        for (let k = 0; k < K; k++) {
          const g = scores[k] / sum - (k === y[n] ? 1 : 0)
          if (Math.abs(g) < 1e-4) continue
          const off = k * DIM
          for (let j = 0; j < v.idx.length; j++) {
            const p = off + v.idx[j]
            this.W[p] -= lr * (g * v.val[j] + lambda * this.W[p])
          }
          this.b[k] -= lr * g * 0.1
        }
      }
      if (typeof window !== 'undefined') await new Promise((r) => setTimeout(r, 0))
    }
    this.memory = this.memory.map((m) => ({ ...m, vec: this.vectorize(m.text) }))
    this.ready = true
  }

  probs(v: Vec): Float32Array {
    const out = new Float32Array(K)
    let max = -Infinity
    for (let k = 0; k < K; k++) {
      let s = this.b[k]
      const off = k * DIM
      for (let j = 0; j < v.idx.length; j++) s += this.W[off + v.idx[j]] * v.val[j]
      out[k] = s; if (s > max) max = s
    }
    let sum = 0
    for (let k = 0; k < K; k++) { out[k] = Math.exp(out[k] - max); sum += out[k] }
    for (let k = 0; k < K; k++) out[k] /= sum
    return out
  }

  static cosine(a: Vec, b: Vec): number {
    let i = 0, j = 0, s = 0
    // os índices não estão ordenados: usa um mapa pequeno
    const m = new Map<number, number>()
    for (; i < a.idx.length; i++) m.set(a.idx[i], a.val[i])
    for (; j < b.idx.length; j++) { const x = m.get(b.idx[j]); if (x) s += x * b.val[j] }
    return s
  }

  /** Classifica uma frase. */
  classify(text: string): { intent: Intent; confidence: number; margin: number; source: 'model' | 'memory'; top: [Intent, number][] } {
    const v = this.vectorize(text)
    const p = this.probs(v)
    const ranked = [...p].map((x, i) => [INTENTS[i], x] as [Intent, number]).sort((a, b) => b[1] - a[1])
    let best = { sim: 0, intent: ranked[0][0] }
    for (const m of this.memory) { const sim = Brain.cosine(v, m.vec); if (sim > best.sim) best = { sim, intent: m.intent } }
    if (best.sim >= 0.86) return { intent: best.intent, confidence: best.sim, margin: 1, source: 'memory', top: ranked.slice(0, 3) }
    return { intent: ranked[0][0], confidence: ranked[0][1], margin: ranked[0][1] - ranked[1][1], source: 'model', top: ranked.slice(0, 3) }
  }

  /** Aprende um exemplo novo: vale na hora pela memória e entra no próximo treino. */
  learn(text: string, intent: Intent) {
    if (!intentIndex.has(intent) || clean(text).length < 2) return
    const existing = this.memory.findIndex((m) => clean(m.text) === clean(text))
    if (existing >= 0) this.memory.splice(existing, 1)
    this.memory.push({ text, intent, vec: this.vectorize(text) })
    if (this.memory.length > 800) this.memory.shift()
    // ajuste rápido do classificador com esse exemplo (um passo de gradiente)
    const v = this.vectorize(text)
    const p = this.probs(v)
    const y = intentIndex.get(intent)!
    for (let k = 0; k < K; k++) {
      const g = p[k] - (k === y ? 1 : 0)
      const off = k * DIM
      for (let j = 0; j < v.idx.length; j++) this.W[off + v.idx[j]] -= 0.6 * g * v.val[j]
    }
  }
  forget() { this.memory.length = 0 }
  /** Pesos treinados (para treinar num Worker e trazer para a página). */
  weights() { return { W: this.W, b: this.b, idf: this.idf } }
  adopt(w: { W: Float32Array<ArrayBuffer>; b: Float32Array<ArrayBuffer>; idf: Float32Array<ArrayBuffer> }) {
    if (w.W.length !== this.W.length || w.b.length !== this.b.length) return false
    this.W = w.W; this.b = w.b; this.idf = w.idf
    this.memory = this.memory.map((m) => ({ ...m, vec: this.vectorize(m.text) }))
    this.ready = true
    return true
  }
  memories() { return this.memory.map((m) => ({ text: m.text, intent: m.intent })) }
  load(list: { text: string; intent: Intent }[]) { for (const x of list) if (intentIndex.has(x.intent)) this.memory.push({ ...x, vec: this.vectorize(x.text) }) }
}

// ------------------------------------------------------------------ entidades e campos
export interface World {
  servers: { id: string; name: string }[]
  channels: { id: string; name: string; serverId: string | null; kind: string }[]
  users: { id: string; username: string; display: string }[]
  currentServerId: string | null
  currentChannelId: string | null
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue
      am[i] = bm[j] = true; matches++; break
    }
  }
  if (!matches) return 0
  let t = 0, k = 0
  for (let i = 0; i < a.length; i++) { if (!am[i]) continue; while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++ }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

const tokens = (s: string) => fold(s).replace(/[^\p{L}\p{N}@._\s-]/gu, ' ').split(/[\s-]+/).filter(Boolean)

/** Procura no texto o candidato mais parecido. Devolve também onde ele aparece. */
export function findEntity<T>(text: string, list: T[], names: (x: T) => string[], min = 0.86): { item: T; score: number; start: number; end: number } | null {
  const words = tokens(text)
  let best: { item: T; score: number; start: number; end: number } | null = null
  for (const item of list) {
    for (const name of names(item)) {
      const nt = tokens(name)
      if (!nt.length) continue
      const target = nt.join(' ')
      for (let len = Math.max(1, nt.length - 1); len <= nt.length + 1; len++) {
        for (let i = 0; i + len <= words.length; i++) {
          const span = words.slice(i, i + len).join(' ')
          let score = span === target ? 1.02 : jaroWinkler(span, target)
          if (len !== nt.length) score -= 0.04
          if (target.length <= 3 && span !== target) score -= 0.2
          if (score >= min && (!best || score > best.score)) best = { item, score, start: i, end: i + len }
        }
      }
    }
  }
  return best
}

export interface Slots {
  name?: string; text?: string; code?: string; username?: string
  serverId?: string; channelId?: string; userId?: string; userIds?: string[]
  status?: 'online' | 'idle' | 'dnd' | 'invisible'; color?: string; emoji?: string; kind?: 'text' | 'voice'
  quality?: '2160' | '1440' | '1080' | '720' | 'source'; tab?: string; level?: 'full' | 'reduced'
}

const FILLERS = /\b(por favor|pfv|pra mim|para mim|ai|agora|mano|mana|rapidinho|urgente|obrigad[oa])\b/g
const tidy = (s: string) => s.replace(FILLERS, ' ').replace(/^[\s,.:;'"-]+|[\s,.:;'"!?-]+$/g, '').replace(/\s+/g, ' ').trim()

function quoted(raw: string): string | null {
  const m = /["“”'‘’«»]([^"“”'‘’«»]{1,200})["“”'‘’«»]/.exec(raw)
  return m ? m[1].trim() : null
}

/** Texto depois de uma palavra-gatilho, mantendo acentos e maiúsculas do original. */
function after(raw: string, cue: RegExp): string | null {
  const f = fold(raw)
  const m = cue.exec(f)
  if (!m) return null
  const rest = raw.slice(m.index + m[0].length)
  const t = tidy(rest)
  return t || null
}

const COLORS: Record<string, string> = {
  jade: '#00A86B', verde: '#3DDBA4', 'verde agua': '#3DDBA4', ciano: '#2BB8C9', azul: '#4C8DF6', roxo: '#9B7BFF', lilas: '#9B7BFF', violeta: '#9B7BFF',
  rosa: '#E35BC2', pink: '#E35BC2', vermelho: '#F0565B', vermelha: '#F0565B', laranja: '#F2A33B', amarelo: '#F2C94C', amarela: '#F2C94C', branco: '#F5F8F6', branca: '#F5F8F6',
}
const EMOJI: [RegExp, string][] = [
  [/joinha|like|positivo|legal/, '👍'], [/coracao|amor|love/, '❤️'], [/risada|rindo|kk|haha|engracad/, '😂'], [/fogo|brabo|insano/, '🔥'],
  [/triste|chorando|chorar/, '😢'], [/uau|surpres|choc/, '😮'], [/caveira|morri/, '💀'], [/olhinho|olhos/, '👀'], [/palmas|aplau/, '👏'], [/festa|comemor/, '🎉'],
]

/** Extrai os campos que cada pedido precisa. */
export function extractSlots(intent: Intent, rawInput: string, world: World): Slots {
  const raw = trimFiller(trimFiller(rawInput))
  const s: Slots = {}
  const f = fold(raw)
  const q = quoted(raw)
  const serverHit = findEntity(raw, world.servers, (x) => [x.name])
  const chanList = world.channels.filter((c) => c.serverId && (!world.currentServerId || c.serverId === world.currentServerId))
  const chanHit = findEntity(raw, chanList, (x) => [x.name, x.name.replace(/-/g, ' ')])
  const personNames = (x: World['users'][number]) => [x.display, x.username, x.username.replace(/[._]/g, ' '), ...(x.display.split(' ')[0].length >= 3 ? [x.display.split(' ')[0]] : [])]
  const userHit = findEntity(raw, world.users, personNames, 0.88)
  if (serverHit) s.serverId = serverHit.item.id
  if (chanHit) s.channelId = chanHit.item.id
  if (userHit) s.userId = userHit.item.id
  // "entra no Cinema": se o canal citado é de voz, é para entrar na chamada
  if (chanHit && chanHit.item.kind === 'voice' && intent === 'open_channel') s.kind = 'voice'

  const nameCue = /\b(chamad[oa]s?|com o nome de|com o nome|com nome de|de nome|nome de|que se chama|nomead[oa]|pra se chamar|para se chamar|nome para|nome pra|como)\s+/
  switch (intent) {
    case 'create_server': case 'rename_server': case 'set_display_name': case 'add_emoji':
    case 'create_channel': case 'rename_channel': {
      let n = q || after(raw, nameCue)
      if (!n && (intent === 'rename_server' || intent === 'rename_channel' || intent === 'set_display_name')) n = after(raw, /\b(para|pra|de)\s+(?!o nome|mim)/)
      if (!n && intent === 'create_server') n = after(raw, /\b(servidor|server)\s+(?!novo|pra|para|por|com)/)
      if (!n && intent === 'create_channel') n = after(raw, /\b(canal|chat|sala)\s+(de\s+(voz|audio|texto)\s+)?(?!novo|pra|para|por)/)
      if (!n && intent === 'set_display_name') n = after(raw, /\b(me chamar|me chama de|me chama|meu nome agora e|meu nome e)\s+/)
      if (n) s.name = n.replace(/^(de|o|a)\s+/i, '').slice(0, 60)
      if (intent === 'create_channel') s.kind = /\b(voz|audio|call|chamada|ligacao)\b/.test(clean(raw)) ? 'voice' : 'text'
      break
    }
    case 'join_server': {
      const m = /(?:invite\/|convite\s+(?:e\s+)?|codigo\s+(?:e\s+)?)([a-z0-9]{6,12})\b/i.exec(f) || /\b([a-z0-9]{10})\b/.exec(f)
      if (m) s.code = m[1]
      break
    }
    case 'set_topic': case 'set_bio': case 'set_custom_status': case 'edit_last': case 'search': {
      const cues: Record<string, RegExp> = {
        set_topic: /\b(topico|assunto|descricao)( do canal)?( para| pra| de|:)?\s+/,
        set_bio: /\b(bio|sobre mim|descricao)( do (meu )?perfil)?( para| pra|:)?\s+/,
        set_custom_status: /\b(status( personalizado)?|recado)( para| pra| que|:)?\s+/,
        edit_last: /\b(para|pra|por)\s+/,
        search: /\b(procura|pesquisa|busca|acha|procurar|buscar|pesquisar)( a mensagem que falava de| mensagens sobre| por| sobre)?\s+/,
      }
      const t = q || after(raw, cues[intent])
      if (t) s.text = t.replace(/\s+no canal$/i, '').slice(0, 300)
      break
    }
    case 'send_message': {
      // destino: canal ou pessoa depois de "no/na/pro/pra/para"
      let rest = raw
      const target = (chanHit && /\b(no|na|pro|pra|para o|para a|em|ao)\s*(canal\s+)?$/.test(fold(raw.slice(0, indexOfTokens(raw, chanHit.start))).trimEnd() + ' ') ? chanHit : null)
      const person = userHit && (!target || userHit.score >= (target?.score ?? 0)) ? userHit : null
      if (person && /\b(pro|pra|para|ao|a|o|com)\s*$/.test(fold(raw.slice(0, indexOfTokens(raw, person.start))))) { s.userId = person.item.id; delete s.channelId; rest = cutTokens(raw, person.start, person.end) }
      else if (target) { s.channelId = target.item.id; delete s.userId; rest = cutTokens(raw, target.start, target.end) }
      else { delete s.userId; delete s.channelId }
      const t = q || tidy(fold(rest)
        .replace(/^.*?\b(manda(r)?|envia(r)?|escreve(r)?|posta(r)?|fala(r)?|avisa(r)?|diz(er)?|responde(r)?)\b\s*(uma\s+)?(mensagem\s+)?/, '')
        .replace(/\b(no|na|pro|pra|para o|para a|para|em|ao)\s*(canal|chat|privado)?\s*$/g, ' ')
        .replace(/^(no|na|pro|pra|para|ao)\s+(o|a)?\s*(canal|chat)?\s*/, '')
        .replace(/^(dizendo|falando|escrevendo|que|com)\s+/, '')
        .replace(/\s+(dizendo|falando|escrevendo)\s*$/, ''))
      if (t) s.text = restoreCase(raw, t)
      break
    }
    case 'friend_request': case 'accept_friend': case 'decline_friend': case 'remove_friend': case 'open_dm': case 'call_user':
    case 'open_profile': case 'kick_member': case 'promote_member': case 'demote_member': {
      const at = /@([a-z0-9_.]{3,20})/.exec(f)
      if (at) s.username = at[1]
      else if (!userHit && intent === 'friend_request') {
        const m = /\b(?:adiciona(?:r)?|add|amizade\s+(?:para|pra|pro)|usuario|amigo)\s+(?:o |a |os |as |usuario |user )?([a-z0-9 ._]{3,40})$/.exec(clean(raw).replace(/\b(como amigo|nos amigos|na lista|de amizade)\b/g, '').trim())
        if (m) s.username = spokenUsername(m[1].replace(/^(o |a )?(usuario|user|nome)\s+/, ''))
      }
      break
    }
    case 'create_group': {
      const ids: string[] = []
      let rest = raw
      for (let i = 0; i < 9; i++) {
        const hit = findEntity(rest, world.users.filter((u) => !ids.includes(u.id)), personNames, 0.88)
        if (!hit) break
        ids.push(hit.item.id); rest = cutTokens(rest, hit.start, hit.end)
      }
      if (ids.length) s.userIds = ids
      const n = q || after(raw, nameCue)
      if (n) s.name = n
      break
    }
    case 'set_status': {
      const c = clean(raw)
      s.status = /invisivel|offline|desconectad/.test(c) ? 'invisible' : /nao perturbe|ocupad|dnd|nao incomod/.test(c) ? 'dnd' : /ausente|afk|idle/.test(c) ? 'idle' : 'online'
      break
    }
    case 'set_color': {
      const c = clean(raw)
      for (const [k, v] of Object.entries(COLORS)) if (new RegExp(`\\b${k}\\b`).test(c)) s.color = v
      const hex = /#([0-9a-f]{6})\b/i.exec(raw)
      if (hex) s.color = `#${hex[1]}`
      break
    }
    case 'react_last': {
      const e = /\p{Extended_Pictographic}/u.exec(raw)
      if (e) s.emoji = e[0]
      else for (const [rx, em] of EMOJI) if (rx.test(clean(raw))) { s.emoji = em; break }
      break
    }
    case 'share_screen': {
      const c = clean(raw)
      s.quality = /4\s?k|2160/.test(c) ? '2160' : /1440|2k/.test(c) ? '1440' : /1080|full ?hd/.test(c) ? '1080' : /720/.test(c) ? '720' : undefined
      break
    }
    case 'open_settings': {
      const c = clean(raw)
      s.tab = /senha|conta|logout/.test(c) ? 'conta' : /voz|microfone|audio/.test(c) ? 'voz' : /notifica|aviso|som/.test(c) ? 'avisos' : /anima/.test(c) ? 'visual' : /prisma|assistente/.test(c) ? 'prisma' : 'perfil'
      break
    }
    case 'set_animations': s.level = /(diminui|reduz|tira|menos|sem|desliga)/.test(clean(raw)) ? 'reduced' : 'full'; break
    case 'open_friends': {
      const c = clean(raw)
      s.tab = /pedido|pendente|adicionou|solicita/.test(c) ? 'pending' : /online|disponive/.test(c) ? 'online' : 'all'
      break
    }
  }
  return s
}

/** Converte "beto ponto lima" em "beto.lima", "mari underline 22" em "mari_22". */
export function spokenUsername(s: string): string {
  return fold(s).replace(/\s*(ponto|dot)\s*/g, '.').replace(/\s*(underline|underscore|traco baixo|sublinhado)\s*/g, '_').replace(/\s+/g, '').replace(/[^a-z0-9_.]/g, '').slice(0, 20)
}

// índices de palavras → posição no texto original
function wordSpans(raw: string): [number, number][] {
  const out: [number, number][] = []
  const rx = /[\p{L}\p{N}@._]+/gu
  let m
  while ((m = rx.exec(raw))) out.push([m.index, m.index + m[0].length])
  return out
}
function indexOfTokens(raw: string, start: number): number { return wordSpans(raw)[start]?.[0] ?? raw.length }
function cutTokens(raw: string, start: number, end: number): string {
  const spans = wordSpans(raw)
  const a = spans[start]?.[0] ?? raw.length, b = spans[end - 1]?.[1] ?? raw.length
  return (raw.slice(0, a) + ' ' + raw.slice(b)).replace(/\s+/g, ' ')
}
/** Recupera acentos e maiúsculas do texto original para um trecho normalizado. */
function restoreCase(raw: string, foldedPiece: string): string {
  const f = fold(raw)
  const i = f.indexOf(foldedPiece)
  return i >= 0 ? raw.slice(i, i + foldedPiece.length) : foldedPiece
}
