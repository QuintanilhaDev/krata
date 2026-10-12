-- Krata: atualização (app Android). Rode uma vez no SQL Editor do Supabase.
-- Corrige pedidos de amizade mandados pelos dois ao mesmo tempo (virava erro; agora vira amizade).

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
