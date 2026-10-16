-- Krata 1.6 — loja + servidores. Rode tudo de uma vez no SQL Editor do Supabase (pode rodar de novo sem problema).
begin;
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
insert into public.staff (username, role) values ('bones', 'dev'), ('novacombos', 'artist')
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

commit;
