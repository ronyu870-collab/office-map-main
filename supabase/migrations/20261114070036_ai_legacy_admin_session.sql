-- Identity precondition for legacy AI paths. This does NOT grant a model,
-- data, export or audit capability; callers must retain their feature policy.
begin;
create or replace function private.ai_admin_session_authority(p_actor uuid, p_session uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users u join public.user_roles r on r.user_id = u.id
    where u.id = p_actor and r.role = 'admin' and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
    for share of u, r;
  if not found then return false; end if;
  perform 1 from auth.sessions s where s.id = p_session and s.user_id = p_actor
    and (s.not_after is null or s.not_after > clock_timestamp()) for share;
  return found;
end $$;
create or replace function public.ai_admin_session_authority(p_actor uuid, p_session uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.ai_admin_session_authority(p_actor, p_session);
$$;
revoke all on function private.ai_admin_session_authority(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ai_admin_session_authority(uuid, uuid) from public, anon, authenticated;
grant execute on function private.ai_admin_session_authority(uuid, uuid) to service_role;
grant execute on function public.ai_admin_session_authority(uuid, uuid) to service_role;
commit;
