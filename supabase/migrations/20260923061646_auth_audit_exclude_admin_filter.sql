begin;

drop function if exists public.admin_get_auth_audit_logs(integer, integer, timestamp with time zone, uuid, text);

CREATE OR REPLACE FUNCTION public.admin_get_auth_audit_logs(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_user_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_exclude_admins boolean DEFAULT false)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, user_id uuid, user_email text, action text, result text, ip_address text, user_agent text, auth_session_id uuid, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with parsed as (
    select
      a.id,
      a.created_at,
      a.ip_address::text as ip_address,
      a.payload::jsonb as payload,
      coalesce(
        a.payload::jsonb ->> 'user_id',
        a.payload::jsonb ->> 'actor_id',
        a.payload::jsonb #>> '{actor,id}',
        a.payload::jsonb #>> '{traits,user_id}'
      ) as user_id_text,
      coalesce(
        a.payload::jsonb ->> 'session_id',
        a.payload::jsonb #>> '{traits,session_id}'
      ) as session_id_text
    from auth.audit_log_entries a
  ), normalized as (
    select
      p.id,
      p.created_at,
      p.ip_address,
      p.payload,
      case
        when p.user_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then p.user_id_text::uuid
        else null
      end as user_id,
      case
        when p.session_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then p.session_id_text::uuid
        else null
      end as auth_session_id
    from parsed p
  )
  select
    n.id,
    n.created_at,
    n.user_id,
    coalesce(
      ur.email,
      n.payload ->> 'actor_username',
      n.payload #>> '{traits,email}'
    ) as user_email,
    coalesce(n.payload ->> 'action', n.payload ->> 'action_type', 'unknown') as action,
    case
      when lower(coalesce(n.payload ->> 'result', n.payload #>> '{traits,result}', n.payload ->> 'status', n.payload #>> '{traits,status}', '')) in ('failed', 'failure', 'error', 'denied') then 'failed'
      when lower(coalesce(n.payload ->> 'result', n.payload #>> '{traits,result}', n.payload ->> 'status', n.payload #>> '{traits,status}', '')) in ('success', 'succeeded', 'ok') then 'success'
      when coalesce(n.payload ->> 'error', n.payload #>> '{traits,error}', n.payload #>> '{traits,reason}') is not null then 'failed'
      else null
    end as result,
    coalesce(
      nullif(n.ip_address, ''),
      live_session.ip_address,
      snapshot.auth_ip_address,
      snapshot.application_ip_address
    ) as ip_address,
    coalesce(
      n.payload ->> 'user_agent',
      n.payload #>> '{traits,user_agent}',
      n.payload #>> '{traits,userAgent}',
      live_session.user_agent,
      snapshot.auth_user_agent,
      snapshot.application_user_agent
    ) as user_agent,
    coalesce(n.auth_session_id, live_session.id, snapshot.auth_session_id) as auth_session_id,
    jsonb_strip_nulls(jsonb_build_object(
      'provider', coalesce(n.payload ->> 'provider', n.payload #>> '{traits,provider}'),
      'log_type', n.payload ->> 'log_type',
      'status', coalesce(n.payload ->> 'status', n.payload #>> '{traits,status}'),
      'reason', coalesce(n.payload ->> 'reason', n.payload #>> '{traits,reason}'),
      'method', coalesce(n.payload ->> 'method', n.payload #>> '{traits,method}'),
      'context_source', case
        when nullif(n.ip_address, '') is not null then 'auth_audit'
        when live_session.ip_address is not null then 'auth_session'
        when snapshot.auth_ip_address is not null then 'session_snapshot_auth'
        when snapshot.application_ip_address is not null then 'session_snapshot_application'
        else null
      end,
      'application_ip_address', snapshot.application_ip_address,
      'auth_ip_address', coalesce(live_session.ip_address, snapshot.auth_ip_address)
    )) as metadata
  from normalized n
  left join public.user_roles ur on ur.user_id = n.user_id
  left join lateral (
    select
      s.id,
      nullif(s.ip::text, '') as ip_address,
      nullif(s.user_agent, '') as user_agent,
      s.created_at,
      s.updated_at
    from auth.sessions s
    where s.user_id = n.user_id
      and (
        (n.auth_session_id is not null and s.id = n.auth_session_id)
        or (
          n.auth_session_id is null
          and (
            abs(extract(epoch from (coalesce(s.updated_at, s.created_at) - n.created_at))) <= 600
            or s.created_at between n.created_at - interval '2 minutes' and n.created_at + interval '2 minutes'
          )
        )
      )
    order by
      case when n.auth_session_id is not null and s.id = n.auth_session_id then 0 else 1 end,
      least(
        abs(extract(epoch from (coalesce(s.updated_at, s.created_at) - n.created_at))),
        abs(extract(epoch from (s.created_at - n.created_at)))
      )
    limit 1
  ) live_session on true
  left join lateral (
    select c.*
    from public.auth_session_audit_context c
    where c.user_id = n.user_id
      and (
        (n.auth_session_id is not null and c.auth_session_id = n.auth_session_id)
        or (
          n.auth_session_id is null
          and c.first_seen_at <= n.created_at + interval '5 minutes'
          and c.last_seen_at between n.created_at - interval '7 days' and n.created_at + interval '7 days'
        )
      )
    order by
      case when n.auth_session_id is not null and c.auth_session_id = n.auth_session_id then 0 else 1 end,
      abs(extract(epoch from (c.last_seen_at - n.created_at)))
    limit 1
  ) snapshot on true
  where (p_from is null or n.created_at >= p_from)
    and (p_user_id is null or n.user_id = p_user_id)
    and (not coalesce(p_exclude_admins, false) or lower(coalesce(ur.role, '')) not in ('admin', 'super_admin'))
    and (p_action is null or coalesce(n.payload ->> 'action', n.payload ->> 'action_type', 'unknown') = p_action)
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$
;

revoke all on function public.admin_get_auth_audit_logs(integer, integer, timestamp with time zone, uuid, text, boolean) from public;
grant execute on function public.admin_get_auth_audit_logs(integer, integer, timestamp with time zone, uuid, text, boolean) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
