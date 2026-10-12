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
