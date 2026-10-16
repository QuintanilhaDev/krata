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
