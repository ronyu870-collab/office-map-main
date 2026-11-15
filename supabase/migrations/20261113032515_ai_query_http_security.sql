begin;
-- A bounded, content-free ingress ledger. A new event identifies each HTTP attempt,
-- including repeated request IDs; it does not claim anonymous identities are known.
create table private.ai_query_ingress_events (
  event_id uuid primary key,
  request_id uuid not null,
  actor_id uuid,
  session_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  reason text not null check (reason in ('request_received','unauthenticated','body_too_large','body_interrupted','invalid_encoding')),
  bytes_observed bigint not null check (bytes_observed between 0 and 9007199254740991),
  body_complete boolean not null,
  body_digest text not null check (body_digest ~ '^[0-9a-f]{64}$'),
  digest_scope text not null check (digest_scope in ('complete','prefix')),
  check (body_complete=(digest_scope='complete'))
);
alter table private.ai_query_ingress_events enable row level security;
revoke all on private.ai_query_ingress_events from public,anon,authenticated,service_role;
create function private.ai_query_record_ingress(p_event_id uuid,p_request_id uuid,p_actor uuid,p_session uuid,p_reason text,p_bytes bigint,p_complete boolean,p_digest text,p_digest_scope text)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into private.ai_query_ingress_events(event_id,request_id,actor_id,session_id,reason,bytes_observed,body_complete,body_digest,digest_scope)
  values(p_event_id,p_request_id,p_actor,p_session,p_reason,p_bytes,p_complete,p_digest,p_digest_scope);
end $$;
create function public.ai_query_record_ingress(p_event_id uuid,p_request_id uuid,p_actor uuid,p_session uuid,p_reason text,p_bytes bigint,p_complete boolean,p_digest text,p_digest_scope text)
returns void language sql security invoker set search_path='' as $$
select private.ai_query_record_ingress(p_event_id,p_request_id,p_actor,p_session,p_reason,p_bytes,p_complete,p_digest,p_digest_scope)
$$;
revoke all on function private.ai_query_record_ingress(uuid,uuid,uuid,uuid,text,bigint,boolean,text,text),public.ai_query_record_ingress(uuid,uuid,uuid,uuid,text,bigint,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_record_ingress(uuid,uuid,uuid,uuid,text,bigint,boolean,text,text),public.ai_query_record_ingress(uuid,uuid,uuid,uuid,text,bigint,boolean,text,text) to service_role;
commit;
