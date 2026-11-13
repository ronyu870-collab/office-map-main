begin;
-- Prevent old writers from falling between historical observation and trigger installation.
lock table private.ai_audit_export_events in share row exclusive mode;
create table private.ai_audit_export_operations (
  export_id uuid primary key references private.ai_audit_export_events(event_id),
  prepare_id uuid unique references private.ai_audit_export_events(event_id),
  state text not null check(state in ('pending_generation','pending_report','denied','unavailable','generation_failed','generation_unconfirmed','delivery_unconfirmed','client_dispatch_reported')),
  due_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp()
);
create index ai_audit_export_operations_due on private.ai_audit_export_operations(due_at,export_id) where state in ('pending_generation','pending_report');
create table private.ai_audit_export_lifecycle (
  event_id uuid primary key default gen_random_uuid(),
  export_id uuid not null references private.ai_audit_export_operations(export_id),
  source_event_id uuid unique references private.ai_audit_export_events(event_id),
  occurred_at timestamptz not null default clock_timestamp(),
  previous_state text,
  state text not null,
  reason text not null check(reason in ('read_recorded','prepare_recorded','prepare_denied','client_dispatch_reported','generation_failed','generation_deadline','report_deadline','migration_observation')),
  executor text not null check(executor in ('export_service','system_reconciler','migration')),
  worker_ref text check(length(worker_ref) between 1 and 120)
);
alter table private.ai_audit_export_operations enable row level security;
alter table private.ai_audit_export_lifecycle enable row level security;
revoke all on private.ai_audit_export_operations,private.ai_audit_export_lifecycle from public,anon,authenticated,service_role;
-- Historical rows are observed now, not assigned invented historical terminal times.
insert into private.ai_audit_export_operations(export_id,prepare_id,state,due_at)
select r.event_id,p.event_id,case when r.outcome<>'allowed' then r.outcome when d.event_id is not null then 'client_dispatch_reported'
  when p.event_id is not null then 'pending_report' else 'pending_generation' end,clock_timestamp()+interval '10 minutes'
from private.ai_audit_export_events r
left join lateral (select event_id from private.ai_audit_export_events p where p.parent_id=r.event_id and p.phase='prepare' and p.outcome='allowed' order by p.occurred_at desc,p.event_id desc limit 1) p on true
left join lateral (select event_id from private.ai_audit_export_events d where d.parent_id=p.event_id and d.phase='client_dispatch' and d.outcome='allowed' limit 1) d on true
where r.phase='read';
insert into private.ai_audit_export_lifecycle(export_id,state,reason,executor)
select export_id,state,'migration_observation','migration' from private.ai_audit_export_operations;

create function private.ai_audit_export_observe() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent private.ai_audit_export_events;op private.ai_audit_export_operations;root_id uuid;next_state text;why text;
begin
  if new.phase='read' then
    next_state:=case when new.outcome='allowed' then 'pending_generation' else new.outcome end;
    insert into private.ai_audit_export_operations(export_id,state,due_at) values(new.event_id,next_state,clock_timestamp()+interval '3 minutes');
    insert into private.ai_audit_export_lifecycle(export_id,source_event_id,state,reason,executor)
      values(new.event_id,new.event_id,next_state,'read_recorded','export_service');
    return new;
  end if;
  select * into parent from private.ai_audit_export_events where event_id=new.parent_id;
  if not found or parent.actor_id<>new.actor_id or parent.effective_user_id<>new.effective_user_id or parent.session_id<>new.session_id then return new;end if;
  root_id:=case when parent.phase='read' then parent.event_id else parent.parent_id end;
  select * into op from private.ai_audit_export_operations where export_id=root_id for update;
  if not found then raise exception 'export observation missing';end if;
  if new.phase='prepare' and new.outcome='allowed' then
    if op.state<>'pending_generation' or op.due_at<=clock_timestamp() then raise exception 'export generation no longer pending';end if;
    next_state:='pending_report';why:='prepare_recorded';
  elsif new.phase='prepare' and new.outcome='denied' and op.state='pending_generation' then
    next_state:='denied';why:='prepare_denied';
  elsif new.phase='client_dispatch' and new.outcome='allowed' then
    if op.prepare_id is distinct from parent.event_id or op.state not in ('pending_report','delivery_unconfirmed') then raise exception 'export report state mismatch';end if;
    next_state:='client_dispatch_reported';why:='client_dispatch_reported';
  else return new;end if;
  update private.ai_audit_export_operations set state=next_state,updated_at=clock_timestamp(),
    prepare_id=case when why='prepare_recorded' then new.event_id else prepare_id end,
    due_at=case when why='prepare_recorded' then clock_timestamp()+interval '10 minutes' else due_at end where export_id=root_id;
  insert into private.ai_audit_export_lifecycle(export_id,source_event_id,previous_state,state,reason,executor)
    values(root_id,new.event_id,op.state,next_state,why,'export_service');
  return new;
end $$;
revoke all on function private.ai_audit_export_observe() from public,anon,authenticated,service_role;
create trigger ai_audit_export_observe after insert on private.ai_audit_export_events for each row execute function private.ai_audit_export_observe();

-- A failed service path may close only its own unprepared operation. It cannot
-- erase a prepare/report or claim delivery failed; no raw exception is retained.
create function private.ai_audit_export_fail(p_export uuid,p_actor uuid,p_session uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare op private.ai_audit_export_operations;
begin
  perform 1 from private.ai_audit_export_events where event_id=p_export and phase='read' and actor_id=p_actor and effective_user_id=p_actor and session_id=p_session;
  if not found then return false;end if;
  select * into op from private.ai_audit_export_operations where export_id=p_export for update;
  if not found or op.state<>'pending_generation' then return false;end if;
  update private.ai_audit_export_operations set state='generation_failed',updated_at=clock_timestamp() where export_id=p_export;
  insert into private.ai_audit_export_lifecycle(export_id,previous_state,state,reason,executor)
    values(p_export,op.state,'generation_failed','generation_failed','export_service');
  return true;
end $$;
revoke all on function private.ai_audit_export_fail(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.ai_audit_export_fail(uuid,uuid,uuid) to service_role;
create function public.ai_audit_export_fail(p_export uuid,p_actor uuid,p_session uuid) returns boolean
language sql security invoker set search_path='' as $$select private.ai_audit_export_fail(p_export,p_actor,p_session)$$;
revoke all on function public.ai_audit_export_fail(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_audit_export_fail(uuid,uuid,uuid) to service_role;

-- Each bounded batch is atomic. No business query, decrypt, file recreation,
-- model call, or user impersonation occurs. Concurrent workers skip locked rows.
create function private.ai_audit_export_reconcile(p_worker text,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare op private.ai_audit_export_operations;next_state text;items jsonb:='[]';
begin
  if p_worker is null or p_worker!~'^[A-Za-z0-9_.:-]{1,120}$' or p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid reconciliation bounds';end if;
  for op in select * from private.ai_audit_export_operations where state in ('pending_generation','pending_report') and due_at<=clock_timestamp()
    order by due_at,export_id limit p_limit for update skip locked loop
    if not exists(select 1 from private.ai_audit_export_events r where r.event_id=op.export_id and r.phase='read' and r.outcome='allowed')
      or not exists(select 1 from private.ai_audit_export_lifecycle h where h.export_id=op.export_id)
      or (op.state='pending_report' and not exists(select 1 from private.ai_audit_export_events p where p.event_id=op.prepare_id and p.parent_id=op.export_id and p.phase='prepare' and p.outcome='allowed'))
      or (op.state='pending_generation' and exists(select 1 from private.ai_audit_export_events p where p.parent_id=op.export_id and p.phase='prepare' and p.outcome='allowed'))
      or exists(select 1 from private.ai_audit_export_events d where d.parent_id=op.prepare_id and d.phase='client_dispatch' and d.outcome='allowed') then
      items:=items||jsonb_build_array(jsonb_build_object('exportId',op.export_id,'state','integrity_unavailable'));continue;
    end if;
    next_state:=case when op.state='pending_generation' then 'generation_unconfirmed' else 'delivery_unconfirmed' end;
    update private.ai_audit_export_operations set state=next_state,updated_at=clock_timestamp() where export_id=op.export_id;
    insert into private.ai_audit_export_lifecycle(export_id,previous_state,state,reason,executor,worker_ref)
      values(op.export_id,op.state,next_state,case when op.state='pending_generation' then 'generation_deadline' else 'report_deadline' end,'system_reconciler',p_worker);
    items:=items||jsonb_build_array(jsonb_build_object('exportId',op.export_id,'state',next_state));
  end loop;
  return jsonb_build_object('policy','audit-export-lifecycle/1','outcomes',items,'replayed',false);
end $$;
revoke all on function private.ai_audit_export_reconcile(text,integer) from public,anon,authenticated;
grant execute on function private.ai_audit_export_reconcile(text,integer) to service_role;
create function public.ai_audit_export_reconcile(p_worker text,p_limit integer) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_audit_export_reconcile(p_worker,p_limit)$$;
revoke all on function public.ai_audit_export_reconcile(text,integer) from public,anon,authenticated;
grant execute on function public.ai_audit_export_reconcile(text,integer) to service_role;

create function private.ai_audit_export_overview(p_since timestamptz) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare result jsonb;
begin
  if p_since is null or p_since<clock_timestamp()-interval '31 days' or p_since>clock_timestamp() then raise exception 'invalid overview window';end if;
  with roots as materialized (select event_id from private.ai_audit_export_events where phase='read' and occurred_at>=p_since)
  select jsonb_build_object('policy','audit-export-lifecycle/1','since',p_since,'reads',count(*),
    'missing_operations',count(*) filter(where o.export_id is null),
    'missing_history',count(*) filter(where not exists(select 1 from private.ai_audit_export_lifecycle h where h.export_id=r.event_id)),
    'pending',count(*) filter(where o.state in ('pending_generation','pending_report')),
    'overdue',count(*) filter(where o.state in ('pending_generation','pending_report') and o.due_at<=clock_timestamp()),
    'generation_unconfirmed',count(*) filter(where o.state='generation_unconfirmed'),
    'delivery_unconfirmed',count(*) filter(where o.state='delivery_unconfirmed'),
    'generation_failed',count(*) filter(where o.state='generation_failed'),
    'client_dispatch_reported',count(*) filter(where o.state='client_dispatch_reported'),
    'denied_or_unavailable',count(*) filter(where o.state in ('denied','unavailable')))
    into result from roots r left join private.ai_audit_export_operations o on o.export_id=r.event_id;
  return result;
end $$;
revoke all on function private.ai_audit_export_overview(timestamptz) from public,anon,authenticated;
grant execute on function private.ai_audit_export_overview(timestamptz) to service_role;
create function public.ai_audit_export_overview(p_since timestamptz) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_audit_export_overview(p_since)$$;
revoke all on function public.ai_audit_export_overview(timestamptz) from public,anon,authenticated;
grant execute on function public.ai_audit_export_overview(timestamptz) to service_role;

-- Application handshake requires durable lifecycle observation.
create or replace function private.ai_audit_export_control(p_actor uuid,p_effective uuid,p_session uuid,p_event uuid,p_phase text,
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
  return jsonb_build_object('allowed',true,'policy','audit-export/2','read_revision',read_rev,'export_revision',export_rev,
    'bundles',case when v_phase='read' then bundles else '[]'::jsonb end);
end $$;
commit;
