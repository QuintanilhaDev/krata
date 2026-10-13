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
