// Exemplos de treino do cérebro local da Prisma.
// Cada intenção tem frases variadas (formais, gírias, erros comuns de reconhecimento de voz).
// O cérebro aprende novos exemplos sozinho com o uso; estes são só o ponto de partida.

export const INTENTS = [
  'greet', 'thanks', 'help', 'how_are_you', 'who_are_you', 'time_now', 'stop_listening', 'repeat', 'cancel', 'affirm', 'deny', 'chat',
  'create_server', 'join_server', 'leave_server', 'delete_server', 'rename_server', 'server_icon', 'invite_link', 'regenerate_invite', 'invite_users',
  'create_channel', 'delete_channel', 'rename_channel', 'set_topic',
  'open_server', 'open_channel', 'open_dm', 'go_home', 'open_friends', 'open_profile',
  'send_message', 'friend_request', 'accept_friend', 'decline_friend', 'remove_friend', 'online_friends', 'create_group',
  'set_display_name', 'set_bio', 'set_status', 'set_custom_status', 'clear_custom_status', 'set_color',
  'change_avatar', 'remove_avatar', 'change_banner', 'whoami',
  'join_voice', 'leave_voice', 'mute', 'unmute', 'deafen', 'undeafen', 'camera_on', 'camera_off', 'share_screen', 'stop_share', 'call_user',
  'react_last', 'pin_last', 'edit_last', 'delete_last', 'search', 'unread_summary', 'summarize_channel',
  'open_settings', 'set_animations', 'sounds_off', 'sounds_on', 'logout',
  'kick_member', 'promote_member', 'demote_member', 'add_emoji',
] as const
export type Intent = (typeof INTENTS)[number]

const S = ['clube do jade', 'os brabos', 'squad', 'galera do lol', 'familia']
const C = ['geral', 'memes', 'clips', 'avisos', 'musica']
const U = ['beto', 'ana', 'lucas', 'mari', 'joao']
const N = ['tropa do minecraft', 'rolê de sexta', 'estudos', 'valorant br', 'os cria']

export const SEED: Record<Intent, string[]> = {
  greet: ['oi', 'ola', 'e ai', 'eae', 'salve', 'bom dia', 'boa tarde', 'boa noite', 'opa', 'fala ai', 'oi tudo bem', 'oii', 'salve salve', 'eai mana', 'hello', 'hey'],
  thanks: ['obrigado', 'obrigada', 'valeu', 'vlw', 'brigado', 'muito obrigado', 'tmj', 'valeu mesmo', 'obg', 'agradecido', 'thanks', 'brigadão'],
  help: ['o que voce sabe fazer', 'quais comandos voce tem', 'me ajuda', 'como voce funciona', 'o que voce faz', 'lista de comandos', 'ajuda', 'quais sao suas funcoes', 'o que da pra pedir pra voce', 'me explica o que voce consegue fazer'],
  how_are_you: ['tudo bem com voce', 'como voce esta', 'como vai', 'de boa', 'ta bem', 'como ta o dia', 'beleza contigo', 'como voce ta se sentindo'],
  who_are_you: ['quem e voce', 'qual seu nome', 'voce e uma ia', 'voce e um robo', 'quem te criou', 'o que e a prisma', 'voce e real'],
  time_now: ['que horas sao', 'me fala as horas', 'que dia e hoje', 'qual a data de hoje', 'horas', 'que horas são agora'],
  stop_listening: ['para de ouvir', 'para de escutar', 'desliga o microfone da prisma', 'fica quieta', 'silencio prisma', 'para de me ouvir', 'desativa a escuta', 'nao me escuta mais'],
  repeat: ['repete', 'fala de novo', 'o que voce disse', 'repete por favor', 'nao entendi repete', 'como'],
  cancel: ['cancela', 'deixa pra la', 'esquece', 'nada nao', 'cancelar', 'para', 'nao quero mais', 'deixa quieto'],
  affirm: ['sim', 'pode', 'pode sim', 'claro', 'isso', 'confirma', 'confirmo', 'manda ver', 'bora', 'beleza pode', 'aham', 'isso mesmo', 'yes', 'certeza'],
  deny: ['nao', 'nao quero', 'negativo', 'nem', 'de jeito nenhum', 'nao obrigado', 'melhor nao', 'no'],
  chat: [
    'me conta uma piada', 'qual o melhor jogo do momento', 'o que voce acha de valorant', 'quem ganhou a copa de 2002', 'me recomenda um anime',
    'como faz bolo de cenoura', 'explica o que e buraco negro', 'qual a capital da australia', 'me da uma dica de build no lol', 'traduz bom dia pra ingles',
    'quanto e 15 vezes 37', 'me ajuda com minha licao de matematica', 'escreve um poema sobre jade', 'qual musica ta em alta', 'conta uma curiosidade',
    'voce gosta de minecraft', 'o que significa skill issue', 'me da uma ideia de nome pra time', 'qual a diferenca entre ssd e hd', 'fala alguma coisa engracada',
    'como eu subo de elo mais rapido', 'quem e o melhor jogador de cs', 'me explica a historia de zelda', 'por que o ceu e azul',
  ],
  create_server: [
    'cria um servidor', 'criar servidor', 'quero criar um servidor novo', 'faz um servidor pra mim', 'cria um server chamado {N}', 'cria um servidor com o nome {N}',
    'novo servidor', 'abre um servidor novo chamado {N}', 'monta um servidor', 'cria ai um server pros cria', 'bora criar um servidor', 'cria servidor {N}',
    'faz um server novo', 'quero um servidor chamado {N}', 'cria um grupo servidor', 'gera um servidor novo pra galera',
  ],
  join_server: ['entra no servidor com o convite {N}', 'entrar com convite', 'quero entrar num servidor', 'usa esse convite', 'tenho um convite', 'entra nesse link de convite', 'aceita o convite do servidor', 'entrar em servidor pelo codigo'],
  leave_server: ['sai do servidor {S}', 'quero sair desse servidor', 'sair do server', 'me tira do servidor {S}', 'larga esse servidor', 'sai desse server ai', 'deixar o servidor {S}'],
  delete_server: ['apaga o servidor {S}', 'deleta esse servidor', 'exclui o servidor', 'apagar server', 'deleta o server {S}', 'quero excluir meu servidor', 'remove o servidor {S}'],
  rename_server: ['muda o nome do servidor pra {N}', 'renomeia o servidor', 'troca o nome do server para {N}', 'coloca o nome do servidor de {N}', 'renomear servidor para {N}'],
  server_icon: ['troca o icone do servidor', 'muda a foto do servidor', 'coloca uma imagem no servidor', 'quero mudar o icone do server', 'nova foto pro servidor', 'altera o icone do servidor'],
  invite_link: ['me passa o convite', 'passa o link do convite', 'me manda o convite', 'me da o link de convite', 'copia o convite do servidor', 'qual o convite desse servidor', 'gera um convite', 'quero convidar uma pessoa', 'link pra chamar a galera', 'convite do server', 'manda o link do servidor'],
  invite_users: [
    'convida o {U} pro servidor', 'convida o {U} e a {U} para esse servidor', 'chama a {U} pro servidor', 'manda o convite do servidor pro {U}',
    'adiciona o {U} no servidor', 'coloca a {U} nesse server', 'traz o {U} pro {S}', 'convida {U} pro {S}', 'chama o {U} pra esse servidor',
    'envia convite pro {U} entrar no servidor', 'convida meus amigos pro servidor', 'convida o pessoal pro server', 'manda convite pra {U} e {U}',
    'convidar {U} para o servidor', 'bota o {U} aqui no servidor', 'convida a {U}',
  ],
  regenerate_invite: ['gera outro link de convite', 'faz outro convite', 'muda o link de convite', 'gera um novo link de convite', 'troca o convite', 'cria outro convite e cancela o antigo', 'reseta o link de convite', 'novo convite invalidando o antigo'],
  create_channel: [
    'cria um canal chamado {C}', 'cria um canal de texto {C}', 'novo canal {C}', 'cria um canal de voz chamado {C}', 'faz uma sala de voz', 'cria uma call nova',
    'adiciona um canal {C}', 'cria um chat chamado {C}', 'cria uma sala de audio', 'quero um canal novo', 'cria canal de voz {C}', 'cria um canal pra memes',
  ],
  delete_channel: ['apaga o canal {C}', 'deleta esse canal', 'exclui o canal {C}', 'remove o canal {C}', 'apagar canal', 'some com o canal {C}'],
  rename_channel: ['renomeia o canal pra {C}', 'muda o nome do canal para {C}', 'troca o nome desse canal pra {C}', 'renomear canal {C}'],
  set_topic: ['muda o assunto do canal pra {T}', 'coloca o topico {T}', 'define o assunto do canal', 'troca a descricao do canal pra {T}'],
  open_server: ['abre o servidor {S}', 'vai pro servidor {S}', 'vai pro servidor {S} ai', 'quero ir pro servidor {S}', 'me leva pro {S}', 'troca pro servidor {S}', 'volta pro servidor {S}', 'entra no {S}', 'me leva pro server {S}', 'mostra o servidor {S}', 'abre o {S}', 'vai pro server dos {S}'],
  open_channel: ['abre o canal {C}', 'vai pro canal {C}', 'me leva pro {C}', 'mostra o chat {C}', 'abre o chat de {C}', 'entra no canal {C}', 'vai pro {C}'],
  open_dm: ['abre a conversa com {U}', 'abre o chat do {U}', 'quero falar com {U}', 'vai pra dm do {U}', 'abre o privado da {U}', 'conversa com {U}', 'chama o {U} no privado', 'mensagem direta pro {U}'],
  go_home: ['volta pro inicio', 'vai pra tela inicial', 'home', 'volta pra home', 'tela principal', 'vai pro comeco', 'sai daqui volta pro inicio'],
  open_friends: ['abre os amigos', 'mostra meus amigos', 'lista de amigos', 'vai pra aba de amigos', 'mostra os pedidos de amizade', 'abre os pedidos pendentes', 'quem me adicionou'],
  open_profile: ['abre o perfil do {U}', 'mostra o perfil da {U}', 've o perfil do {U}', 'quem e o {U}', 'abre o meu perfil', 'mostra meu perfil'],
  send_message: [
    'manda {T} no {C}', 'fala pro {U} que {T}', 'manda uma mensagem pro {U} dizendo {T}', 'escreve {T} no canal {C}', 'envia {T}', 'manda no chat {T}',
    'avisa o {U} que {T}', 'diz pra {U} {T}', 'manda pro {U} {T}', 'manda mensagem no {C} falando {T}', 'posta no {C} {T}', 'responde {T}', 'escreve no chat {T}',
    'manda um oi pro {U}', 'manda bom dia no {C}', 'fala no geral que {T}',
  ],
  friend_request: [
    'adiciona o {U}', 'manda pedido de amizade pro {U}', 'adiciona {U} como amigo', 'quero adicionar o usuario {U}', 'envia solicitacao de amizade pra {U}',
    'add o {U}', 'adiciona a {U} nos amigos', 'pedido de amizade para {U}', 'me adiciona com o {U}', 'adicionar amigo {U}', 'manda add pro {U}',
  ],
  accept_friend: ['aceita o pedido do {U}', 'aceita a amizade', 'aceitar pedido de amizade', 'aceita o {U}', 'aceita todos os pedidos', 'aceita o pedido de amizade da {U}'],
  decline_friend: ['recusa o pedido do {U}', 'recusa a amizade', 'nao aceita o pedido da {U}', 'rejeita o pedido de amizade', 'recusar pedido'],
  remove_friend: ['remove o {U} dos amigos', 'desfaz amizade com {U}', 'tira a {U} da lista de amigos', 'exclui o {U} dos amigos', 'desamiga o {U}'],
  online_friends: ['quem ta online', 'quais amigos estao online', 'tem alguem online', 'quem esta disponivel', 'quem ta on', 'meus amigos online', 'tem alguem jogando'],
  create_group: ['cria um grupo com {U} e {U}', 'faz um grupo com a {U} e o {U}', 'cria um grupo de conversa', 'monta um grupo com meus amigos', 'grupo novo com {U}'],
  set_display_name: ['muda meu nome para {N}', 'troca meu nome de exibicao pra {N}', 'quero me chamar {N}', 'me chama de {N}', 'coloca meu nome como {N}', 'altera meu nome pra {N}', 'meu nome agora e {N}'],
  set_bio: ['muda minha bio pra {T}', 'coloca na minha bio {T}', 'atualiza meu sobre mim para {T}', 'troca a descricao do meu perfil', 'escreve na minha bio {T}'],
  set_status: ['me deixa invisivel', 'coloca nao perturbe', 'fica ausente', 'muda meu status pra ocupado', 'me coloca online', 'status disponivel', 'fica offline', 'modo nao perturbe', 'me deixa ausente', 'aparece online'],
  set_custom_status: ['coloca o status {T}', 'muda meu status personalizado para {T}', 'meu status agora e {T}', 'define o recado {T}', 'coloca no status que {T}'],
  clear_custom_status: ['tira meu status personalizado', 'limpa meu status', 'apaga o recado do status', 'remove meu status'],
  set_color: ['muda a cor do meu perfil pra azul', 'coloca meu perfil roxo', 'troca minha cor para rosa', 'cor do perfil vermelha', 'deixa meu perfil verde'],
  change_avatar: [
    'quero usar uma foto de perfil nova', 'troca minha foto de perfil', 'muda meu avatar', 'nova foto de perfil', 'quero mudar minha foto', 'coloca outra foto no meu perfil',
    'atualiza meu avatar', 'trocar foto', 'mudar a foto do perfil', 'bota uma foto nova em mim', 'quero trocar meu icone',
  ],
  remove_avatar: ['tira minha foto de perfil', 'remove meu avatar', 'apaga minha foto', 'fica sem foto'],
  change_banner: ['troca meu banner', 'muda o banner do perfil', 'coloca um banner novo', 'quero mudar a capa do meu perfil', 'novo banner'],
  whoami: ['qual meu nome de usuario', 'qual e o meu usuario', 'como eu me chamo aqui', 'qual meu arroba', 'qual o meu login'],
  join_voice: ['entra na call', 'entra na sala de voz', 'me coloca na call', 'entra no canal de voz {C}', 'bora pra call', 'conecta na voz', 'entra no {C} de voz', 'abre a call'],
  leave_voice: ['sai da chamada', 'para a chamada', 'desliga a call', 'sai da call', 'desliga a chamada', 'sai da sala de voz', 'desconecta da voz', 'encerra a ligacao', 'larga a call', 'quita da call'],
  mute: ['muta meu microfone', 'muta meu mic', 'me muta', 'silencia meu microfone', 'desliga meu microfone', 'muta o mic', 'fica no mute', 'mutar', 'corta meu audio'],
  unmute: ['desmuta', 'liga meu microfone', 'tira o mute', 'ativa o mic', 'desmutar', 'volta meu microfone'],
  deafen: ['para de ouvir a call', 'ensurdece', 'desliga o audio da call', 'nao quero ouvir ninguem', 'desliga o fone', 'muta todo mundo pra mim'],
  undeafen: ['volta a ouvir', 'liga o audio da call', 'quero ouvir de novo', 'tira o ensurdecer', 'liga o fone'],
  camera_on: ['liga minha camera', 'abre a camera', 'ativa a webcam', 'liga a cam', 'mostra minha camera'],
  camera_off: ['para a camera', 'para de me filmar', 'desliga minha camera', 'fecha a camera', 'desativa a webcam', 'desliga a cam', 'tira a camera'],
  share_screen: ['compartilha minha tela', 'transmite minha tela', 'quero compartilhar a tela', 'faz live da minha tela', 'compartilhar tela em 4k', 'streama minha tela', 'mostra minha tela pra galera', 'abre a transmissao'],
  stop_share: ['para de compartilhar a tela', 'parar de compartilhar minha tela', 'para de transmitir', 'para de transmitir a tela', 'chega de compartilhar', 'encerra o compartilhamento', 'para de mostrar minha tela', 'desliga a transmissao', 'para de compartilhar', 'para a transmissao', 'encerra a live', 'desliga o compartilhamento de tela', 'para de streamar', 'tira minha tela'],
  call_user: ['liga pro {U}', 'faz uma chamada com a {U}', 'chama o {U} na call', 'quero ligar pra {U}', 'liga pra {U} agora', 'faz call com {U}'],
  react_last: ['reage com joinha na ultima mensagem', 'coloca um coracao na ultima mensagem', 'reage com fogo', 'da like na ultima mensagem', 'reage kkk', 'reage com 😂'],
  pin_last: ['fixa a ultima mensagem', 'fixar essa mensagem', 'pina a ultima mensagem', 'deixa a ultima mensagem fixada'],
  edit_last: ['edita minha ultima mensagem para {T}', 'corrige minha mensagem pra {T}', 'muda minha ultima mensagem pra {T}', 'edita a mensagem'],
  delete_last: ['apaga minha ultima mensagem', 'deleta a mensagem que eu mandei', 'exclui minha ultima mensagem', 'apaga o que eu mandei'],
  search: ['procura a palavra {T} no chat', 'procura {T} no chat', 'acha {T} nas mensagens', 'procura {T} no canal', 'pesquisa mensagens sobre {T}', 'busca {T}', 'acha a mensagem que falava de {T}', 'procurar por {T}'],
  unread_summary: ['tenho mensagens novas', 'o que eu perdi', 'alguma mensagem nao lida', 'tem novidade', 'quantas mensagens nao lidas', 'alguem me mandou mensagem'],
  summarize_channel: ['resume o chat', 'faz um resumo da conversa', 'o que rolou nesse canal', 'resume as ultimas mensagens', 'me conta o que falaram aqui', 'tldr do canal'],
  open_settings: ['abre as configuracoes', 'vai pras configuracoes', 'configuracoes de voz', 'abre as configuracoes da conta', 'quero mudar minha senha', 'abre os ajustes'],
  set_animations: ['diminui as animacoes', 'animacoes reduzidas', 'liga as animacoes completas', 'tira as animacoes', 'volta as animacoes'],
  sounds_off: ['desliga os sons', 'tira os sons de notificacao', 'silencia as notificacoes', 'sem sons'],
  sounds_on: ['liga os sons', 'volta os sons', 'ativa os sons de notificacao'],
  logout: ['sai da minha conta', 'faz logout', 'desloga', 'sair da conta', 'quero deslogar'],
  kick_member: ['expulsa o {U}', 'chuta o {U} do servidor', 'tira a {U} do server', 'remove o {U} do servidor', 'kicka o {U}'],
  promote_member: ['deixa a {U} como admin', 'coloca o {U} de admin', 'faz a {U} virar admin', 'torna o {U} admin', 'promove a {U} a administradora', 'da cargo de admin pro {U}', 'deixa o {U} como administrador'],
  demote_member: ['tira o admin do {U}', 'rebaixa a {U}', 'remove o cargo de admin do {U}', 'deixa o {U} como membro'],
  add_emoji: ['adiciona um emoji no servidor', 'cria um emoji chamado {N}', 'novo emoji pro server', 'sobe um emoji personalizado', 'quero criar emoji'],
}

const fill = (s: string, i: number) => s
  .replace(/\{S\}/g, () => S[i % S.length]).replace(/\{C\}/g, () => C[(i + 1) % C.length])
  .replace(/\{U\}/g, () => U[(i + 2) % U.length]).replace(/\{N\}/g, () => N[(i + 3) % N.length])
  .replace(/\{T\}/g, () => ['bora jogar', 'to chegando', 'gg galera', 'hoje tem live', 'alguem on'][i % 5])

const PREFIX = ['', 'prisma ', 'prisma por favor ', 'ei prisma ', 'prisma ', 'pfv ', 'mano ']
const SUFFIX = ['', ' por favor', ' ai', ' pra mim', '', ' pfv']

/** Exemplos expandidos: cada frase vira algumas variações com nomes e jeitos de pedir diferentes. */
export function seedExamples(): { text: string; intent: Intent }[] {
  const out: { text: string; intent: Intent }[] = []
  for (const intent of INTENTS) {
    SEED[intent].forEach((base, i) => {
      const reps = /\{/.test(base) ? 3 : 2
      for (let r = 0; r < reps; r++) {
        const k = i * 7 + r * 3
        const small = ['greet', 'thanks', 'affirm', 'deny', 'cancel', 'repeat'].includes(intent)
        out.push({ text: (small ? '' : PREFIX[k % PREFIX.length]) + fill(base, k) + (small ? '' : SUFFIX[(k + r) % SUFFIX.length]), intent })
      }
    })
  }
  return out
}
