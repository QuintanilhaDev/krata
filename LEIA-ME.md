# Krata

Chat, voz, vídeo e compartilhamento de tela em até 4K a 60 fps, com tudo liberado para qualquer conta.
Feito com React + TypeScript (Vite), banco e tempo real no Supabase e hospedagem na Vercel.

---

## Como colocar no ar (cerca de 20 minutos)

### 1. Criar o banco no Supabase

1. Crie um projeto em <https://supabase.com>.
2. Vá em **SQL Editor → New query**, cole o arquivo `supabase/schema.sql` inteiro e clique em **Run**.
   Ele cria as tabelas, as regras de segurança, as funções e os dois espaços de arquivos (`attachments` e `avatars`).
   Pode rodar de novo quando quiser: ele não apaga dados.

### 2. Ligar o login por usuário e senha

1. **Authentication → Sign In / Providers → Email**: deixe ativado e **desligue "Confirm email"**.
   (O Krata não usa e-mail de verdade: por baixo, cada conta vira `nomedeusuario@users.krata.app`.
   Com a confirmação ligada, ninguém consegue entrar.)
2. Em **Authentication → Sign In / Providers**, deixe os outros métodos (telefone, Google etc.) desligados.
3. Opcional: em **Authentication → Policies** (ou "Password Security"), defina o tamanho mínimo da senha
   para **8** — o app já exige 8 caracteres com letras e números.

O nome de usuário é o login, por isso não muda depois do cadastro (o nome de exibição muda quando quiser).
O banco recusa cadastros feitos pela API que não sigam esse formato.

**Esqueceu a senha?** Como não há e-mail, só você (administrador) consegue redefinir. No **SQL Editor**:

```sql
update auth.users
set encrypted_password = extensions.crypt('NOVA-SENHA-AQUI', extensions.gen_salt('bf'))
where email = 'nomedeusuario@users.krata.app';
```

### 3. Fechar o tempo real para quem não tem permissão

Em **Realtime → Settings**, desligue **Allow public access**. Os canais do Krata são privados e o
`schema.sql` já criou as regras de quem pode entrar em cada um.

### 4. Arquivos de até 200 MB

O limite de 200 MB por arquivo já está configurado no espaço `attachments`. Falta liberar o limite global:
**Storage → Settings → Upload file size limit → 200 MB**.

> O plano **Free** do Supabase só permite até 50 MB por arquivo. Para 200 MB é preciso o plano **Pro**.
> Se o limite global ficar menor, o app avisa com clareza quando um arquivo passar dele.

### 5. Publicar na Vercel

1. Envie esta pasta para um repositório no GitHub (ou use `npx vercel` direto na pasta).
2. Na Vercel: **Add New → Project**, escolha o repositório. Ela detecta o Vite sozinha (o `vercel.json` já está pronto).
3. Em **Environment Variables**, cadastre:
   - `VITE_SUPABASE_URL` — Supabase → Project Settings → API → Project URL
   - `VITE_SUPABASE_ANON_KEY` — a chave `anon` (ou a nova `publishable`) da mesma tela
4. Clique em **Deploy**.

### 6. (Recomendado) Servidor TURN para chamadas

As chamadas ligam as pessoas diretamente. Em algumas redes (4G de algumas operadoras, empresas, faculdades)
a ligação direta é bloqueada e só funciona passando por um servidor TURN. Sem ele, cerca de 1 em cada 10
pessoas pode não conseguir ouvir ou ver os outros.

Serviços com plano gratuito ou barato: Cloudflare Realtime TURN, Metered.ca, Twilio Network Traversal.
Cadastre na Vercel e publique de novo:

```
VITE_TURN_URLS=turn:seu-servidor:3478,turns:seu-servidor:5349
VITE_TURN_USERNAME=usuario
VITE_TURN_CREDENTIAL=senha
```

### 7. Ligar a Prisma (assistente)

A Prisma já funciona sem nada configurado: todos os comandos do app (criar servidor, trocar foto, entrar na call, mutar…)
são entendidos pelo cérebro dela, que roda no navegador. Para ligar a conversa livre, a voz no iPhone e as respostas nos canais:

1. No **SQL Editor** do Supabase, rode `supabase/prisma.sql` (se você rodou o `schema.sql` novo inteiro, ele já está lá).
2. Crie uma chave grátis em **console.groq.com → API Keys**.
3. Na Vercel → **Settings → Environment Variables**, cadastre (em Production) e publique de novo:

| Variável | Para quê |
|---|---|
| `GROQ_API_KEY` | conversa livre, resumos e voz no iPhone (Whisper) |
| `SUPABASE_SERVICE_ROLE_KEY` | respostas da Prisma dentro dos canais (`@prisma`), limite diário por pessoa e aprendizado compartilhado. Fica só no servidor: **nunca** coloque com prefixo `VITE_` |
| `SUPABASE_URL` | a mesma URL do `VITE_SUPABASE_URL` (opcional, ele usa a outra se faltar) |
| `PRISMA_DAILY_LIMIT` | papos com a IA por pessoa por dia (padrão 40; comandos não contam) |
| `AZURE_SPEECH_KEY` e `AZURE_SPEECH_REGION` | opcional: voz neural feminina (Thalita) com o brilho cristalino. Sem isso ela usa a melhor voz feminina do aparelho |

Como usar: fale **“Prisma”** no começo ou no meio da frase (“Prisma, cria um servidor chamado Tropa”, “ô Prisma, me muta”).
No computador e no Android ela ouve o tempo todo (o navegador pede o microfone uma vez). No iPhone o navegador não deixa
ouvir continuamente: toque no botão flutuante dela para falar (segure para abrir o chat escrito). Em qualquer canal,
escreva `@prisma` + pergunta e ela responde ali para todo mundo.

### Rodar no computador (opcional)

```bash
npm install
cp .env.example .env.local   # preencha as variáveis
npm run dev
```

---

## O que tem

**Conta e perfil**
- Cadastro com nome de usuário e senha (mínimo de 8 caracteres, com indicador de força), entrar e sair, trocar a senha nas configurações.
- Perfil com foto (GIF animado também), banner, cor, "sobre mim", status (disponível, ausente, não perturbe, invisível) e status personalizado.

**Servidores**
- Criar, entrar por link ou código de convite, sair, apagar, transferir.
- Canais de texto e salas de voz, organizados por categoria; criar, renomear, apagar.
- Cargos: dono, administradores e membros. Expulsar pessoas. Gerar novo convite.
- Emojis próprios do servidor, que qualquer pessoa usa em qualquer conversa.

**Conversas**
- Mensagens diretas e grupos de até 10 pessoas. Amigos: adicionar pelo nome de usuário, aceitar, recusar, desfazer.
- Mensagens com negrito, itálico, sublinhado, riscado, código, blocos de código, citação, spoiler, links e menções (`@nome`, `@todos`).
- Responder, editar, apagar, reagir com emoji, fixar mensagens, buscar no canal.
- Fotos, vídeos, áudios e arquivos de até 200 MB, com barra de progresso e opção de cancelar. Arrastar e soltar ou colar da área de transferência.
- "Digitando…", mensagens não lidas, aviso de mensagens novas, sons e notificações do navegador.
- Mensagens de até 4.000 caracteres.

**Voz, vídeo e tela**
- Salas de voz nos servidores e chamadas em conversas (com toque, atender e recusar).
- Silenciar, parar de ouvir, câmera, volume individual de cada pessoa, indicador de quem está falando.
- Compartilhamento de tela com som em até **4K a 60 fps para qualquer conta**: escolha de resolução, quadros por segundo e prioridade (fluidez para jogos ou nitidez para texto). Dá para mudar a qualidade no meio da transmissão.
- Ping, resolução, fps e taxa de bits ao vivo. Tela cheia e janela flutuante.
- Reconexão automática se a internet cair por alguns segundos.

**Extras**
- Busca rápida (Ctrl + K), atalhos (seta para cima edita a última mensagem, Esc cancela).
- Funciona no celular e no computador, e pode ser adicionado à tela inicial do celular como um app.
- Animações em 3D que respeitam a configuração "reduzir movimento" do sistema.

## Limites que é bom saber

- **Tamanho das chamadas:** cada pessoa envia sua voz e sua tela diretamente para cada participante. Funciona muito bem
  até umas 6 a 8 pessoas por sala. Uma transmissão em 4K para 5 pessoas pede algo como 100 Mbps de envio de quem transmite;
  quando a internet não aguenta, a qualidade baixa sozinha. Para salas grandes seria preciso um servidor de mídia (ex.: LiveKit).
- **4K de verdade** depende da internet de envio e da placa de vídeo de quem transmite.
- **Celulares** não permitem compartilhar a tela pelo navegador (limitação do Android/iOS). Assistir funciona normalmente.
- Notificações só chegam com o Krata aberto em alguma aba.
- **Prisma:** o plano grátis da Groq tem um limite diário para a conta inteira (por volta de mil conversas por dia no modelo
  principal; quando acaba ela troca de modelo sozinha). Comandos do app não gastam nada. Com muita gente, use o plano pago.
- Não fazem parte desta versão: integrações externas, tópicos/fóruns, palcos, permissões por canal, enquetes e encaminhar mensagens.

## Estrutura

```
supabase/schema.sql      banco, regras de segurança, funções, arquivos e tempo real
src/lib/                 cliente Supabase, envio de arquivos, telefone, sons
src/store/               estado do app e tudo que conversa com o banco
src/voice/engine.ts      chamadas, câmera e compartilhamento de tela (WebRTC)
src/components/          telas: login, chat, lateral, janelas, chamada, Prisma
src/prisma/              Prisma: cérebro local (aprendizado de máquina), voz, voo da fada, comandos
api/                     funções do servidor da Prisma (Groq, Whisper, voz neural)
supabase/prisma.sql      tabelas e regras da Prisma
src/styles/app.css       identidade visual (ônix, jade e branco) e animações
vercel.json              configuração da hospedagem
```
