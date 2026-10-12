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
