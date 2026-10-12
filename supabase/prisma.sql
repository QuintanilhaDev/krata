-- ============================================================================
--  KRATA — PRISMA (assistente). Rode este arquivo UMA vez no SQL Editor do Supabase,
--  depois do schema.sql. Pode rodar de novo sem problema.
-- ============================================================================

-- Pronome escolhido no cadastro (a Prisma usa para "bem-vindo" / "bem-vinda")
alter table public.profiles add column if not exists pronoun text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pronoun_check') then
    alter table public.profiles add constraint profiles_pronoun_check check (pronoun is null or pronoun in ('ele', 'ela'));
  end if;
end $$;
grant update (pronoun) on public.profileit to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user text := lower(btrim(coalesce(new.raw_user_meta_data->>'username', '')));
  v_name text := btrim(coalesce(new.raw_user_meta_data->>'display_name', ''));
  v_pron text := lower(coalesce(new.raw_user_meta_data->>'pronoun', ''));
begin
  if v_user !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Nome de usuário inválido: use de 3 a 20 letras minúsculas, números, ponto ou sublinhado.';
  end if;
  if lower(coalesce(new.email, '')) <> v_user || '@users.krata.app' then
    raise exception 'Cadastro inválido.';
  end if;
  if v_name = '' then v_name := v_user; end if;
  insert into public.profiles (id, username, display_name, onboarded, pronoun)
  values (new.id, v_user, left(v_name, 32), true, case when v_pron in ('ele', 'ela') then v_pron end);
  return new;
end;
$$;

-- Mensagens escritas pela Prisma dentro dos canais (só o servidor da Vercel consegue marcar)
alter table public.messages add column if not exists bot text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_bot_check') then
    alter table public.messages add constraint messages_bot_check check (bot is null or bot = 'prisma');
  end if;
end $$;

create or replace function public.guard_message_insert()
returns trigger language plpgsql as $$
begin
  new.created_at := now();
  new.edited_at := null;
  new.pinned := false;
  if current_user in ('authenticated', 'anon') then
    new.bot := null;
  end if;
  return new;
end;
$$;

-- Ninguém edita o texto de uma resposta da Prisma (nem quem pediu)
create or replace function public.guard_message_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.pinned := old.pinned;
    new.bot := old.bot;
    if old.bot is not null then new.content := old.content; end if;
  end if;
  new.id := old.id;
  new.channel_id := old.channel_id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  new.attachments := old.attachments;
  new.reply_to := old.reply_to;
  if new.content is distinct from old.content then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

-- Cota diária de conversa com a IA (por pessoa)
create table if not exists public.prisma_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day     date not null,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.prisma_usage enable row level security;
revoke all on public.prisma_usage from anon, authenticated;

create or replace function public.prisma_take_quota(p_user uuid, p_limit integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count integer;
begin
  insert into prisma_usage (user_id, day, count) values (p_user, v_day, 1)
  on conflict (user_id, day) do update set count = prisma_usage.count + 1
  returning count into v_count;
  if v_count > p_limit then
    update prisma_usage set count = p_limit where user_id = p_user and day = v_day;
    return -1;
  end if;
  return v_count;
end;
$$;

-- Aprendizado compartilhado: pedidos que a IA da nuvem resolveu viram exemplos para o
-- cérebro local de todo mundo (assim a Prisma depende cada vez menos da nuvem)
create table if not exists public.prisma_examples (
  id         bigserial primary key,
  text       text not null unique check (char_length(text) between 2 and 160),
  intent     text not null check (intent ~ '^[a-z_]{2,40}$'),
  hits       integer not null default 1,
  created_at timestamptz not null default now()
);
alter table public.prisma_examples enable row level security;
revoke all on public.prisma_examples from anon, authenticated;
grant select on public.prisma_examples to authenticated;
drop policy if exists prisma_examples_read on public.prisma_examples;
create policy prisma_examples_read on public.prisma_examples for select to authenticated using (true);

create or replace function public.prisma_learn(p_text text, p_intent text)
returns void language sql security definer set search_path = public as $$
  insert into prisma_examples (text, intent) values (lower(btrim(p_text)), p_intent)
  on conflict (text) do update set intent = excluded.intent, hits = prisma_examples.hits + 1;
$$;

-- só o servidor (chave de serviço) usa estas duas
revoke execute on function public.prisma_take_quota(uuid, integer) from public, anon, authenticated;
revoke execute on function public.prisma_learn(text, text) from public, anon, authenticated;
