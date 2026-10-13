// Jeito de falar da Prisma nas respostas que ela dá sozinha (sem a IA da nuvem).
// Gírias com moderação: no máximo uma por frase, sempre no sentido certo.

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]

export interface Who { name: string; pronoun?: 'ele' | 'ela' | null }
const first = (w: Who) => w.name.split(' ')[0] || w.name
const o = (w: Who, ele: string, ela: string) => (w.pronoun === 'ela' ? ela : ele)

/** Saudação pelo horário de Brasília. */
export function brasiliaGreeting(date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(date)) % 24
  if (hour >= 5 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function welcome(w: Who): string {
  return `${brasiliaGreeting()}, seja ${o(w, 'bem-vindo', 'bem-vinda')}, ${first(w)}. Aproveite o Krata.`
}

export const say = {
  greet: (w: Who) => pick([`${brasiliaGreeting()}, ${first(w)}! Bora, o que manda?`, `Eae, ${first(w)}! Fala comigo.`, `Salve, ${first(w)}! Tô on, pode pedir.`, `Opa! Qual vai ser hoje?`]),
  thanks: () => pick(['Tmj!', 'De nada, é nóis.', 'Disponha! Qualquer coisa só chamar.', 'Imagina, W pedido.']),
  howAreYou: (w: Who) => pick([`Tô de boa e cheia de energia, ${first(w)}. E tu?`, 'De boa demais! Pronta pra rushar o que você pedir.', 'Suave na nave. Bora fazer alguma coisa?']),
  whoAmI: () => pick(['Sou a Prisma, a assistente do Krata. Crio servidor, mando mensagem, troco tua foto, entro na call… é só pedir começando com "Prisma".', 'Prisma, prazer! Eu cuido do Krata pra você: é só falar "Prisma" e pedir.']),
  help: () => 'Posso criar e apagar servidores e canais, mandar mensagens, adicionar amigos, convidar a galera pro servidor, trocar tua foto, nome e status, entrar na call, mutar, compartilhar a tela em 4K, resumir o chat e trocar ideia sobre qualquer coisa. É só falar "Prisma" e pedir.',
  time: () => {
    const d = new Date()
    const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d)
    const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' }).format(d)
    return `São ${hora}, ${dia}.`
  },
  ok: () => pick(['Feito!', 'Prontinho.', 'Já era, feito.', 'Tá na mão!', 'Fechou, feito.']),
  cancel: () => pick(['Beleza, deixei quieto.', 'Suave, cancelei.', 'Ok, esquece então.']),
  notUnderstood: () => pick(['Não manjei esse, mano. Fala de outro jeito?', 'Hmm, não peguei. Repete com outras palavras?', 'Esse eu não entendi, real. Tenta de novo?']),
  noPermission: () => pick(['Aí só o dono ou um admin do servidor consegue, papo reto.', 'Sem permissão pra isso nesse servidor, mano.']),
  needServer: () => 'Abre um servidor primeiro, aí eu consigo.',
  limit: () => 'Bati meu limite de papo de hoje com a nuvem. Comandos eu continuo fazendo de boa, e amanhã volto com tudo.',
  offline: () => 'Minha parte de conversa ainda não foi ligada no servidor. Comandos do app eu faço normal.',
  netError: () => 'Deu ruim na conexão aqui. Tenta de novo em um segundo?',

  askServerName: () => pick(['Qual vai ser o nome do servidor?', 'Bora! Que nome eu coloco no servidor?']),
  serverCreated: (n: string) => pick([`Servidor ${n} criado. Brabíssimo!`, `Pronto, ${n} tá no ar.`, `Feito! ${n} criado, agora é só chamar a galera.`]),
  joined: (n: string) => `Entrei no ${n}.`,
  left: (n: string) => `Saí do ${n}.`,
  deleted: (n: string) => `${n} apagado.`,
  confirmDelete: (n: string) => `Certeza que quer apagar ${n}? Não dá pra desfazer.`,
  askChannelName: () => 'Qual o nome do canal?',
  channelCreated: (n: string, voice: boolean) => `Canal ${voice ? 'de voz ' : ''}${n} criado!`,
  invitesSent: (server: string, names: string[]) => `Prontinho, mandei o convite do ${server} no privado ${names.length > 1 ? 'de' : 'de'} ${names.length <= 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`}. É só clicar em Entrar.`,
  inviteCopied: () => 'Copiei o link do convite. É só colar pra galera.',
  inviteShown: () => 'Tá aqui o link do convite.',
  opened: (n: string) => pick([`Abrindo ${n}.`, `Bora pro ${n}.`, `Tô te levando pro ${n}.`]),
  home: () => 'Voltei pro início.',
  sent: (where: string) => pick([`Mandei no ${where}.`, `Enviado no ${where}!`, `Feito, mensagem no ${where}.`]),
  askMessage: () => 'O que eu escrevo?',
  askUser: () => 'Pra quem? Me fala o nome de usuário.',
  friendSent: (n: string) => pick([`Pedido de amizade enviado pra ${n}!`, `Mandei o add pro ${n}.`]),
  friendAccepted: (n: string) => `Agora você e ${n} são amigos!`,
  friendDeclined: () => 'Pedido recusado.',
  friendRemoved: (n: string) => `${n} saiu da tua lista de amigos.`,
  nobodyOnline: () => pick(['Ninguém on agora, lowkey tá tudo parado.', 'Tá todo mundo offline no momento.']),
  online: (names: string[]) => names.length === 1 ? `Só ${names[0]} tá on agora.` : `Tão on: ${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}.`,
  nameChanged: (n: string) => `Agora você é ${n}. Combinou!`,
  statusChanged: (label: string) => `Status: ${label}.`,
  colorChanged: () => 'Cor nova no perfil. Slay!',
  avatarPanel: () => 'Escolhe a foto nova aqui.',
  avatarDone: () => 'Foto trocada, ficou brabo!',
  bannerDone: () => 'Banner novo no ar!',
  iconDone: () => 'Ícone do servidor trocado.',
  whoami: (u: string) => `Teu usuário é @${u}.`,
  joinVoice: (n: string) => pick([`Bora, entrando em ${n}.`, `Entrando em ${n}.`]),
  leaveVoice: () => 'Saí da call.',
  notInVoice: () => 'Você não tá em nenhuma call agora.',
  muted: () => 'Microfone mutado.', unmuted: () => 'Mic ligado, pode falar.',
  deafened: () => 'Áudio da call desligado.', undeafened: () => 'Voltou a ouvir a call.',
  cameraOn: () => 'Câmera ligada.', cameraOff: () => 'Câmera desligada.',
  screenPanel: () => 'Toca no botão pra escolher o que compartilhar. O navegador exige esse toque.',
  screenStopped: () => 'Transmissão encerrada. GG!',
  noScreenShare: (ios: boolean) => `${ios ? 'O iPhone e o iPad não deixam nenhum site transmitir a tela' : 'Esse navegador não deixa transmitir a tela'}, real. No computador eu compartilho em 4K de boa.`,
  needVoice: () => 'Entra numa call primeiro, aí eu compartilho a tela.',
  calling: (n: string) => `Ligando pro ${n}.`,
  reacted: () => 'Reagi!', pinned: () => 'Mensagem fixada.', edited: () => 'Editei tua última mensagem.', noMessage: () => 'Não achei mensagem pra isso aqui.',
  unread: (n: number, dms: number) => n === 0 ? 'Nada novo, tá tudo lido.' : `Você tem ${n} ${n === 1 ? 'mensagem nova' : 'mensagens novas'}${dms ? `, ${dms} no privado` : ''}.`,
  settings: () => 'Abrindo as configurações.',
  sounds: (on: boolean) => on ? 'Sons ligados.' : 'Sons desligados.',
  animations: (full: boolean) => full ? 'Animações completas, do jeito que tem que ser.' : 'Animações mais calmas agora.',
  stopListening: () => 'Beleza, parei de ouvir. Quando quiser, toca no meu botão.',
  kicked: (n: string) => `${n} foi expulso do servidor.`,
  promoted: (n: string) => `${n} agora é admin.`, demoted: (n: string) => `${n} voltou a ser membro.`,
  emojiPanel: () => 'Manda a imagem do emoji aqui.',
  searchOpened: (q: string) => `Procurando "${q}".`,
  summaryEmpty: () => 'Não tem mensagem pra resumir aqui.',
  confirmQuestion: (what: string) => `Você quer que eu ${what}?`,
  heard: () => pick(['Fala!', 'Oi?', 'Tô ouvindo.', 'Pode falar.']),
}

export const STATUS_LABEL: Record<string, string> = { online: 'disponível', idle: 'ausente', dnd: 'não perturbe', invisible: 'invisível' }

/** Remove marcação e emojis antes de falar em voz alta. */
export function speakable(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_~`|#>]/g, '').replace(/<:[a-z0-9_]+:[0-9a-f-]+>/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '').replace(/https?:\/\/\S+/g, 'o link').replace(/\s+/g, ' ').trim()
}
