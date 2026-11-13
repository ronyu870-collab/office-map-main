-- Read-only AI execution repair. No AI activation, account grants or scheduler.
begin;
create table private.ai_query_execution_watch (
  request_id uuid primary key references private.ai_query_audit_streams(request_id),
  state text not null check(state in ('pending','settled')),
  last_sequence bigint not null,
  last_hash text not null,
  last_activity_at timestamptz not null,
  due_at timestamptz not null,
  lease_token uuid,
  lease_until timestamptz,
  worker_ref text,
  claim_count integer not null default 0 check(claim_count>=0),
  check((lease_token is null)=(lease_until is null))
);
create index ai_query_execution_due on private.ai_query_execution_watch(due_at,request_id) where state='pending';
create table private.ai_query_reconciliation_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references private.ai_query_audit_streams(request_id),
  occurred_at timestamptz not null default clock_timestamp(),
  action text not null check(action in ('claimed','settled')),
  lease_token uuid not null,
  worker_ref text not null check(length(worker_ref) between 1 and 120),
  expected_sequence bigint not null,
  expected_hash text not null,
  terminal_event_id uuid,
  payload_digest text,
  unique(lease_token,action)
);
create index ai_query_reconciliation_request on private.ai_query_reconciliation_events(request_id,id);
create index ai_query_ingress_reconcile_time on private.ai_query_ingress_events(occurred_at,request_id);
alter table private.ai_query_execution_watch enable row level security;
alter table private.ai_query_reconciliation_events enable row level security;
revoke all on private.ai_query_execution_watch,private.ai_query_reconciliation_events from public,anon,authenticated,service_role;
revoke all on sequence private.ai_query_reconciliation_events_id_seq from public,anon,authenticated,service_role;

-- Queue registration/progress/settlement commit with the original audit event.
-- All current handlers have <=30s execution deadlines; 180s is an inactivity
-- grace, not evidence of actual business failure or zero provider charges.
create function private.ai_query_watch_sync() returns trigger
language plpgsql security definer set search_path='' as $$
declare t timestamptz:=clock_timestamp();
begin
  insert into private.ai_query_execution_watch(request_id,state,last_sequence,last_hash,last_activity_at,due_at)
    values(new.request_id,case when new.state in ('received','running') then 'pending' else 'settled' end,new.head_sequence,new.head_hash,t,t+interval '180 seconds')
  on conflict(request_id) do update set state=excluded.state,last_sequence=excluded.last_sequence,last_hash=excluded.last_hash,
    last_activity_at=excluded.last_activity_at,due_at=excluded.due_at,lease_token=null,lease_until=null,worker_ref=null;
  return new;
end $$;
create trigger ai_query_watch_sync after insert or update of head_sequence,state on private.ai_query_audit_streams
  for each row execute function private.ai_query_watch_sync();
-- Upgrade gives existing incomplete requests a full grace interval. No rewrite
-- of the original event timestamp, identity or question/answer ciphertext.
insert into private.ai_query_execution_watch(request_id,state,last_sequence,last_hash,last_activity_at,due_at)
select request_id,'pending',head_sequence,head_hash,clock_timestamp(),clock_timestamp()+interval '180 seconds'
from private.ai_query_audit_streams where state in ('received','running');

create function private.ai_query_reconcile_claim(p_worker_ref text,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare w private.ai_query_execution_watch; s private.ai_query_audit_streams; token uuid; t timestamptz; result jsonb:='[]'::jsonb;
begin
  if p_worker_ref is null or p_worker_ref !~ '^[A-Za-z0-9_.:-]{1,120}$' or p_limit is null or p_limit not between 1 and 100
    then raise exception using errcode='22023',message='invalid reconciliation input'; end if;
  -- Lock stream before queue, the same order as normal append and settlement.
  -- SKIP LOCKED avoids waiting on live appenders/other repair workers.
  for s in select stream.* from private.ai_query_audit_streams stream join private.ai_query_execution_watch watch using(request_id)
    where stream.state in ('received','running') and watch.state='pending' and watch.due_at<=clock_timestamp()
      and (watch.lease_until is null or watch.lease_until<=clock_timestamp())
    order by watch.due_at,stream.request_id limit p_limit for update of stream skip locked loop
    select * into w from private.ai_query_execution_watch where request_id=s.request_id for update;
    if w.state<>'pending' or w.due_at>clock_timestamp() or w.lease_until>clock_timestamp() then continue; end if;
    t:=clock_timestamp();token:=gen_random_uuid();
    update private.ai_query_execution_watch set lease_token=token,lease_until=t+interval '60 seconds',worker_ref=p_worker_ref,claim_count=claim_count+1 where request_id=w.request_id;
    insert into private.ai_query_reconciliation_events(request_id,action,lease_token,worker_ref,expected_sequence,expected_hash)
      values(w.request_id,'claimed',token,p_worker_ref,w.last_sequence,w.last_hash);
    result:=result||jsonb_build_array(jsonb_build_object('request_id',w.request_id,'actor_id',s.actor_id,'effective_user_id',s.effective_user_id,
      'lease_token',token,'lease_until',t+interval '60 seconds','worker_ref',p_worker_ref,'expected_sequence',w.last_sequence,
      'expected_hash',w.last_hash,'due_at',w.due_at,'previous_state',s.state));
  end loop;
  return result;
end $$;

create function private.ai_query_reconcile_settle(p_request_id uuid,p_lease_token uuid,p_worker_ref text,p_event_id uuid,p_payload_digest text,p_cipher jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare s private.ai_query_audit_streams; w private.ai_query_execution_watch; prior private.ai_query_reconciliation_events; receipt jsonb;
begin
  perform private.ai_audit_check_cipher(p_cipher);
  if p_payload_digest is null or p_payload_digest !~ '^[0-9a-f]{64}$' or p_event_id is null then
    raise exception using errcode='22023',message='invalid reconciliation input'; end if;
  select * into s from private.ai_query_audit_streams where request_id=p_request_id for update;
  if not found then return jsonb_build_object('settled',false,'reason','stale'); end if;
  if not private.ai_query_audit_verify(s.request_id,s.head_hash,s.head_sequence)
    or s.state is distinct from (select kind from private.ai_query_audit_events where request_id=s.request_id
      and kind in ('received','running','succeeded','failed','denied','cancelled') order by sequence desc limit 1)
    then return jsonb_build_object('settled',false,'reason','integrity_unavailable'); end if;
  select * into prior from private.ai_query_reconciliation_events where request_id=p_request_id and lease_token=p_lease_token and action='settled';
  if found then
    if prior.worker_ref is distinct from p_worker_ref or prior.terminal_event_id is distinct from p_event_id or prior.payload_digest is distinct from p_payload_digest then
      raise exception using errcode='22023',message='reconciliation idempotency conflict'; end if;
    return jsonb_build_object('settled',true,'replayed',true,'event_id',prior.terminal_event_id);
  end if;
  select * into w from private.ai_query_execution_watch where request_id=p_request_id for update;
  if not found or w.state<>'pending' or s.state not in ('received','running') or w.lease_token is distinct from p_lease_token
    or w.worker_ref is distinct from p_worker_ref or w.lease_until<=clock_timestamp() or w.due_at>clock_timestamp()
    or w.last_sequence<>s.head_sequence or w.last_hash<>s.head_hash or p_lease_token is null
    then return jsonb_build_object('settled',false,'reason','stale'); end if;
  -- This append, its watch trigger, and settlement evidence are one transaction.
  receipt:=private.ai_query_audit_append(p_request_id,p_event_id,'failed',p_payload_digest,p_cipher);
  insert into private.ai_query_reconciliation_events(request_id,action,lease_token,worker_ref,expected_sequence,expected_hash,terminal_event_id,payload_digest)
    values(p_request_id,'settled',p_lease_token,p_worker_ref,w.last_sequence,w.last_hash,p_event_id,p_payload_digest);
  return jsonb_build_object('settled',true,'replayed',false,'event_id',p_event_id);
end $$;

-- Cross-check the independent ingress ledger against audit streams. Both live
-- in this database: this is not an independently anchored tamper-proof count.
-- Orphans cannot recreate absent plaintext; surface them, never invent it.
create function private.ai_query_reconcile_overview(p_since timestamptz) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare result jsonb;
begin
  if p_since is null or p_since>clock_timestamp() or p_since<clock_timestamp()-interval '31 days'
    then raise exception using errcode='22023',message='invalid reconciliation range'; end if;
  select jsonb_build_object('as_of',clock_timestamp(),'since',p_since,
    'ingress_attempts',(select count(*) from private.ai_query_ingress_events where occurred_at>=p_since),
    'authenticated_attempts',(select count(*) from private.ai_query_ingress_events where occurred_at>=p_since and reason='request_received' and actor_id is not null),
    'distinct_authenticated_requests',(select count(distinct request_id) from private.ai_query_ingress_events where occurred_at>=p_since and reason='request_received' and actor_id is not null),
    'terminal_streams',(select count(*) from private.ai_query_audit_streams where received_at>=p_since and state not in ('received','running')),
    'pending_streams',(select count(*) from private.ai_query_audit_streams where received_at>=p_since and state in ('received','running')),
    'due_streams',(select count(*) from private.ai_query_execution_watch w join private.ai_query_audit_streams s using(request_id) where s.received_at>=p_since and w.state='pending' and w.due_at<=clock_timestamp()),
    'missing_watch',(select count(*) from private.ai_query_audit_streams s where received_at>=p_since and state in ('received','running') and not exists(select 1 from private.ai_query_execution_watch w where w.request_id=s.request_id and w.state='pending')),
    'orphan_ingress_attempts',(select count(*) from private.ai_query_ingress_events i where occurred_at>=p_since and occurred_at<clock_timestamp()-interval '180 seconds' and reason='request_received' and actor_id is not null and not exists(select 1 from private.ai_query_audit_streams s where s.request_id=i.request_id)),
    'orphan_sample',coalesce((select jsonb_agg(x) from (select i.event_id,i.request_id,i.occurred_at from private.ai_query_ingress_events i
      where occurred_at>=p_since and occurred_at<clock_timestamp()-interval '180 seconds' and reason='request_received' and actor_id is not null
      and not exists(select 1 from private.ai_query_audit_streams s where s.request_id=i.request_id) order by occurred_at,event_id limit 100) x),'[]'::jsonb)) into result;
  return result;
end $$;

create function public.ai_query_reconcile_claim(p_worker_ref text,p_limit integer default 20) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_query_reconcile_claim(p_worker_ref,p_limit)$$;
create function public.ai_query_reconcile_settle(p_request_id uuid,p_lease_token uuid,p_worker_ref text,p_event_id uuid,p_payload_digest text,p_cipher jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_query_reconcile_settle(p_request_id,p_lease_token,p_worker_ref,p_event_id,p_payload_digest,p_cipher)$$;
create function public.ai_query_reconcile_overview(p_since timestamptz) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_query_reconcile_overview(p_since)$$;
revoke all on function private.ai_query_watch_sync() from public,anon,authenticated,service_role;
revoke all on function private.ai_query_reconcile_claim(text,integer),public.ai_query_reconcile_claim(text,integer),
  private.ai_query_reconcile_settle(uuid,uuid,text,uuid,text,jsonb),public.ai_query_reconcile_settle(uuid,uuid,text,uuid,text,jsonb),
  private.ai_query_reconcile_overview(timestamptz),public.ai_query_reconcile_overview(timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_reconcile_claim(text,integer),public.ai_query_reconcile_claim(text,integer),
  private.ai_query_reconcile_settle(uuid,uuid,text,uuid,text,jsonb),public.ai_query_reconcile_settle(uuid,uuid,text,uuid,text,jsonb),
  private.ai_query_reconcile_overview(timestamptz),public.ai_query_reconcile_overview(timestamptz) to service_role;
commit;
