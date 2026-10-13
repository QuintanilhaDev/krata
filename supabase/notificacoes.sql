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

-- mensagens novas para o aparelho: conversas privadas e grupos sempre; servidores com @menção, @todos ou resposta a uma mensagem sua
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
