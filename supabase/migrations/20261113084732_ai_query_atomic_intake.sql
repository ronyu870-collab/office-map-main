begin;
-- Keep the existing attempt ledger; no parallel plaintext store. Old rows stay
-- explicitly without content, never backfilled with a guessed original body.
alter table private.ai_query_ingress_events
  add column effective_user_id uuid,
  add column entry text,
  add column content_digest text,
  add column cipher jsonb,
  add constraint ai_query_intake_content_shape check (
    (effective_user_id is null and entry is null and content_digest is null and cipher is null)
    or (effective_user_id is not null and entry is not null and content_digest is not null and cipher is not null
      and actor_id is not null and session_id is not null and reason='request_received'
      and body_complete and digest_scope='complete' and bytes_observed<=24576
      and entry in ('query_submission','query_result_recovery','query_result_artifact','query_delivery_report')
      and content_digest ~ '^[0-9a-f]{64}$'));

-- Once upgraded, callers cannot use the old content-free API for a verified
-- submission. Old application builds fail closed until the new route is deployed.
create or replace function private.ai_query_record_ingress(p_event_id uuid,p_request_id uuid,p_actor uuid,p_session uuid,p_reason text,p_bytes bigint,p_complete boolean,p_digest text,p_digest_scope text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_reason='request_received' or p_actor is not null or p_session is not null
    then raise exception using errcode='22023',message='protected intake required';end if;
  insert into private.ai_query_ingress_events(event_id,request_id,actor_id,session_id,reason,bytes_observed,body_complete,body_digest,digest_scope)
  values(p_event_id,p_request_id,p_actor,p_session,p_reason,p_bytes,p_complete,p_digest,p_digest_scope);
end $$;

create function private.ai_query_record_intake(
  p_event_id uuid,p_request_id uuid,p_actor uuid,p_session uuid,p_reason text,
  p_bytes bigint,p_complete boolean,p_digest text,p_digest_scope text,
  p_effective uuid,p_entry text,p_content_digest text,p_cipher jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare existing private.ai_query_ingress_events;
begin
  if p_actor is null or p_effective is null or p_session is null or p_entry is null
    or p_content_digest is null or p_reason is distinct from 'request_received'
    or p_complete is distinct from true or p_digest_scope is distinct from 'complete'
  then raise exception using errcode='22023',message='invalid intake envelope';end if;
  perform private.ai_audit_check_cipher(p_cipher);
  insert into private.ai_query_ingress_events(event_id,request_id,actor_id,session_id,reason,bytes_observed,
    body_complete,body_digest,digest_scope,effective_user_id,entry,content_digest,cipher)
  values(p_event_id,p_request_id,p_actor,p_session,p_reason,p_bytes,p_complete,p_digest,p_digest_scope,
    p_effective,p_entry,p_content_digest,p_cipher) on conflict(event_id) do nothing;
  select * into existing from private.ai_query_ingress_events where event_id=p_event_id;
  if row(existing.request_id,existing.actor_id,existing.session_id,existing.reason,existing.bytes_observed,
      existing.body_complete,existing.body_digest,existing.digest_scope,existing.effective_user_id,
      existing.entry,existing.content_digest,existing.cipher)
    is distinct from row(p_request_id,p_actor,p_session,p_reason,p_bytes,p_complete,p_digest,p_digest_scope,
      p_effective,p_entry,p_content_digest,p_cipher)
  then raise exception using errcode='22023',message='intake idempotency conflict';end if;
end $$;
create function public.ai_query_record_intake(
  p_event_id uuid,p_request_id uuid,p_actor uuid,p_session uuid,p_reason text,
  p_bytes bigint,p_complete boolean,p_digest text,p_digest_scope text,
  p_effective uuid,p_entry text,p_content_digest text,p_cipher jsonb)
returns void language sql security invoker set search_path='' as $$
select private.ai_query_record_intake(p_event_id,p_request_id,p_actor,p_session,p_reason,p_bytes,p_complete,
  p_digest,p_digest_scope,p_effective,p_entry,p_content_digest,p_cipher)
$$;
revoke all on function private.ai_query_record_intake(uuid,uuid,uuid,uuid,text,bigint,boolean,text,text,uuid,text,text,jsonb),
  public.ai_query_record_intake(uuid,uuid,uuid,uuid,text,bigint,boolean,text,text,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_record_intake(uuid,uuid,uuid,uuid,text,bigint,boolean,text,text,uuid,text,text,jsonb),
  public.ai_query_record_intake(uuid,uuid,uuid,uuid,text,bigint,boolean,text,text,uuid,text,text,jsonb) to service_role;
-- Metadata-only reconciliation distinguishes lost legacy text from retained intake.
create or replace function private.ai_query_reconcile_overview(p_since timestamptz) returns jsonb
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
    'orphan_content_retained',(select count(*) from private.ai_query_ingress_events i where occurred_at>=p_since and occurred_at<clock_timestamp()-interval '180 seconds' and reason='request_received' and actor_id is not null and cipher is not null and not exists(select 1 from private.ai_query_audit_streams s where s.request_id=i.request_id)),
    'orphan_sample',coalesce((select jsonb_agg(x) from (select i.event_id,i.request_id,i.occurred_at,(i.cipher is not null) as content_retained,i.entry from private.ai_query_ingress_events i
      where occurred_at>=p_since and occurred_at<clock_timestamp()-interval '180 seconds' and reason='request_received' and actor_id is not null
      and not exists(select 1 from private.ai_query_audit_streams s where s.request_id=i.request_id) order by occurred_at,event_id limit 100) x),'[]'::jsonb)) into result;
  return result;
end $$;

commit;
