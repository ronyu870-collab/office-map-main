create or replace function private.sync_auth_session_audit_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.auth_session_audit_context (
    auth_session_id,
    user_id,
    first_seen_at,
    last_seen_at,
    auth_ip_address,
    auth_user_agent
  )
  values (
    new.id,
    new.user_id,
    new.created_at,
    greatest(new.created_at, coalesce(new.updated_at, new.created_at)),
    nullif(new.ip::text, ''),
    nullif(new.user_agent, '')
  )
  on conflict (auth_session_id) do update
  set
    user_id = excluded.user_id,
    last_seen_at = greatest(public.auth_session_audit_context.last_seen_at, excluded.last_seen_at),
    auth_ip_address = coalesce(excluded.auth_ip_address, public.auth_session_audit_context.auth_ip_address),
    auth_user_agent = coalesce(excluded.auth_user_agent, public.auth_session_audit_context.auth_user_agent);
  return new;
end;
$function$;

revoke all on function private.sync_auth_session_audit_context() from public, anon, authenticated;

drop trigger if exists auth_sessions_audit_context_sync on auth.sessions;
create trigger auth_sessions_audit_context_sync
after insert or update of updated_at, ip, user_agent on auth.sessions
for each row
execute function private.sync_auth_session_audit_context();

comment on function private.sync_auth_session_audit_context()
is 'Keeps a durable auth-session IP/User-Agent snapshot for audit enrichment without adding any request to the user-facing application.';
