create or replace function public.admin_get_auth_audit_logs(
  p_limit integer default 50,
  p_offset integer default 0,
  p_from timestamptz default null,
  p_user_id uuid default null,
  p_action text default null
)
returns table(
  id uuid,
  created_at timestamptz,
  user_id uuid,
  user_email text,
  action text,
  result text,
  ip_address text,
  user_agent text,
  auth_session_id uuid,
  metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
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
    coalesce(
      n.payload ->> 'action',
      n.payload ->> 'action_type',
      'unknown'
    ) as action,
    case
      when lower(coalesce(n.payload ->> 'result', n.payload #>> '{traits,result}', n.payload ->> 'status', n.payload #>> '{traits,status}', '')) in ('failed', 'failure', 'error', 'denied') then 'failed'
      when lower(coalesce(n.payload ->> 'result', n.payload #>> '{traits,result}', n.payload ->> 'status', n.payload #>> '{traits,status}', '')) in ('success', 'succeeded', 'ok') then 'success'
      when coalesce(n.payload ->> 'error', n.payload #>> '{traits,error}', n.payload #>> '{traits,reason}') is not null then 'failed'
      else null
    end as result,
    coalesce(nullif(n.ip_address, ''), sess.ip_address) as ip_address,
    coalesce(
      n.payload ->> 'user_agent',
      n.payload #>> '{traits,user_agent}',
      n.payload #>> '{traits,userAgent}',
      sess.user_agent
    ) as user_agent,
    coalesce(n.auth_session_id, sess.id) as auth_session_id,
    jsonb_strip_nulls(jsonb_build_object(
      'provider', coalesce(n.payload ->> 'provider', n.payload #>> '{traits,provider}'),
      'log_type', n.payload ->> 'log_type',
      'status', coalesce(n.payload ->> 'status', n.payload #>> '{traits,status}'),
      'reason', coalesce(n.payload ->> 'reason', n.payload #>> '{traits,reason}'),
      'method', coalesce(n.payload ->> 'method', n.payload #>> '{traits,method}')
    )) as metadata
  from normalized n
  left join public.user_roles ur on ur.user_id = n.user_id
  left join lateral (
    select
      s.id,
      nullif(s.ip::text, '') as ip_address,
      nullif(s.user_agent, '') as user_agent
    from auth.sessions s
    where s.user_id = n.user_id
      and (
        (n.auth_session_id is not null and s.id = n.auth_session_id)
        or (
          n.auth_session_id is null
          and s.created_at between n.created_at - interval '2 minutes'
                               and n.created_at + interval '2 minutes'
        )
      )
    order by
      case when n.auth_session_id is not null and s.id = n.auth_session_id then 0 else 1 end,
      abs(extract(epoch from (s.created_at - n.created_at)))
    limit 1
  ) sess on true
  where (p_from is null or n.created_at >= p_from)
    and (p_user_id is null or n.user_id = p_user_id)
    and (p_action is null or coalesce(n.payload ->> 'action', n.payload ->> 'action_type', 'unknown') = p_action)
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.admin_get_auth_audit_logs(integer, integer, timestamptz, uuid, text) from public, anon;
grant execute on function public.admin_get_auth_audit_logs(integer, integer, timestamptz, uuid, text) to authenticated;

comment on function public.admin_get_auth_audit_logs(integer, integer, timestamptz, uuid, text)
is 'Admin-only narrow projection of Supabase Auth audit logs enriched with nearby authoritative Auth session context; raw auth payload is never exposed.';
