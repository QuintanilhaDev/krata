-- ============================================================================
--  KRATA — banco de dados (Supabase / Postgres)
--  Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
--  Pode ser executado mais de uma vez sem quebrar nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique
                  check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name  text not null check (char_length(display_name) between 1 and 32),
  avatar_url    text,
  banner_url    text,
  accent_color  text not null default '#00A86B'
                  check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  bio           text not null default '' check (char_length(bio) <= 300),
  status        text not null default 'online'
                  check (status in ('online', 'idle', 'dnd', 'invisible')),
  custom_status text not null default '' check (char_length(custom_status) <= 80),
  onboarded     boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.servers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  icon_url    text,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  invite_code text not null unique
                default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  created_at  timestamptz not null default now()
);

create table if not exists public.server_members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index if not exists server_members_user_idx on public.server_members (user_id);

create table if not exists public.channels (
  id              uuid primary key default gen_random_uuid(),
  server_id       uuid references public.servers (id) on delete cascade,
  kind            text not null check (kind in ('text', 'voice', 'dm', 'group')),
  name            text not null default '' check (char_length(name) <= 60),
  topic           text not null default '' check (char_length(topic) <= 200),
  category        text not null default '' check (char_length(category) <= 40),
  position        integer not null default 0,
  dm_key          text unique,
  owner_id        uuid references public.profiles (id) on delete set null,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  check ((server_id is not null and kind in ('text', 'voice'))
      or (server_id is null and kind in ('dm', 'group')))
);
create index if not exists channels_server_idx on public.channels (server_id);

create table if not exists public.dm_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists dm_members_user_idx on public.dm_members (user_id);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.channels (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  content     text not null default '' check (char_length(content) <= 4000),
  attachments jsonb not null default '[]'::jsonb,
  reply_to    uuid references public.messages (id) on delete set null,
  pinned      boolean not null default false,
  edited_at   timestamptz,
  created_at  timestamptz not null default now(),
  check (char_length(btrim(content)) > 0 or jsonb_array_length(attachments) > 0),
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10)
);

create index if not exists messages_channel_idx on public.messages (channel_id, created_at desc);
create index if not exists messages_pinned_idx on public.messages (channel_id) where pinned;

create table if not exists public.reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.read_states (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table if not exists public.emojis (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid not null references public.servers (id) on delete cascade,
  name       text not null check (name ~ '^[a-z0-9_]{2,24}$'),
  url        text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);

-- ---------------------------------------------------------------------------
-- 2. FUNÇÕES AUXILIARES (usadas pelas regras de segurança)
-- ---------------------------------------------------------------------------

-- Cada anexo precisa ser um objeto com url http(s), nome, tipo e tamanho.
create or replace function public.valid_attachments(p jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 10
     and not exists (
       select 1 from jsonb_array_elements(p) e
       where jsonb_typeof(e) is distinct from 'object'
          or jsonb_typeof(e->'url') is distinct from 'string'
          or coalesce(e->>'url', '') !~ '^https?://'
          or char_length(coalesce(e->>'url', '')) > 2048
          or jsonb_typeof(e->'name') is distinct from 'string'
          or char_length(coalesce(e->>'name', '')) > 255
          or jsonb_typeof(e->'type') is distinct from 'string'
          or char_length(coalesce(e->>'type', '')) > 255
          or jsonb_typeof(e->'size') is distinct from 'number'
          or (e ? 'width' and jsonb_typeof(e->'width') is distinct from 'number')
          or (e ? 'height' and jsonb_typeof(e->'height') is distinct from 'number'));
$$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_attachments_valid') then
    alter table public.messages add constraint messages_attachments_valid check (public.valid_attachments(attachments));
  end if;
end $$;

create or replace function public.is_server_member(p_server uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_members
                 where server_id = p_server and user_id = auth.uid());
$$;

create or replace function public.is_server_admin(p_server uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_members
                 where server_id = p_server and user_id = auth.uid()
                   and role in ('owner', 'admin'));
$$;

create or replace function public.is_server_owner(p_server uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from servers where id = p_server and owner_id = auth.uid());
$$;

create or replace function public.is_dm_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from dm_members
                 where channel_id = p_channel and user_id = auth.uid());
$$;

create or replace function public.can_access_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    where c.id = p_channel
      and ((c.server_id is not null and exists (
              select 1 from server_members sm
              where sm.server_id = c.server_id and sm.user_id = auth.uid()))
        or (c.server_id is null and exists (
              select 1 from dm_members dm
              where dm.channel_id = c.id and dm.user_id = auth.uid())))
  );
$$;

create or replace function public.can_moderate_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    join server_members sm on sm.server_id = c.server_id
    where c.id = p_channel and sm.user_id = auth.uid() and sm.role in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. GATILHOS
-- ---------------------------------------------------------------------------

-- Cria o perfil quando a conta nasce.
-- O login é por nome de usuário e senha: por baixo, o Supabase guarda o usuário como
-- o e-mail interno "<usuario>@users.krata.app" (ninguém recebe e-mail nenhum).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user text := lower(btrim(coalesce(new.raw_user_meta_data->>'username', '')));
  v_name text := btrim(coalesce(new.raw_user_meta_data->>'display_name', ''));
begin
  if v_user !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Nome de usuário inválido: use de 3 a 20 letras minúsculas, números, ponto ou sublinhado.';
  end if;
  if lower(coalesce(new.email, '')) <> v_user || '@users.krata.app' then
    raise exception 'Cadastro inválido.';
  end if;
  if v_name = '' then v_name := v_user; end if;
  insert into public.profiles (id, username, display_name, onboarded)
  values (new.id, v_user, left(v_name, 32), true);
  return new;
end;
$$;

-- Usado na tela de cadastro (antes de ter login) para avisar se o nome está livre.
create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(btrim(p_username)) ~ '^[a-z0-9_.]{3,20}$'
     and not exists (select 1 from profiles where username = lower(btrim(p_username)));
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Marca a mensagem como editada. (As colunas que o autor pode alterar
-- são limitadas pelos GRANTs da seção 6.)
create or replace function public.guard_message_update()
returns trigger language plpgsql as $$
begin
  -- só as funções do próprio banco (como set_pinned) podem fixar mensagens
  if current_user in ('authenticated', 'anon') then
    new.pinned := old.pinned;
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

drop trigger if exists messages_guard_update on public.messages;
create trigger messages_guard_update
  before update on public.messages
  for each row execute function public.guard_message_update();

create or replace function public.touch_channel_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update channels set last_message_at = new.created_at where id = new.channel_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_channel on public.messages;
create trigger messages_touch_channel
  after insert on public.messages
  for each row execute function public.touch_channel_on_message();

-- Garante que a data e o autor de uma mensagem nova venham do servidor.
create or replace function public.guard_message_insert()
returns trigger language plpgsql as $$
begin
  new.created_at := now();
  new.edited_at := null;
  new.pinned := false;
  return new;
end;
$$;

drop trigger if exists messages_guard_insert on public.messages;
create trigger messages_guard_insert
  before insert on public.messages
  for each row execute function public.guard_message_insert();


-- Defesa extra: mesmo que alguém chame a API direto, colunas sensíveis não mudam.
-- (Dentro das funções SECURITY DEFINER o usuário atual é o dono do banco, então elas passam.)
create or replace function public.guard_profile_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.id := old.id;
    new.username := old.username;
    new.onboarded := old.onboarded;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update before update on public.profiles
  for each row execute function public.guard_profile_update();

create or replace function public.guard_server_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.invite_code := old.invite_code;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists servers_guard_update on public.servers;
create trigger servers_guard_update before update on public.servers
  for each row execute function public.guard_server_update();

create or replace function public.guard_channel_write()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.dm_key := null;
      new.owner_id := null;
      new.last_message_at := null;
      new.created_at := now();
    else
      new.id := old.id;
      new.server_id := old.server_id;
      new.kind := old.kind;
      new.dm_key := old.dm_key;
      new.owner_id := old.owner_id;
      new.last_message_at := old.last_message_at;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists channels_guard_write on public.channels;
create trigger channels_guard_write before insert or update on public.channels
  for each row execute function public.guard_channel_write();

-- ---------------------------------------------------------------------------
-- 4. FUNÇÕES CHAMADAS PELO APP (RPC)
-- ---------------------------------------------------------------------------

create or replace function public.create_server(p_name text, p_icon text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  if (select count(*) from server_members where user_id = v_uid) >= 100 then
    raise exception 'Você já participa de 100 servidores.';
  end if;
  insert into servers (name, icon_url, owner_id)
  values (btrim(p_name), p_icon, v_uid) returning id into v_id;
  insert into server_members (server_id, user_id, role) values (v_id, v_uid, 'owner');
  insert into channels (server_id, kind, name, category, position) values
    (v_id, 'text',  'geral',       'Canais de texto', 0),
    (v_id, 'text',  'mídia',       'Canais de texto', 1),
    (v_id, 'voice', 'Sala de voz', 'Canais de voz',   0),
    (v_id, 'voice', 'Cinema',      'Canais de voz',   1);
  return v_id;
end;
$$;

create or replace function public.invite_preview(p_code text)
returns table (id uuid, name text, icon_url text, member_count bigint, already_member boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.icon_url,
         (select count(*) from server_members sm where sm.server_id = s.id),
         exists (select 1 from server_members sm
                 where sm.server_id = s.id and sm.user_id = auth.uid())
  from servers s
  where auth.uid() is not null and s.invite_code = lower(btrim(p_code));
$$;

create or replace function public.join_server(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  select id into v_id from servers where invite_code = lower(btrim(p_code));
  if v_id is null then raise exception 'Convite inválido ou expirado.'; end if;
  insert into server_members (server_id, user_id, role)
  values (v_id, v_uid, 'member') on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.regenerate_invite(p_server uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_server_admin(p_server) then
    raise exception 'Apenas administradores podem gerar um novo convite.';
  end if;
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  update servers set invite_code = v_code where id = p_server;
  return v_code;
end;
$$;

create or replace function public.set_member_role(p_server uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_server_owner(p_server) then
    raise exception 'Apenas o dono do servidor pode alterar cargos.';
  end if;
  if p_role not in ('admin', 'member') then raise exception 'Cargo inválido.'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode alterar o próprio cargo.'; end if;
  update server_members set role = p_role where server_id = p_server and user_id = p_user;
end;
$$;

create or replace function public.transfer_server(p_server uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_server_owner(p_server) then
    raise exception 'Apenas o dono pode transferir o servidor.';
  end if;
  if not exists (select 1 from server_members where server_id = p_server and user_id = p_user) then
    raise exception 'Essa pessoa não está no servidor.';
  end if;
  update servers set owner_id = p_user where id = p_server;
  update server_members set role = 'admin' where server_id = p_server and user_id = auth.uid();
  update server_members set role = 'owner' where server_id = p_server and user_id = p_user;
end;
$$;

-- Dois usuários podem conversar se forem amigos ou dividirem um servidor.
create or replace function public.can_dm(p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.requester_id = auth.uid() and f.addressee_id = p_other)
        or (f.addressee_id = auth.uid() and f.requester_id = p_other)))
  or exists (
    select 1 from server_members a
    join server_members b on b.server_id = a.server_id
    where a.user_id = auth.uid() and b.user_id = p_other);
$$;

create or replace function public.open_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  if p_other = v_uid then raise exception 'Você não pode abrir uma conversa consigo mesmo.'; end if;
  if not exists (select 1 from profiles where id = p_other) then
    raise exception 'Usuário não encontrado.';
  end if;
  v_key := least(v_uid::text, p_other::text) || ':' || greatest(v_uid::text, p_other::text);
  select id into v_id from channels where dm_key = v_key and kind = 'dm' and server_id is null;
  if v_id is not null then return v_id; end if;
  if not can_dm(p_other) then
    raise exception 'Vocês precisam ser amigos ou dividir um servidor para conversar.';
  end if;
  insert into channels (kind, dm_key) values ('dm', v_key)
  on conflict (dm_key) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from channels where dm_key = v_key and kind = 'dm' and server_id is null;
    return v_id;
  end if;
  insert into dm_members (channel_id, user_id) values (v_id, v_uid), (v_id, p_other);
  return v_id;
end;
$$;

create or replace function public.create_group_dm(p_users uuid[], p_name text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_users uuid[];
  v_user uuid;
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  select array_agg(distinct u) into v_users from unnest(p_users) u where u <> v_uid;
  if v_users is null or array_length(v_users, 1) < 2 then
    raise exception 'Escolha pelo menos duas pessoas para criar um grupo.';
  end if;
  if array_length(v_users, 1) > 9 then
    raise exception 'Grupos aceitam até 10 pessoas.';
  end if;
  foreach v_user in array v_users loop
    if not can_dm(v_user) then
      raise exception 'Só é possível adicionar amigos ou pessoas de um servidor em comum.';
    end if;
  end loop;
  insert into channels (kind, name, owner_id)
  values ('group', left(btrim(coalesce(p_name, '')), 60), v_uid) returning id into v_id;
  insert into dm_members (channel_id, user_id) values (v_id, v_uid);
  insert into dm_members (channel_id, user_id) select v_id, u from unnest(v_users) u;
  return v_id;
end;
$$;

create or replace function public.send_friend_request(p_username text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid;
  v_row friendships%rowtype;
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  select id into v_other from profiles
  where username = lower(btrim(p_username, ' @')) and onboarded;
  if v_other is null then raise exception 'Ninguém usa esse nome de usuário.'; end if;
  if v_other = v_uid then raise exception 'Esse é o seu próprio nome de usuário.'; end if;
  select * into v_row from friendships
  where least(requester_id, addressee_id) = least(v_uid, v_other)
    and greatest(requester_id, addressee_id) = greatest(v_uid, v_other);
  if found then
    if v_row.status = 'accepted' then raise exception 'Vocês já são amigos.'; end if;
    if v_row.requester_id = v_uid then raise exception 'Pedido já enviado.'; end if;
    update friendships set status = 'accepted' where id = v_row.id;
    return 'accepted';
  end if;
  begin
    insert into friendships (requester_id, addressee_id) values (v_uid, v_other);
  exception when unique_violation then
    -- os dois mandaram pedido no mesmo instante: vira amizade
    update friendships set status = 'accepted'
    where least(requester_id, addressee_id) = least(v_uid, v_other)
      and greatest(requester_id, addressee_id) = greatest(v_uid, v_other)
      and requester_id = v_other and status = 'pending';
    if found then return 'accepted'; end if;
    raise exception 'Pedido já enviado.';
  end;
  return 'pending';
end;
$$;

create or replace function public.accept_friend_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update friendships set status = 'accepted'
  where id = p_id and addressee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Pedido não encontrado.'; end if;
end;
$$;

create or replace function public.set_pinned(p_message uuid, p_pinned boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_channel uuid; v_server uuid;
begin
  select m.channel_id, c.server_id into v_channel, v_server
  from messages m join channels c on c.id = m.channel_id where m.id = p_message;
  if v_channel is null or not can_access_channel(v_channel) then
    raise exception 'Mensagem não encontrada.';
  end if;
  if v_server is not null and not is_server_admin(v_server) then
    raise exception 'Apenas administradores podem fixar mensagens neste servidor.';
  end if;
  if p_pinned and (select count(*) from messages where channel_id = v_channel and pinned) >= 50 then
    raise exception 'Este canal já tem 50 mensagens fixadas.';
  end if;
  update messages set pinned = p_pinned where id = p_message;
end;
$$;

create or replace function public.mark_read(p_channel uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_access_channel(p_channel) then return; end if;
  insert into read_states (user_id, channel_id, last_read_at)
  values (auth.uid(), p_channel, now())
  on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.unread_counts()
returns table (channel_id uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.id, sm.joined_at
      from channels c
      join server_members sm on sm.server_id = c.server_id and sm.user_id = auth.uid()
     where c.kind = 'text'
    union all
    select c.id, dm.joined_at
      from channels c
      join dm_members dm on dm.channel_id = c.id and dm.user_id = auth.uid()
  )
  select mine.id, count(m.id)
    from mine
    left join read_states r on r.channel_id = mine.id and r.user_id = auth.uid()
    join messages m on m.channel_id = mine.id
                   and m.author_id <> auth.uid()
                   and m.created_at > coalesce(r.last_read_at, mine.joined_at)
   group by mine.id;
$$;

create or replace function public.search_messages(p_channel uuid, p_query text)
returns setof public.messages
language sql stable security definer set search_path = public as $$
  select m.* from messages m
  where m.channel_id = p_channel
    and can_access_channel(p_channel)
    and char_length(btrim(p_query)) >= 2
    and m.content ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by m.created_at desc
  limit 40;
$$;


-- Quem pode entrar/enviar em cada canal de tempo real (usado pelas regras do Realtime, seção 7).
create or replace function public.krata_topic_allowed(p_topic text, p_send boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_kind text;
  v_rest text;
  v_id uuid;
begin
  if auth.uid() is null or p_topic is null then return false; end if;
  if p_topic in ('krata-db', 'krata-presence') then return true; end if;
  v_kind := substring(p_topic from '^krata-(room|rtc|voice|user)-');
  if v_kind is null then return false; end if;
  v_rest := substr(p_topic, char_length('krata-' || v_kind || '-') + 1);
  if v_rest !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_id := v_rest::uuid;
  if v_kind = 'room' then return can_access_channel(v_id); end if;
  if v_kind = 'rtc' then
    return can_access_channel(v_id)
       and exists (select 1 from channels where id = v_id and kind in ('voice', 'dm', 'group'));
  end if;
  if v_kind = 'voice' then return is_server_member(v_id) or is_dm_member(v_id); end if;
  -- canal pessoal: só o dono escuta; amigos e gente de servidor em comum podem mandar (chamadas)
  if p_send then return v_id <> auth.uid() and can_dm(v_id); end if;
  return v_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. SEGURANÇA (Row Level Security)
-- ---------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.servers        enable row level security;
alter table public.server_members enable row level security;
alter table public.channels       enable row level security;
alter table public.dm_members     enable row level security;
alter table public.messages       enable row level security;
alter table public.reactions      enable row level security;
alter table public.read_states    enable row level security;
alter table public.friendships    enable row level security;
alter table public.emojis         enable row level security;

-- perfis
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- servidores
drop policy if exists servers_select on public.servers;
create policy servers_select on public.servers for select to authenticated
  using (public.is_server_member(id));
drop policy if exists servers_update on public.servers;
create policy servers_update on public.servers for update to authenticated
  using (public.is_server_admin(id)) with check (public.is_server_admin(id));
drop policy if exists servers_delete on public.servers;
create policy servers_delete on public.servers for delete to authenticated
  using (owner_id = auth.uid());

-- membros
drop policy if exists server_members_select on public.server_members;
create policy server_members_select on public.server_members for select to authenticated
  using (public.is_server_member(server_id));
drop policy if exists server_members_delete on public.server_members;
create policy server_members_delete on public.server_members for delete to authenticated
  using ((user_id = auth.uid() and role <> 'owner')
      or (role = 'member' and public.is_server_admin(server_id))
      or (role <> 'owner' and public.is_server_owner(server_id)));

-- canais
drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated
  using ((server_id is not null and public.is_server_member(server_id))
      or (server_id is null and public.is_dm_member(id)));
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (server_id is not null and public.is_server_admin(server_id));
drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update to authenticated
  using (server_id is not null and public.is_server_admin(server_id))
  with check (server_id is not null and public.is_server_admin(server_id));
drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated
  using (server_id is not null and public.is_server_admin(server_id));

-- participantes de DMs e grupos
drop policy if exists dm_members_select on public.dm_members;
create policy dm_members_select on public.dm_members for select to authenticated
  using (public.is_dm_member(channel_id));
drop policy if exists dm_members_delete on public.dm_members;
create policy dm_members_delete on public.dm_members for delete to authenticated
  using (user_id = auth.uid()
     and exists (select 1 from public.channels c where c.id = channel_id and c.kind = 'group'));

-- mensagens
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.can_access_channel(channel_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (author_id = auth.uid() and public.can_access_channel(channel_id));
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (author_id = auth.uid() and public.can_access_channel(channel_id))
  with check (author_id = auth.uid() and public.can_access_channel(channel_id));
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete to authenticated
  using (author_id = auth.uid() or public.can_moderate_channel(channel_id));

-- reações
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions for select to authenticated
  using (exists (select 1 from public.messages m
                 where m.id = message_id and public.can_access_channel(m.channel_id)));
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = auth.uid()
          and exists (select 1 from public.messages m
                      where m.id = message_id and public.can_access_channel(m.channel_id)));
drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions for delete to authenticated
  using (user_id = auth.uid());

-- leitura
drop policy if exists read_states_select on public.read_states;
create policy read_states_select on public.read_states for select to authenticated
  using (user_id = auth.uid());

-- amizades
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- emojis personalizados (qualquer usuário logado pode ver e usar em qualquer lugar)
drop policy if exists emojis_select on public.emojis;
create policy emojis_select on public.emojis for select to authenticated using (true);
drop policy if exists emojis_insert on public.emojis;
create policy emojis_insert on public.emojis for insert to authenticated
  with check (created_by = auth.uid() and public.is_server_admin(server_id));
drop policy if exists emojis_delete on public.emojis;
create policy emojis_delete on public.emojis for delete to authenticated
  using (public.is_server_admin(server_id));

-- ---------------------------------------------------------------------------
-- 6. PERMISSÕES
-- ---------------------------------------------------------------------------

-- O Supabase dá acesso total às tabelas por padrão; aqui tiramos tudo e
-- liberamos só o necessário, coluna por coluna.
grant usage on schema public to authenticated;
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant select on public.profiles, public.servers, public.server_members, public.channels,
                public.dm_members, public.messages, public.reactions, public.read_states,
                public.friendships, public.emojis to authenticated;
-- o nome de usuário é o login, por isso não muda depois do cadastro
grant update (display_name, avatar_url, banner_url, accent_color, bio, status,
              custom_status) on public.profiles to authenticated;
grant update (name, icon_url) on public.servers to authenticated;
grant delete on public.servers, public.server_members, public.channels, public.dm_members,
                public.messages, public.reactions, public.friendships, public.emojis
      to authenticated;
grant insert (server_id, kind, name, topic, category, position) on public.channels to authenticated;
grant update (name, topic, category, position) on public.channels to authenticated;
grant insert (id, channel_id, author_id, content, attachments, reply_to) on public.messages to authenticated;
grant update (content) on public.messages to authenticated;
grant insert (message_id, user_id, emoji) on public.reactions to authenticated;
grant insert (server_id, name, url, created_by) on public.emojis to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.username_available(text) to anon;

-- ---------------------------------------------------------------------------
-- 7. TEMPO REAL
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['profiles', 'servers', 'server_members', 'channels', 'dm_members',
                           'messages', 'reactions', 'friendships', 'emojis'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Canais privados: só entra quem tem permissão (veja krata_topic_allowed).
-- Depois de rodar, desligue "Allow public access" em Realtime → Settings.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists krata_realtime_receive on realtime.messages';
    execute 'create policy krata_realtime_receive on realtime.messages for select to authenticated
             using (public.krata_topic_allowed((select realtime.topic()), false))';
    execute 'drop policy if exists krata_realtime_send on realtime.messages';
    execute 'create policy krata_realtime_send on realtime.messages for insert to authenticated
             with check (public.krata_topic_allowed((select realtime.topic()), true))';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. ARQUIVOS (Storage) — limite de 200 MB por arquivo no chat
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', true, 209715200),
       ('avatars',     'avatars',     true, 10485760)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists krata_storage_read on storage.objects;
create policy krata_storage_read on storage.objects for select
  using (bucket_id in ('attachments', 'avatars'));
drop policy if exists krata_storage_insert on storage.objects;
create policy krata_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('attachments', 'avatars')
          and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists krata_storage_delete on storage.objects;
create policy krata_storage_delete on storage.objects for delete to authenticated
  using (bucket_id in ('attachments', 'avatars')
     and (storage.foldername(name))[1] = auth.uid()::text);


-- ---------------------------------------------------------------------------
-- 9. PRISMA (assistente) — o mesmo conteúdo de supabase/prisma.sql
-- ---------------------------------------------------------------------------

-- Pronome escolhido no cadastro (a Prisma usa para "bem-vindo" / "bem-vinda")
alter table public.profiles add column if not exists pronoun text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pronoun_check') then
    alter table public.profiles add constraint profiles_pronoun_check check (pronoun is null or pronoun in ('ele', 'ela'));
  end if;
end $$;
grant update (pronoun) on public.profiles to authenticated;

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

-- =============================================================================
-- 10. NOTIFICAÇÕES DO APP ANDROID
-- Cada celular com o app recebe uma "chave do aparelho" (só o hash fica no banco).
-- Com ela o app busca as mensagens novas em segundo plano e responde direto da
-- notificação, sem precisar da sessão do site (que expira e gira de tempos em tempos).
-- Rode este arquivo uma vez no SQL Editor do Supabase.
-- =============================================================================

create table if not exists public.devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  secret_hash bytea not null unique,
  name        text not null default 'Android' check (char_length(name) <= 60),
  last_seen   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists devices_user_idx on public.devices (user_id);
alter table public.devices enable row level security;
revoke all on public.devices from anon, authenticated;

create or replace function public.device_hash(p_secret text)
returns bytea language sql immutable as $$ select sha256(convert_to(coalesce(p_secret, ''), 'UTF8')) $$;

-- o site (logado) registra o aparelho e entrega a chave para o app
create or replace function public.register_device(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_secret text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  insert into devices (user_id, secret_hash, name) values (v_uid, device_hash(v_secret), left(coalesce(nullif(btrim(p_name), ''), 'Android'), 60));
  -- no máximo 10 aparelhos por pessoa: os mais antigos saem
  delete from devices where user_id = v_uid and id not in (select id from devices where user_id = v_uid order by last_seen desc limit 10);
  return v_secret;
end;
$$;

-- sair da conta no app apaga a chave (quem tem a chave pode apagá-la)
create or replace function public.unregister_device(p_secret text)
returns void language sql security definer set search_path = public as $$
  delete from public.devices where secret_hash = public.device_hash(p_secret);
$$;

-- mensagens novas para o aparelho: conversas privadas e grupos sempre; servidores só com @menção
create or replace function public.device_inbox(p_secret text, p_after timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_me profiles%rowtype;
  v_since timestamptz := greatest(coalesce(p_after, now() - interval '10 minutes'), now() - interval '1 day');
  v_rows jsonb;
begin
  select user_id into v_uid from devices where secret_hash = device_hash(p_secret);
  if v_uid is null then raise exception 'device_revoked' using errcode = 'P0001'; end if;
  update devices set last_seen = now() where secret_hash = device_hash(p_secret) and last_seen < now() - interval '1 minute';
  select * into v_me from profiles where id = v_uid;
  if v_me.status = 'dnd' then return jsonb_build_object('now', now(), 'dnd', true, 'messages', '[]'::jsonb); end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at), '[]'::jsonb) into v_rows from (
    select m.id, m.channel_id, c.server_id, m.created_at, left(m.content, 400) as content,
           jsonb_array_length(m.attachments) as files,
           p.display_name as author, p.username as author_username, p.avatar_url as author_avatar, p.accent_color as author_color,
           c.kind, c.name as channel_name, s.name as server_name, s.icon_url as server_icon,
           (select count(*) from dm_members d2 where d2.channel_id = c.id) as members
    from messages m
    join channels c on c.id = m.channel_id
    join profiles p on p.id = m.author_id
    left join servers s on s.id = c.server_id
    where m.created_at > v_since
      and m.author_id <> v_uid
      and not exists (select 1 from read_states r where r.user_id = v_uid and r.channel_id = m.channel_id and r.last_read_at >= m.created_at)
      and (
        (c.server_id is null and exists (select 1 from dm_members d where d.channel_id = c.id and d.user_id = v_uid))
        or (c.server_id is not null
            and exists (select 1 from server_members sm where sm.server_id = c.server_id and sm.user_id = v_uid)
            and m.content ~* ('(^|\s)@(' || regexp_replace(v_me.username, '([.])', '\\\1', 'g') || '|todos)([^a-z0-9_.]|$)'))
      )
    order by m.created_at
    limit 40
  ) t;
  return jsonb_build_object('now', now(), 'messages', v_rows);
end;
$$;

-- responder pela notificação
create or replace function public.device_reply(p_secret text, p_channel uuid, p_content text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_server uuid;
begin
  select user_id into v_uid from devices where secret_hash = device_hash(p_secret);
  if v_uid is null then raise exception 'device_revoked' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_content, ''))) = 0 then return; end if;
  select server_id into v_server from channels where id = p_channel and kind in ('text', 'dm', 'group');
  if not found then raise exception 'Conversa não encontrada.'; end if;
  if v_server is null and not exists (select 1 from dm_members where channel_id = p_channel and user_id = v_uid) then raise exception 'Sem acesso.'; end if;
  if v_server is not null and not exists (select 1 from server_members where server_id = v_server and user_id = v_uid) then raise exception 'Sem acesso.'; end if;
  insert into messages (channel_id, author_id, content) values (p_channel, v_uid, left(p_content, 4000));
  insert into read_states (user_id, channel_id, last_read_at) values (v_uid, p_channel, now())
    on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- marcar como lida pela notificação
create or replace function public.device_mark_read(p_secret text, p_channel uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  select user_id into v_uid from devices where secret_hash = device_hash(p_secret);
  if v_uid is null then raise exception 'device_revoked' using errcode = 'P0001'; end if;
  insert into read_states (user_id, channel_id, last_read_at) values (v_uid, p_channel, now())
    on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke execute on function public.register_device(text) from anon;
grant execute on function public.register_device(text) to authenticated;
grant execute on function public.unregister_device(text) to anon, authenticated;
grant execute on function public.device_inbox(text, timestamptz) to anon, authenticated;
grant execute on function public.device_reply(text, uuid, text) to anon, authenticated;
grant execute on function public.device_mark_read(text, uuid) to anon, authenticated;

-- =============================================================================
-- 11. GIFS FAVORITOS (salvos na conta, aparecem em qualquer aparelho)
-- =============================================================================
create table if not exists public.gif_favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  gif_id     text not null check (char_length(gif_id) <= 200),
  url        text not null check (url ~ '^https://(media[0-9]?\.tenor\.com|c\.tenor\.com|media[0-9]?\.giphy\.com|i\.giphy\.com)/' and char_length(url) <= 600),
  preview    text not null check (preview ~ '^https://' and char_length(preview) <= 600),
  width      integer not null default 0,
  height     integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, gif_id)
);
alter table public.gif_favorites enable row level security;
drop policy if exists gif_favorites_own on public.gif_favorites;
create policy gif_favorites_own on public.gif_favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.gif_favorites to authenticated;
revoke all on public.gif_favorites from anon;

-- no máximo 300 favoritos por pessoa
create or replace function public.gif_favorites_cap() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from gif_favorites where user_id = new.user_id and gif_id in (
    select gif_id from gif_favorites where user_id = new.user_id order by created_at desc offset 300);
  return new;
end;
$$;
drop trigger if exists gif_favorites_cap on public.gif_favorites;
create trigger gif_favorites_cap after insert on public.gif_favorites for each row execute function public.gif_favorites_cap();

-- =============================================================================
-- 12. NOTIFICAÇÕES NO COMPUTADOR (Web Push) + MENÇÕES POR RESPOSTA
-- O navegador assina as notificações; quando chega mensagem privada, de grupo ou
-- menção, a rota /api/push manda o aviso — funciona com a aba fechada (o navegador
-- precisa estar aberto). Rode este arquivo uma vez no SQL Editor do Supabase.
-- =============================================================================

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) between 20 and 200),
  auth       text not null check (char_length(auth) between 8 and 100),
  agent      text not null default '' check (char_length(agent) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- cada mensagem é avisada uma vez só (mesmo que a rota seja chamada mais de uma vez)
create table if not exists public.push_sent (
  message_id uuid primary key,
  at         timestamptz not null default now()
);
create index if not exists push_sent_at_idx on public.push_sent (at);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, authenticated;

-- o navegador logado guarda a assinatura (se o computador era de outra conta, passa para esta)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_agent text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  delete from push_subscriptions where endpoint = p_endpoint;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(coalesce(p_agent, ''), 120));
  -- no máximo 10 navegadores por pessoa
  delete from push_subscriptions where user_id = v_uid and id not in (
    select id from push_subscriptions where user_id = v_uid order by created_at desc limit 10);
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

-- quem deve ser avisado desta mensagem (só a rota do servidor chama, com a chave de serviço)
create or replace function public.push_targets(p_message uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_count int;
  v_subs jsonb;
  v_group text;
begin
  select msg.id, msg.channel_id, msg.author_id, msg.content, msg.attachments, msg.reply_to, msg.created_at,
         c.kind, c.name as channel_name, c.server_id, s.name as server_name, s.icon_url as server_icon,
         p.display_name, p.username, p.avatar_url, p.accent_color
    into m
  from messages msg
  join channels c on c.id = msg.channel_id
  join profiles p on p.id = msg.author_id
  left join servers s on s.id = c.server_id
  where msg.id = p_message;
  if not found or m.created_at < now() - interval '5 minutes' then return null; end if;

  insert into push_sent (message_id) values (p_message) on conflict do nothing;
  get diagnostics v_count = row_count;
  if v_count = 0 then return null; end if;
  delete from push_sent where at < now() - interval '2 days';

  if m.kind = 'group' then
    select coalesce(nullif(m.channel_name, ''), string_agg(pr.display_name, ', ' order by pr.display_name)) into v_group
    from dm_members d join profiles pr on pr.id = d.user_id where d.channel_id = m.channel_id and d.user_id <> m.author_id;
  end if;

  with targets as (
    select d.user_id from dm_members d
    where m.server_id is null and d.channel_id = m.channel_id and d.user_id <> m.author_id
    union
    select sm.user_id from server_members sm join profiles pr on pr.id = sm.user_id
    where m.server_id is not null and sm.server_id = m.server_id and sm.user_id <> m.author_id
      and (m.content ~* ('(^|\s)@(' || regexp_replace(pr.username, '([.])', '\\\1', 'g') || '|todos)([^a-z0-9_.]|$)')
           or exists (select 1 from messages r where r.id = m.reply_to and r.author_id = sm.user_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), '[]'::jsonb)
    into v_subs
  from push_subscriptions ps
  join targets t on t.user_id = ps.user_id
  join profiles pr on pr.id = t.user_id
  where pr.status <> 'dnd';

  return jsonb_build_object(
    'message', jsonb_build_object(
      'id', m.id, 'channel_id', m.channel_id, 'server_id', m.server_id, 'kind', m.kind, 'created_at', m.created_at,
      'content', left(m.content, 600), 'attachments', m.attachments,
      'author', m.display_name, 'author_username', m.username, 'author_avatar', m.avatar_url, 'author_color', m.accent_color,
      'channel_name', m.channel_name, 'server_name', m.server_name, 'server_icon', m.server_icon, 'group_name', v_group,
      'reply_to_me', m.reply_to is not null),
    'subs', v_subs);
end;
$$;

revoke execute on function public.push_targets(uuid) from public, anon, authenticated;
revoke execute on function public.save_push_subscription(text, text, text, text) from anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Disparo automático: cada mensagem privada, de grupo, menção ou resposta chama
-- /api/push na hora (inclusive respostas enviadas pela notificação do celular).
-- Usa a extensão pg_net do Supabase. Se o seu site tiver outro endereço, troque abaixo.
-- -----------------------------------------------------------------------------
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net indisponível: o próprio app chama /api/push depois de enviar';
end $$;

create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
insert into public.app_config (key, value) values ('push_url', 'https://krata-henna.vercel.app/api/push')
  on conflict (key) do nothing;

create or replace function public.messages_push() returns trigger language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  -- mensagem comum de servidor (sem @ e sem resposta) não avisa ninguém: nem chama a rota
  if new.reply_to is null and position('@' in new.content) = 0
     and exists (select 1 from channels where id = new.channel_id and server_id is not null) then
    return new;
  end if;
  select value into v_url from app_config where key = 'push_url';
  if coalesce(v_url, '') = '' then return new; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using v_url, jsonb_build_object('id', new.id), jsonb_build_object('content-type', 'application/json');
  exception when others then null; -- sem pg_net: o app chama a rota sozinho
  end;
  return new;
end;
$$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages for each row execute function public.messages_push();

-- -----------------------------------------------------------------------------
-- Celular (app Android): também avisa quando alguém RESPONDE a uma mensagem sua
-- num servidor (como menção), além de @você, @todos e conversas privadas.
-- -----------------------------------------------------------------------------
create or replace function public.device_inbox(p_secret text, p_after timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_me profiles%rowtype;
  v_since timestamptz := greatest(coalesce(p_after, now() - interval '10 minutes'), now() - interval '1 day');
  v_rows jsonb;
begin
  select user_id into v_uid from devices where secret_hash = device_hash(p_secret);
  if v_uid is null then raise exception 'device_revoked' using errcode = 'P0001'; end if;
  update devices set last_seen = now() where secret_hash = device_hash(p_secret) and last_seen < now() - interval '1 minute';
  select * into v_me from profiles where id = v_uid;
  if v_me.status = 'dnd' then return jsonb_build_object('now', now(), 'dnd', true, 'messages', '[]'::jsonb); end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at), '[]'::jsonb) into v_rows from (
    select m.id, m.channel_id, c.server_id, m.created_at, left(m.content, 400) as content,
           jsonb_array_length(m.attachments) as files,
           p.display_name as author, p.username as author_username, p.avatar_url as author_avatar, p.accent_color as author_color,
           c.kind, c.name as channel_name, s.name as server_name, s.icon_url as server_icon,
           (select count(*) from dm_members d2 where d2.channel_id = c.id) as members
    from messages m
    join channels c on c.id = m.channel_id
    join profiles p on p.id = m.author_id
    left join servers s on s.id = c.server_id
    where m.created_at > v_since
      and m.author_id <> v_uid
      and not exists (select 1 from read_states r where r.user_id = v_uid and r.channel_id = m.channel_id and r.last_read_at >= m.created_at)
      and (
        (c.server_id is null and exists (select 1 from dm_members d where d.channel_id = c.id and d.user_id = v_uid))
        or (c.server_id is not null
            and exists (select 1 from server_members sm where sm.server_id = c.server_id and sm.user_id = v_uid)
            and (m.content ~* ('(^|\s)@(' || regexp_replace(v_me.username, '([.])', '\\\1', 'g') || '|todos)([^a-z0-9_.]|$)')
                 or exists (select 1 from messages r where r.id = m.reply_to and r.author_id = v_uid)))
      )
    order by m.created_at
    limit 40
  ) t;
  return jsonb_build_object('now', now(), 'messages', v_rows);
end;
$$;
grant execute on function public.device_inbox(text, timestamptz) to anon, authenticated;

-- =============================================================================
-- 13. LOJA (bundles decorativos: moldura da foto + moldura do card de perfil)
-- Artistas oficiais publicam, o desenvolvedor aprova e pode ajustar o preço.
-- O pagamento é PIX pelo Asaas: confirma sozinho, entrega no Inventário e repassa
-- 97% para a chave PIX do artista (3% ficam com o Krata).
-- Rode este arquivo uma vez no SQL Editor do Supabase.
-- =============================================================================

-- ---------------------------------------------------------------- equipe oficial
-- presos ao nome de usuário (que não muda depois do cadastro)
create table if not exists public.staff (
  username text primary key check (username ~ '^[a-z0-9_.]{3,20}$'),
  role     text not null check (role in ('dev', 'artist')),
  added_at timestamptz not null default now()
);
alter table public.staff enable row level security;
revoke all on public.staff from anon, authenticated;
grant select on public.staff to authenticated;
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated using (true);
insert into public.staff (username, role) values ('bones', 'dev'), ('novacombos', 'artist'), ('drawgoa', 'artist')
  on conflict (username) do nothing;

create or replace function public.is_dev(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff s join profiles p on p.username = s.username where p.id = p_uid and s.role = 'dev');
$$;
create or replace function public.is_artist(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff s join profiles p on p.username = s.username where p.id = p_uid and s.role = 'artist');
$$;
grant execute on function public.is_dev(uuid), public.is_artist(uuid) to authenticated;

-- ---------------------------------------------------------------- bundles
create table if not exists public.bundles (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.profiles (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 2 and 40),
  description  text not null default '' check (char_length(description) <= 240),
  avatar_frame text not null check (char_length(avatar_frame) <= 600),
  card_frame   text not null check (char_length(card_frame) <= 600),
  asked_cents  integer not null check (asked_cents between 500 and 100000),
  price_cents  integer not null check (price_cents between 500 and 100000),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'archived')),
  review_note  text not null default '' check (char_length(review_note) <= 300),
  reviewed_at  timestamptz,
  sales        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bundles_status_idx on public.bundles (status, created_at desc);
create index if not exists bundles_artist_idx on public.bundles (artist_id);
alter table public.bundles enable row level security;
revoke all on public.bundles from anon, authenticated;
grant select on public.bundles to authenticated;
drop policy if exists bundles_read on public.bundles;
-- todo mundo vê os aprovados (e os arquivados, para as molduras de quem já comprou continuarem aparecendo)
create policy bundles_read on public.bundles for select to authenticated
  using (status in ('approved', 'archived') or artist_id = auth.uid() or public.is_dev());

-- a imagem precisa estar no Storage do próprio artista
create or replace function public.own_store_url(p_url text, p_uid uuid)
returns boolean language sql immutable as $$
  select p_url ~ '^https?://' and position(('/storage/v1/object/public/avatars/' || p_uid::text || '/') in p_url) > 0;
$$;

create or replace function public.submit_bundle(p_name text, p_description text, p_avatar_frame text, p_card_frame text, p_price_cents integer, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if not is_artist(v_uid) then raise exception 'Só artistas oficiais do Krata podem publicar na loja.'; end if;
  if not own_store_url(p_avatar_frame, v_uid) or not own_store_url(p_card_frame, v_uid) then raise exception 'Envie as artes pelo painel do artista.'; end if;
  if p_price_cents is null or p_price_cents < 500 or p_price_cents > 100000 then raise exception 'O preço precisa ficar entre R$ 5,00 e R$ 1.000,00.'; end if;
  if p_id is null then
    if (select count(*) from bundles where artist_id = v_uid and status = 'pending') >= 10 then raise exception 'Você já tem 10 bundles esperando aprovação.'; end if;
    insert into bundles (artist_id, name, description, avatar_frame, card_frame, asked_cents, price_cents)
    values (v_uid, btrim(p_name), btrim(coalesce(p_description, '')), p_avatar_frame, p_card_frame, p_price_cents, p_price_cents)
    returning id into v_id;
  else
    -- editar volta para a fila de aprovação (só antes de aprovar ou depois de recusado)
    update bundles set name = btrim(p_name), description = btrim(coalesce(p_description, '')), avatar_frame = p_avatar_frame, card_frame = p_card_frame,
      asked_cents = p_price_cents, price_cents = p_price_cents, status = 'pending', review_note = '', updated_at = now()
    where id = p_id and artist_id = v_uid and status in ('pending', 'rejected')
    returning id into v_id;
    if v_id is null then raise exception 'Este bundle não pode mais ser editado.'; end if;
  end if;
  return v_id;
end;
$$;

-- tirar da loja (quem comprou continua com ele)
create or replace function public.archive_bundle(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update bundles set status = case when status = 'approved' then 'archived' else status end, updated_at = now()
  where id = p_id and (artist_id = auth.uid() or is_dev());
  delete from bundles where id = p_id and status in ('pending', 'rejected') and (artist_id = auth.uid() or is_dev());
end;
$$;

-- aprovação do desenvolvedor (pode ajustar o preço)
create or replace function public.review_bundle(p_id uuid, p_approve boolean, p_price_cents integer default null, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_dev() then raise exception 'Só o desenvolvedor aprova bundles.'; end if;
  if p_price_cents is not null and (p_price_cents < 500 or p_price_cents > 100000) then raise exception 'O preço precisa ficar entre R$ 5,00 e R$ 1.000,00.'; end if;
  update bundles set
    status = case when p_approve then 'approved' else 'rejected' end,
    price_cents = coalesce(p_price_cents, price_cents),
    review_note = left(coalesce(p_note, ''), 300), reviewed_at = now(), updated_at = now()
  where id = p_id;
  if not found then raise exception 'Bundle não encontrado.'; end if;
end;
$$;

create or replace function public.set_bundle_price(p_id uuid, p_price_cents integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_dev() then raise exception 'Só o desenvolvedor muda o preço.'; end if;
  if p_price_cents < 500 or p_price_cents > 100000 then raise exception 'O preço precisa ficar entre R$ 5,00 e R$ 1.000,00.'; end if;
  update bundles set price_cents = p_price_cents, updated_at = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------- chave PIX do artista
create table if not exists public.artist_payout (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  pix_key    text not null check (char_length(pix_key) between 5 and 80),
  pix_type   text not null check (pix_type in ('cpf', 'cnpj', 'email', 'phone', 'evp')),
  updated_at timestamptz not null default now()
);
alter table public.artist_payout enable row level security;
revoke all on public.artist_payout from anon, authenticated;
grant select on public.artist_payout to authenticated;
drop policy if exists artist_payout_read on public.artist_payout;
create policy artist_payout_read on public.artist_payout for select to authenticated using (user_id = auth.uid() or public.is_dev());

create or replace function public.valid_cpf(p text) returns boolean language plpgsql immutable as $$
declare d int[]; s int; r int; i int;
begin
  if p !~ '^[0-9]{11}$' or p ~ '^(.)\1{10}$' then return false; end if;
  select array_agg(substr(p, g, 1)::int order by g) into d from generate_series(1, 11) g;
  s := 0; for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if; if r <> d[10] then return false; end if;
  s := 0; for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = d[11];
end;
$$;

create or replace function public.set_pix_key(p_key text, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); k text := btrim(coalesce(p_key, ''));
begin
  if not is_artist(v_uid) and not is_dev(v_uid) then raise exception 'Só artistas oficiais cadastram chave PIX.'; end if;
  if p_type = 'cpf' and not valid_cpf(k) then raise exception 'CPF inválido.'; end if;
  if p_type = 'cnpj' and k !~ '^[0-9]{14}$' then raise exception 'CNPJ inválido.'; end if;
  if p_type = 'email' and k !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  if p_type = 'phone' and k !~ '^\+55[1-9][0-9]9?[0-9]{8}$' then raise exception 'Celular inválido (use DDD + número).'; end if;
  if p_type = 'evp' and k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Chave aleatória inválida.'; end if;
  if p_type not in ('cpf', 'cnpj', 'email', 'phone', 'evp') then raise exception 'Tipo de chave inválido.'; end if;
  insert into artist_payout (user_id, pix_key, pix_type) values (v_uid, lower(k), p_type)
  on conflict (user_id) do update set pix_key = excluded.pix_key, pix_type = excluded.pix_type, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------- inventário e molduras equipadas
create table if not exists public.inventory (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  bundle_id   uuid not null references public.bundles (id) on delete cascade,
  order_id    uuid,
  acquired_at timestamptz not null default now(),
  primary key (user_id, bundle_id)
);
alter table public.inventory enable row level security;
revoke all on public.inventory from anon, authenticated;
grant select on public.inventory to authenticated;
drop policy if exists inventory_read on public.inventory;
create policy inventory_read on public.inventory for select to authenticated using (user_id = auth.uid() or public.is_dev());

alter table public.profiles add column if not exists equipped_bundle uuid references public.bundles (id) on delete set null;

-- equipar (null tira a moldura). O artista pode usar as próprias criações aprovadas.
create or replace function public.equip_bundle(p_bundle uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if p_bundle is not null and not exists (select 1 from inventory where user_id = v_uid and bundle_id = p_bundle)
     and not exists (select 1 from bundles where id = p_bundle and artist_id = v_uid and status in ('approved', 'archived')) then
    raise exception 'Este bundle não está no seu inventário.';
  end if;
  update profiles set equipped_bundle = p_bundle where id = v_uid;
end;
$$;

-- ---------------------------------------------------------------- pedidos e repasses
create table if not exists public.store_orders (
  id           uuid primary key default gen_random_uuid(),
  bundle_id    uuid not null references public.bundles (id) on delete restrict,
  buyer_id     uuid not null references public.profiles (id) on delete cascade,
  artist_id    uuid not null references public.profiles (id) on delete cascade,
  price_cents  integer not null,
  status       text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'canceled', 'refunded')),
  provider     text not null default 'asaas',
  provider_id  text unique,
  pix_payload  text,
  pix_image    text,
  expires_at   timestamptz not null default now() + interval '1 hour',
  paid_at      timestamptz,
  manual       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists store_orders_buyer_idx on public.store_orders (buyer_id, created_at desc);
create index if not exists store_orders_status_idx on public.store_orders (status, created_at desc);
alter table public.store_orders enable row level security;
revoke all on public.store_orders from anon, authenticated;
grant select on public.store_orders to authenticated;
drop policy if exists store_orders_read on public.store_orders;
create policy store_orders_read on public.store_orders for select to authenticated using (buyer_id = auth.uid() or public.is_dev());

create table if not exists public.store_payouts (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.store_orders (id) on delete cascade,
  kind        text not null check (kind in ('artist', 'krata')),
  user_id     uuid references public.profiles (id) on delete set null,
  pix_key     text not null,
  pix_type    text not null,
  cents       integer not null check (cents > 0),
  status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'done', 'failed', 'manual')),
  provider_id text unique,
  error       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (order_id, kind)
);
alter table public.store_payouts enable row level security;
revoke all on public.store_payouts from anon, authenticated;
grant select on public.store_payouts to authenticated;
drop policy if exists store_payouts_read on public.store_payouts;
create policy store_payouts_read on public.store_payouts for select to authenticated using (user_id = auth.uid() or public.is_dev());

create table if not exists public.store_config (key text primary key, value text not null);
alter table public.store_config enable row level security;
revoke all on public.store_config from anon, authenticated;
insert into public.store_config (key, value) values ('krata_pix_key', '+5571986119559'), ('krata_pix_type', 'phone'), ('krata_fee_bps', '300')
  on conflict (key) do nothing;

-- a rota /api/store (chave de serviço) abre o pedido
create or replace function public.store_begin(p_buyer uuid, p_bundle uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b bundles%rowtype; o store_orders%rowtype;
begin
  select * into b from bundles where id = p_bundle;
  if not found or b.status <> 'approved' then raise exception 'Este bundle não está à venda.'; end if;
  if b.artist_id = p_buyer then raise exception 'Este bundle é seu: ele já está no seu inventário.'; end if;
  if exists (select 1 from inventory where user_id = p_buyer and bundle_id = p_bundle) then raise exception 'Você já tem este bundle.'; end if;
  if not exists (select 1 from artist_payout where user_id = b.artist_id) then raise exception 'O artista ainda não cadastrou a chave PIX. Tente mais tarde.'; end if;
  update store_orders set status = 'expired' where status = 'pending' and expires_at < now();
  -- reaproveita um pedido aberto do mesmo bundle (mesmo QR Code)
  select * into o from store_orders where buyer_id = p_buyer and bundle_id = p_bundle and status = 'pending' and price_cents = b.price_cents and provider_id is not null and expires_at > now() + interval '5 minutes' order by created_at desc limit 1;
  if found then return to_jsonb(o) || jsonb_build_object('reused', true); end if;
  if (select count(*) from store_orders where buyer_id = p_buyer and created_at > now() - interval '1 hour') >= 15 then raise exception 'Muitas tentativas de compra. Espere um pouco.'; end if;
  insert into store_orders (bundle_id, buyer_id, artist_id, price_cents) values (b.id, p_buyer, b.artist_id, b.price_cents) returning * into o;
  return to_jsonb(o) || jsonb_build_object('bundle_name', b.name);
end;
$$;

create or replace function public.store_attach(p_order uuid, p_provider_id text, p_payload text, p_image text, p_expires timestamptz)
returns void language sql security definer set search_path = public as $$
  update public.store_orders set provider_id = p_provider_id, pix_payload = p_payload, pix_image = p_image, expires_at = coalesce(p_expires, expires_at) where id = p_order;
$$;

-- pagamento confirmado: entrega o bundle e prepara os repasses (pode ser chamada várias vezes)
create or replace function public.store_mark_paid(p_order uuid, p_manual boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o store_orders%rowtype; ap artist_payout%rowtype; fee int; artist_c int; krata_c int; kkey text; ktype text;
begin
  select * into o from store_orders where id = p_order for update;
  if not found then return null; end if;
  if o.status <> 'paid' then
    update store_orders set status = 'paid', paid_at = now(), manual = p_manual where id = o.id;
    insert into inventory (user_id, bundle_id, order_id) values (o.buyer_id, o.bundle_id, o.id) on conflict do nothing;
    update bundles set sales = sales + 1 where id = o.bundle_id;
    select coalesce(value::int, 300) into fee from store_config where key = 'krata_fee_bps';
    krata_c := round(o.price_cents * coalesce(fee, 300) / 10000.0);
    artist_c := o.price_cents - krata_c;
    select * into ap from artist_payout where user_id = o.artist_id;
    select value into kkey from store_config where key = 'krata_pix_key';
    select value into ktype from store_config where key = 'krata_pix_type';
    if ap.user_id is not null and artist_c > 0 then
      insert into store_payouts (order_id, kind, user_id, pix_key, pix_type, cents, status)
      values (o.id, 'artist', o.artist_id, ap.pix_key, ap.pix_type, artist_c, case when p_manual then 'manual' else 'pending' end) on conflict do nothing;
    end if;
    if kkey is not null and krata_c > 0 then
      insert into store_payouts (order_id, kind, pix_key, pix_type, cents, status)
      values (o.id, 'krata', kkey, coalesce(ktype, 'phone'), krata_c, case when p_manual then 'manual' else 'pending' end) on conflict do nothing;
    end if;
  end if;
  return jsonb_build_object('order', o.id, 'payouts', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from store_payouts p where p.order_id = o.id and p.status = 'pending'));
end;
$$;

create or replace function public.store_payout_set(p_id uuid, p_status text, p_provider_id text default null, p_error text default '')
returns void language sql security definer set search_path = public as $$
  update public.store_payouts set status = p_status, provider_id = coalesce(p_provider_id, provider_id), error = left(coalesce(p_error, ''), 500), updated_at = now() where id = p_id;
$$;

-- só as rotas do servidor (chave de serviço) mexem em pedidos e repasses
revoke execute on function public.store_begin(uuid, uuid), public.store_attach(uuid, text, text, text, timestamptz),
  public.store_mark_paid(uuid, boolean), public.store_payout_set(uuid, text, text, text) from public, anon, authenticated;

-- o desenvolvedor pode confirmar um pagamento na mão (suporte ou teste) — os repasses ficam como "manual"
create or replace function public.dev_confirm_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_dev() then raise exception 'Só o desenvolvedor confirma pagamentos.'; end if;
  perform store_mark_paid(p_order, true);
end;
$$;

-- painel do artista: vendas por bundle
create or replace function public.artist_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sales', coalesce((select count(*) from store_orders o where o.artist_id = auth.uid() and o.status = 'paid'), 0),
    'gross_cents', coalesce((select sum(price_cents) from store_orders o where o.artist_id = auth.uid() and o.status = 'paid'), 0),
    'earned_cents', coalesce((select sum(cents) from store_payouts p where p.user_id = auth.uid() and p.kind = 'artist'), 0),
    'paid_out_cents', coalesce((select sum(cents) from store_payouts p where p.user_id = auth.uid() and p.kind = 'artist' and p.status in ('sent', 'done')), 0));
$$;

-- painel do desenvolvedor: números gerais
create or replace function public.dev_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_dev() then raise exception 'Só o desenvolvedor.'; end if;
  return jsonb_build_object(
    'pending_bundles', (select count(*) from bundles where status = 'pending'),
    'sales', (select count(*) from store_orders where status = 'paid'),
    'gross_cents', coalesce((select sum(price_cents) from store_orders where status = 'paid'), 0),
    'krata_cents', coalesce((select sum(cents) from store_payouts where kind = 'krata'), 0),
    'failed_payouts', (select count(*) from store_payouts where status = 'failed'));
end;
$$;

grant execute on function public.submit_bundle(text, text, text, text, integer, uuid), public.archive_bundle(uuid),
  public.review_bundle(uuid, boolean, integer, text), public.set_bundle_price(uuid, integer), public.set_pix_key(text, text),
  public.equip_bundle(uuid), public.dev_confirm_order(uuid), public.artist_stats(), public.dev_stats() to authenticated;

-- tempo real: o comprador vê o pagamento confirmar na hora; mudanças de moldura aparecem para todos
do $$ begin
  alter publication supabase_realtime add table public.store_orders;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.bundles;
exception when others then null; end $$;


-- cliente no Asaas (só o código dele; o CPF não fica guardado no Krata)
create table if not exists public.store_customers (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  provider_id text not null,
  created_at  timestamptz not null default now()
);
alter table public.store_customers enable row level security;
revoke all on public.store_customers from anon, authenticated;

-- pega um repasse para enviar (só uma rota envia cada um, mesmo se duas confirmarem juntas)
create or replace function public.store_payout_claim(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update store_payouts set status = 'sending', updated_at = now() where id = p_id and status = 'pending';
  return found;
end;
$$;
-- repasses que falharam podem ser tentados de novo pelo painel do desenvolvedor
create or replace function public.dev_retry_payout(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_dev() then raise exception 'Só o desenvolvedor.'; end if;
  update store_payouts set status = 'pending', error = '', updated_at = now() where id = p_id and status = 'failed';
end;
$$;
revoke execute on function public.store_payout_claim(uuid) from public, anon, authenticated;
grant execute on function public.dev_retry_payout(uuid) to authenticated;

-- =============================================================================
-- 14. SERVIDORES: notificações por servidor, @everyone/@here, descrição,
-- boas-vindas, modo lento e nomes de canal livres.
-- Rode este arquivo uma vez no SQL Editor do Supabase (depois de notificacoes.sql e push.sql).
-- =============================================================================

alter table public.servers add column if not exists description text not null default '';
alter table public.servers add column if not exists default_notify text not null default 'mentions';
alter table public.servers add column if not exists everyone_role text not null default 'admins';
alter table public.servers add column if not exists welcome_channel uuid references public.channels (id) on delete set null;
do $$ begin
  alter table public.servers add constraint servers_description_len check (char_length(description) <= 300);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.servers add constraint servers_default_notify_check check (default_notify in ('all', 'mentions', 'none'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.servers add constraint servers_everyone_role_check check (everyone_role in ('all', 'admins'));
exception when duplicate_object then null; end $$;
grant update (description, default_notify, everyone_role, welcome_channel) on public.servers to authenticated;

-- modo lento por canal (0 = desligado, até 6 h)
alter table public.channels add column if not exists slowmode integer not null default 0;
do $$ begin
  alter table public.channels add constraint channels_slowmode_check check (slowmode between 0 and 21600);
exception when duplicate_object then null; end $$;
grant update (slowmode) on public.channels to authenticated;

-- quando a pessoa usou o Krata pela última vez (para o @here avisar só quem está por aí)
alter table public.profiles add column if not exists active_at timestamptz;
create or replace function public.touch_active()
returns void language sql security definer set search_path = public as $$
  update public.profiles set active_at = now() where id = auth.uid() and (active_at is null or active_at < now() - interval '60 seconds');
$$;
grant execute on function public.touch_active() to authenticated;

-- ---------------------------------------------------------------- preferências por servidor
create table if not exists public.server_notify_prefs (
  user_id           uuid not null references public.profiles (id) on delete cascade,
  server_id         uuid not null references public.servers (id) on delete cascade,
  level             text check (level in ('all', 'mentions', 'none')),
  suppress_everyone boolean not null default false,
  updated_at        timestamptz not null default now(),
  primary key (user_id, server_id)
);
alter table public.server_notify_prefs enable row level security;
revoke all on public.server_notify_prefs from anon, authenticated;
grant select, insert, update, delete on public.server_notify_prefs to authenticated;
drop policy if exists server_notify_prefs_own on public.server_notify_prefs;
create policy server_notify_prefs_own on public.server_notify_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (select 1 from public.server_members m where m.server_id = server_notify_prefs.server_id and m.user_id = auth.uid()));

-- ---------------------------------------------------------------- quem é avisado de cada mensagem
create or replace function public.should_notify(p_uid uuid, p_message uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  m record; lvl text; sup boolean; uname text;
begin
  select msg.author_id, msg.content, msg.reply_to, msg.channel_id, c.server_id, s.default_notify, s.everyone_role
    into m
  from messages msg join channels c on c.id = msg.channel_id left join servers s on s.id = c.server_id
  where msg.id = p_message;
  if not found or m.author_id = p_uid then return false; end if;
  if m.server_id is null then
    return exists (select 1 from dm_members d where d.channel_id = m.channel_id and d.user_id = p_uid);
  end if;
  if not exists (select 1 from server_members sm where sm.server_id = m.server_id and sm.user_id = p_uid) then return false; end if;
  select pr.level, pr.suppress_everyone into lvl, sup from server_notify_prefs pr where pr.user_id = p_uid and pr.server_id = m.server_id;
  lvl := coalesce(lvl, m.default_notify, 'mentions');
  if lvl = 'none' then return false; end if;
  if lvl = 'all' then return true; end if;
  select username into uname from profiles where id = p_uid;
  if m.content ~* ('(^|\s)@' || regexp_replace(uname, '([.])', '\\\1', 'g') || '([^a-z0-9_.]|$)') then return true; end if;
  if m.reply_to is not null and exists (select 1 from messages r where r.id = m.reply_to and r.author_id = p_uid) then return true; end if;
  if coalesce(sup, false) then return false; end if;
  -- @everyone / @here só valem se quem mandou pode (padrão: só donos e admins)
  if not (m.everyone_role = 'all' or exists (select 1 from server_members a where a.server_id = m.server_id and a.user_id = m.author_id and a.role in ('owner', 'admin'))) then
    return false;
  end if;
  if m.content ~* '(^|\s)@(everyone|todos)([^a-z0-9_.]|$)' then return true; end if;
  if m.content ~* '(^|\s)@(here|aqui)([^a-z0-9_.]|$)' then
    return exists (select 1 from profiles p where p.id = p_uid and p.status <> 'invisible' and p.active_at > now() - interval '5 minutes');
  end if;
  return false;
end;
$$;
revoke execute on function public.should_notify(uuid, uuid) from public, anon, authenticated;

-- celular (app Android): mensagens novas + quando cada conversa foi lida (para não repetir as já vistas)
create or replace function public.device_inbox(p_secret text, p_after timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_me profiles%rowtype;
  v_since timestamptz := greatest(coalesce(p_after, now() - interval '10 minutes'), now() - interval '1 day');
  v_rows jsonb;
  v_reads jsonb;
begin
  select user_id into v_uid from devices where secret_hash = device_hash(p_secret);
  if v_uid is null then raise exception 'device_revoked' using errcode = 'P0001'; end if;
  update devices set last_seen = now() where secret_hash = device_hash(p_secret) and last_seen < now() - interval '1 minute';
  select * into v_me from profiles where id = v_uid;
  select coalesce(jsonb_object_agg(channel_id, last_read_at), '{}'::jsonb) into v_reads
    from read_states where user_id = v_uid and last_read_at > now() - interval '2 days';
  if v_me.status = 'dnd' then return jsonb_build_object('now', now(), 'dnd', true, 'messages', '[]'::jsonb, 'reads', v_reads); end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at), '[]'::jsonb) into v_rows from (
    select m.id, m.channel_id, c.server_id, m.created_at, left(m.content, 400) as content,
           jsonb_array_length(m.attachments) as files,
           p.display_name as author, p.username as author_username, p.avatar_url as author_avatar, p.accent_color as author_color,
           c.kind, c.name as channel_name, s.name as server_name, s.icon_url as server_icon,
           (select count(*) from dm_members d2 where d2.channel_id = c.id) as members
    from messages m
    join channels c on c.id = m.channel_id
    join profiles p on p.id = m.author_id
    left join servers s on s.id = c.server_id
    where m.created_at > v_since
      and m.author_id <> v_uid
      and not exists (select 1 from read_states r where r.user_id = v_uid and r.channel_id = m.channel_id and r.last_read_at >= m.created_at)
      and (
        (c.server_id is null and exists (select 1 from dm_members d where d.channel_id = c.id and d.user_id = v_uid))
        or (c.server_id is not null and exists (select 1 from server_members sm where sm.server_id = c.server_id and sm.user_id = v_uid)
            and should_notify(v_uid, m.id))
      )
    order by m.created_at
    limit 40
  ) t;
  return jsonb_build_object('now', now(), 'messages', v_rows, 'reads', v_reads);
end;
$$;
grant execute on function public.device_inbox(text, timestamptz) to anon, authenticated;

-- computador (Web Push): mesmas regras
create or replace function public.push_targets(p_message uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_count int;
  v_subs jsonb;
  v_group text;
begin
  select msg.id, msg.channel_id, msg.author_id, msg.content, msg.attachments, msg.reply_to, msg.created_at,
         c.kind, c.name as channel_name, c.server_id, s.name as server_name, s.icon_url as server_icon,
         p.display_name, p.username, p.avatar_url, p.accent_color
    into m
  from messages msg
  join channels c on c.id = msg.channel_id
  join profiles p on p.id = msg.author_id
  left join servers s on s.id = c.server_id
  where msg.id = p_message;
  if not found or m.created_at < now() - interval '5 minutes' then return null; end if;

  insert into push_sent (message_id) values (p_message) on conflict do nothing;
  get diagnostics v_count = row_count;
  if v_count = 0 then return null; end if;
  delete from push_sent where at < now() - interval '2 days';

  if m.kind = 'group' then
    select coalesce(nullif(m.channel_name, ''), string_agg(pr.display_name, ', ' order by pr.display_name)) into v_group
    from dm_members d join profiles pr on pr.id = d.user_id where d.channel_id = m.channel_id and d.user_id <> m.author_id;
  end if;

  with targets as (
    select d.user_id from dm_members d
    where m.server_id is null and d.channel_id = m.channel_id and d.user_id <> m.author_id
    union
    select sm.user_id from server_members sm
    where m.server_id is not null and sm.server_id = m.server_id and sm.user_id <> m.author_id and should_notify(sm.user_id, m.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), '[]'::jsonb)
    into v_subs
  from push_subscriptions ps
  join targets t on t.user_id = ps.user_id
  join profiles pr on pr.id = t.user_id
  where pr.status <> 'dnd';

  return jsonb_build_object(
    'message', jsonb_build_object(
      'id', m.id, 'channel_id', m.channel_id, 'server_id', m.server_id, 'kind', m.kind, 'created_at', m.created_at,
      'content', left(m.content, 600), 'attachments', m.attachments,
      'author', m.display_name, 'author_username', m.username, 'author_avatar', m.avatar_url, 'author_color', m.accent_color,
      'channel_name', m.channel_name, 'server_name', m.server_name, 'server_icon', m.server_icon, 'group_name', v_group,
      'reply_to_me', m.reply_to is not null),
    'subs', v_subs);
end;
$$;
revoke execute on function public.push_targets(uuid) from public, anon, authenticated;

-- o gatilho chama /api/push também quando alguém no servidor quer "todas as mensagens"
create or replace function public.messages_push() returns trigger language plpgsql security definer set search_path = public as $$
declare v_url text; v_server uuid;
begin
  if new.bot = 'welcome' then return new; end if;
  select server_id into v_server from channels where id = new.channel_id;
  if v_server is not null and new.reply_to is null and position('@' in new.content) = 0
     and not exists (select 1 from servers where id = v_server and default_notify = 'all')
     and not exists (select 1 from server_notify_prefs where server_id = v_server and level = 'all') then
    return new;
  end if;
  select value into v_url from app_config where key = 'push_url';
  if coalesce(v_url, '') = '' then return new; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using v_url, jsonb_build_object('id', new.id), jsonb_build_object('content-type', 'application/json');
  exception when others then null;
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------- modo lento + boas-vindas
alter table public.messages drop constraint if exists messages_bot_check;
alter table public.messages add constraint messages_bot_check check (bot is null or bot in ('prisma', 'welcome'));

create or replace function public.guard_message_insert()
returns trigger language plpgsql as $$
declare v_slow int; v_server uuid; v_last timestamptz;
begin
  new.created_at := now();
  new.edited_at := null;
  new.pinned := false;
  if current_user in ('authenticated', 'anon') then
    new.bot := null;
    select slowmode, server_id into v_slow, v_server from public.channels where id = new.channel_id;
    if coalesce(v_slow, 0) > 0 and not exists (select 1 from public.server_members where server_id = v_server and user_id = new.author_id and role in ('owner', 'admin')) then
      select max(created_at) into v_last from public.messages where channel_id = new.channel_id and author_id = new.author_id;
      if v_last is not null and v_last > now() - make_interval(secs => v_slow) then
        raise exception 'Modo lento: espere % s para mandar outra mensagem neste canal.', ceil(extract(epoch from (v_last + make_interval(secs => v_slow) - now())))::int;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.welcome_member() returns trigger language plpgsql security definer set search_path = public as $$
declare v_ch uuid;
begin
  if new.role <> 'member' then return new; end if;
  select welcome_channel into v_ch from servers where id = new.server_id;
  if v_ch is null or not exists (select 1 from channels where id = v_ch and server_id = new.server_id and kind = 'text') then return new; end if;
  insert into messages (channel_id, author_id, content, bot) values (v_ch, new.user_id, 'entrou no servidor', 'welcome');
  return new;
end;
$$;
drop trigger if exists server_members_welcome on public.server_members;
create trigger server_members_welcome after insert on public.server_members for each row execute function public.welcome_member();

-- canais de texto: nomes com espaços, acentos e emojis (até 50 caracteres)
do $$ begin
  -- "not valid": vale para os canais novos e renomeados (os antigos ficam como estão)
  alter table public.channels add constraint channels_name_clean check (kind not in ('text', 'voice') or (char_length(btrim(name)) between 1 and 50 and name !~ '[[:cntrl:]]')) not valid;
exception when duplicate_object then null;
end $$;
