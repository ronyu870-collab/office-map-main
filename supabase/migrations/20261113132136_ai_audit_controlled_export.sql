begin;
-- Shared raw snapshot reader. Only function owners may call it; authority and
-- access-ledger writes are mandatory in its two public-facing wrappers.
create function private.ai_audit_console_snapshot(p_filter jsonb) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare action text; outcome text:='denied'; records jsonb:='[]'; record_ids uuid[]:='{}';
  s private.ai_query_audit_streams; stream jsonb; has_more boolean:=false; f timestamptz; t timestamptz;
  before_time timestamptz; before_id uuid; who uuid; target uuid; status_filter text; entry_filter text;
  n bigint; bytes bigint; actor_search text;
begin
  action:=case when p_filter->>'action' in ('list','intake','stream') then p_filter->>'action' else 'invalid' end;
  if action='invalid' then return jsonb_build_object('outcome','denied','records','[]'::jsonb,'record_ids','[]'::jsonb,'has_more',false,'stream',null);end if;
    outcome:='allowed';
    if action='list' then
      f:=(p_filter->>'from')::timestamptz;t:=(p_filter->>'to')::timestamptz;
      before_time:=(p_filter->>'beforeTime')::timestamptz;before_id:=(p_filter->>'beforeId')::uuid;
      actor_search:=nullif(btrim(p_filter->>'actorSearch'),'');
      if length(actor_search)>120 then raise exception using errcode='22023',message='invalid actor search';end if;
      who:=(p_filter->>'actorId')::uuid;status_filter:=p_filter->>'state';entry_filter:=p_filter->>'entry';
      if f is null or t is null or t<=f or t-f>interval '31 days' or t>clock_timestamp()+interval '1 minute'
        or (before_time is null)<>(before_id is null) then raise exception using errcode='22023',message='invalid audit range';end if;
      with candidates as (
        select i.event_id record_id,i.request_id,i.occurred_at,i.actor_id,coalesce(i.effective_user_id,q.effective_user_id,i.actor_id) effective_user_id,
          'intake'::text kind,coalesce(i.entry,'legacy_intake') entry,coalesce(q.state,'unstarted') related_state,
          i.cipher,i.content_digest payload_digest
          from private.ai_query_ingress_events i left join private.ai_query_audit_streams q using(request_id) where i.actor_id is not null
        union all
        select q.request_id,q.request_id,q.received_at,q.actor_id,q.effective_user_id,'stream','legacy_stream',q.state,null::jsonb,null::text
          from private.ai_query_audit_streams q where not exists(select 1 from private.ai_query_ingress_events i where i.request_id=q.request_id)
      ) , identified as (
        select c.*,nullif(concat_ws(' / ',nullif(btrim(r.chinese_name),''),
          case when btrim(r.full_name) is distinct from btrim(r.chinese_name) then nullif(btrim(r.full_name),'') end),'') actor_name,
          nullif(concat_ws(' / ',nullif(btrim(e.chinese_name),''),
          case when btrim(e.full_name) is distinct from btrim(e.chinese_name) then nullif(btrim(e.full_name),'') end),'') effective_name
        from candidates c
        left join auth.users u on u.id=c.actor_id and u.deleted_at is null
        left join public.user_roles r on r.user_id=u.id
        left join auth.users eu on eu.id=c.effective_user_id and eu.deleted_at is null
        left join public.user_roles e on e.user_id=eu.id
      ), page as materialized (
        select c.* from identified c where c.occurred_at>=f and c.occurred_at<t
          and (who is null or c.actor_id=who)
          and (actor_search is null or position(lower(actor_search) in lower(coalesce(c.actor_name,'')))>0) and (status_filter is null or c.related_state=status_filter)
          and (entry_filter is null or c.entry=entry_filter)
          and (before_time is null or (c.occurred_at,c.record_id)<(before_time,before_id))
        order by occurred_at desc,record_id desc limit 51
      ) select coalesce(jsonb_agg((to_jsonb(p)-'actor_name'-'effective_name')||jsonb_build_object('actor_name',left(p.actor_name,160),'actor_name_truncated',coalesce(length(p.actor_name)>160,false),'effective_name',left(p.effective_name,160),'effective_name_truncated',coalesce(length(p.effective_name)>160,false)) order by occurred_at desc,record_id desc),'[]'),coalesce(array_agg(record_id order by occurred_at desc,record_id desc),'{}'),count(*)>50
        into records,record_ids,has_more from page p;
      -- Legacy stream text is read only after complete chain verification.
      for s in select q.* from private.ai_query_audit_streams q where q.request_id=any(record_ids) loop
        if s.head_sequence between 1 and 2048 and private.ai_query_audit_verify(s.request_id,s.head_hash,s.head_sequence) then
          records:=(select jsonb_agg(case when x->>'kind'='stream' and x->>'request_id'=s.request_id::text then
            x||jsonb_build_object('cipher',e.cipher,'payload_digest',e.payload_digest,'event_id',e.event_id) else x end order by ord)
            from jsonb_array_elements(records) with ordinality a(x,ord)
            left join private.ai_query_audit_events e on e.request_id=s.request_id and e.sequence=1);
        end if;
      end loop;
      if has_more then records:=records-50;record_ids:=record_ids[1:50];end if;
    elsif action='intake' then
      target:=(p_filter->>'id')::uuid;
      select coalesce(jsonb_agg(to_jsonb(i)),'[]'),coalesce(array_agg(event_id),'{}') into records,record_ids
        from private.ai_query_ingress_events i where i.event_id=target and i.actor_id is not null;
    else
      target:=(p_filter->>'id')::uuid;
      select * into s from private.ai_query_audit_streams where request_id=target for share;
      if found then
        select count(*),coalesce(sum(octet_length(cipher::text)),0) into n,bytes
          from (select cipher from private.ai_query_audit_events where request_id=target order by sequence limit 2049) e;
        if n between 1 and 2048 and bytes<=64*1024*1024
          and s.state=(select kind from private.ai_query_audit_events where request_id=target and kind in ('received','running','succeeded','failed','denied','cancelled') order by sequence desc limit 1)
          and private.ai_query_audit_verify(target,s.head_hash,s.head_sequence) then
          stream:=to_jsonb(s);record_ids:=array[target];
          select jsonb_agg(to_jsonb(e) order by sequence) into records from private.ai_query_audit_events e where request_id=target;
        else outcome:='unavailable';end if;
      end if;
    end if;
  return jsonb_build_object('outcome',outcome,'records',records,'record_ids',record_ids,'stream',stream,'has_more',has_more);
end $$;
revoke all on function private.ai_audit_console_snapshot(jsonb) from public,anon,authenticated,service_role;

create or replace function private.ai_audit_console_read(p_actor uuid,p_effective uuid,p_session uuid,p_access_id uuid,
  p_filter jsonb,p_content_digest text,p_cipher jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare rev uuid; action text; result jsonb; outcome text:='denied'; ids uuid[]:='{}';
begin
  perform private.ai_audit_check_cipher(p_cipher);
  action:=case when p_filter->>'action' in ('list','intake','stream') then p_filter->>'action' else 'invalid' end;
  rev:=private.ai_audit_console_authority(p_actor,p_effective,p_session);
  if rev is not null and action<>'invalid' then
    result:=private.ai_audit_console_snapshot(p_filter);outcome:=result->>'outcome';
    select coalesce(array_agg(x::uuid),'{}') into ids from jsonb_array_elements_text(result->'record_ids') x;
  end if;
  insert into private.ai_audit_console_access(access_id,actor_id,effective_user_id,session_id,action,outcome,grant_revision,content_digest,cipher,record_ids)
    values(p_access_id,p_actor,p_effective,p_session,action,outcome,rev,p_content_digest,p_cipher,ids);
  if outcome<>'allowed' then return jsonb_build_object('allowed',false,'unavailable',outcome='unavailable');end if;
  return jsonb_build_object('allowed',true,'access_policy','admin-only/1','directory_policy','audit-actors/1','directory_as_of',statement_timestamp(),
    'revision',rev,'records',result->'records','stream',result->'stream','has_more',(result->>'has_more')::boolean);
end $$;

create table private.ai_audit_export_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  valid_until timestamptz not null,
  grant_reference text not null check(length(btrim(grant_reference)) between 1 and 500),
  revision uuid not null default gen_random_uuid()
);
create trigger ai_audit_export_grant_changes before insert or update or delete on private.ai_audit_export_grants
  for each row execute function private.ai_query_policy_change();
alter table private.ai_audit_export_grants enable row level security;
revoke all on private.ai_audit_export_grants from public,anon,authenticated,service_role;

create table private.ai_audit_export_events (
  event_id uuid primary key,
  parent_id uuid references private.ai_audit_export_events(event_id),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,effective_user_id uuid not null,session_id uuid not null,
  phase text not null check(phase in ('read','prepare','client_dispatch')),
  outcome text not null check(outcome in ('allowed','denied','unavailable')),
  read_revision uuid,export_revision uuid,
  targets jsonb not null default '[]' check(jsonb_typeof(targets)='array' and jsonb_array_length(targets)<=50),
  content_digest text check(content_digest ~ '^[0-9a-f]{64}$'),cipher jsonb,
  file_digest text check(file_digest ~ '^[0-9a-f]{64}$'),file_bytes bigint check(file_bytes between 1 and 67108864),
  check((phase='read' and parent_id is null and cipher is not null and content_digest is not null)
    or (phase<>'read' and cipher is null))
);
alter table private.ai_audit_export_events enable row level security;
revoke all on private.ai_audit_export_events from public,anon,authenticated,service_role;
create unique index ai_audit_export_dispatch_once on private.ai_audit_export_events(parent_id)
  where phase='client_dispatch' and outcome='allowed';

create function private.ai_audit_export_authority(p_actor uuid,p_effective uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare read_rev uuid;export_rev uuid;
begin
  read_rev:=private.ai_audit_console_authority(p_actor,p_effective,p_session);
  if read_rev is null then return null;end if;
  select revision into export_rev from private.ai_audit_export_grants
    where user_id=p_actor and enabled and valid_until>clock_timestamp() for share;
  if export_rev is null then return null;end if;
  return jsonb_build_object('read_revision',read_rev,'export_revision',export_rev);
end $$;
revoke all on function private.ai_audit_export_authority(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- read: bounded selected audit snapshots. prepare: current grants + exact file bytes.
-- client_dispatch records a software report only; never asserts a human read or disk save.
create function private.ai_audit_export_control(p_actor uuid,p_effective uuid,p_session uuid,p_event uuid,p_phase text,
 p_parent uuid,p_targets jsonb,p_digest text,p_bytes bigint,p_cipher jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='25s' as $$
declare authority jsonb;prior private.ai_audit_export_events;v_outcome text:='denied';v_phase text;
  target jsonb;selected jsonb:='[]';bundles jsonb:='[]';intake jsonb;stream jsonb;request_id uuid;
  n int;total_bytes bigint:=0;read_rev uuid;export_rev uuid;valid boolean:=false;
begin
  v_phase:=case when p_phase in ('prepare','client_dispatch') then p_phase else 'read' end;
  if v_phase='read' then perform private.ai_audit_check_cipher(p_cipher);end if;
  authority:=private.ai_audit_export_authority(p_actor,p_effective,p_session);
  read_rev:=(authority->>'read_revision')::uuid;export_rev:=(authority->>'export_revision')::uuid;
  if v_phase='read' then
    if jsonb_typeof(p_targets)='array' and jsonb_array_length(p_targets) between 1 and 50 then
      select count(distinct value::text) into n from jsonb_array_elements(p_targets);
      valid:=n=jsonb_array_length(p_targets) and not exists(select 1 from jsonb_array_elements(p_targets) x
        where jsonb_typeof(x)<>'object' or x->>'kind' not in ('intake','stream') or x->>'kind' is null
        or x->>'id' is null or (x->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or x - 'kind' - 'id'<>'{}'::jsonb);
    end if;
    if valid then selected:=p_targets;end if;
    if authority is not null and valid and p_phase='read' then
      v_outcome:='allowed';
      for target in select value from jsonb_array_elements(selected) loop
        intake:=null;stream:=null;request_id:=null;
        if target->>'kind'='intake' then
          intake:=private.ai_audit_console_snapshot(jsonb_build_object('action','intake','id',target->>'id'));
          if intake->>'outcome'<>'allowed' or jsonb_array_length(intake->'records')<>1 then v_outcome:='unavailable';exit;end if;
          request_id:=(intake->'records'->0->>'request_id')::uuid;
        else request_id:=(target->>'id')::uuid;end if;
        stream:=private.ai_audit_console_snapshot(jsonb_build_object('action','stream','id',request_id));
        if stream->>'outcome'<>'allowed' or (target->>'kind'='stream' and stream->'stream'='null'::jsonb) then v_outcome:='unavailable';exit;end if;
        total_bytes:=total_bytes+octet_length(coalesce(intake::text,''))+octet_length(stream::text);
        if total_bytes>67108864 then v_outcome:='unavailable';exit;end if;
        bundles:=bundles||jsonb_build_array(jsonb_build_object('target',target,'request_id',request_id,
          'captured_at',clock_timestamp(),'intake',intake,'stream',stream));
      end loop;
    end if;
  else
    select * into prior from private.ai_audit_export_events where event_id=p_parent;
    if found then selected:=prior.targets;end if;
    valid:=authority is not null and prior.outcome='allowed' and prior.actor_id=p_actor and prior.effective_user_id=p_effective
      and prior.session_id=p_session and prior.read_revision=read_rev and prior.export_revision=export_rev
      and p_digest ~ '^[0-9a-f]{64}$' and p_bytes between 1 and 67108864
      and ((v_phase='prepare' and prior.phase='read') or
        (v_phase='client_dispatch' and prior.phase='prepare' and prior.file_digest=p_digest and prior.file_bytes=p_bytes));
    if coalesce(valid,false) then v_outcome:='allowed';end if;
  end if;
  insert into private.ai_audit_export_events(event_id,parent_id,actor_id,effective_user_id,session_id,phase,outcome,
    read_revision,export_revision,targets,content_digest,cipher,file_digest,file_bytes)
    values(p_event,case when v_phase='read' then null else prior.event_id end,p_actor,p_effective,p_session,v_phase,v_outcome,
      read_rev,export_rev,selected,case when v_phase='read' then p_digest end,case when v_phase='read' then p_cipher end,
      case when v_phase<>'read' then p_digest end,case when v_phase<>'read' then p_bytes end)
    on conflict(parent_id) where phase='client_dispatch' and outcome='allowed' do nothing;
  if v_outcome<>'allowed' then return jsonb_build_object('allowed',false,'unavailable',v_outcome='unavailable');end if;
  return jsonb_build_object('allowed',true,'policy','audit-export/1','read_revision',read_rev,'export_revision',export_rev,
    'bundles',case when v_phase='read' then bundles else '[]'::jsonb end);
end $$;
revoke all on function private.ai_audit_export_control(uuid,uuid,uuid,uuid,text,uuid,jsonb,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function private.ai_audit_export_control(uuid,uuid,uuid,uuid,text,uuid,jsonb,text,bigint,jsonb) to service_role;
create function public.ai_audit_export_control(p_actor uuid,p_effective uuid,p_session uuid,p_event uuid,p_phase text,
 p_parent uuid,p_targets jsonb,p_digest text,p_bytes bigint,p_cipher jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_audit_export_control(p_actor,p_effective,p_session,p_event,p_phase,p_parent,p_targets,p_digest,p_bytes,p_cipher)$$;
revoke all on function public.ai_audit_export_control(uuid,uuid,uuid,uuid,text,uuid,jsonb,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.ai_audit_export_control(uuid,uuid,uuid,uuid,text,uuid,jsonb,text,bigint,jsonb) to service_role;
commit;
