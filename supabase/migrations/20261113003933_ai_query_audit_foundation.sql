-- Isolated foundation only. No capability grants or AI activation are seeded.
-- Full question/answer bodies are application-encrypted; legacy audit_logs stays metadata-only.
begin;

create table private.ai_query_audit_streams (
  request_id uuid primary key,
  actor_id uuid not null,
  effective_user_id uuid not null,
  actor_role text,
  effective_role text,
  identity_valid boolean not null,
  policy_version text not null check (length(policy_version) between 1 and 200),
  received_at timestamptz not null default clock_timestamp(),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  state text not null default 'received' check (state in ('received','running','succeeded','failed','denied','cancelled')),
  head_sequence bigint not null default 0,
  head_hash text not null default repeat('0',64)
);
create table private.ai_query_audit_events (
  event_id uuid primary key,
  request_id uuid not null references private.ai_query_audit_streams(request_id),
  sequence bigint not null check (sequence > 0),
  kind text not null check (kind in ('received','running','tool_started','tool_finished','response_generated','delivery_chunk','succeeded','failed','denied','cancelled','accounting','delivery_receipt','correction')),
  occurred_at timestamptz not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  cipher jsonb not null,
  previous_hash text not null,
  event_hash text not null,
  unique (request_id, sequence)
);
create table private.ai_audit_read_grants (
  user_id uuid primary key,
  valid_until timestamptz not null,
  grant_reference text not null check (length(grant_reference) between 1 and 200)
);
create table private.ai_audit_access_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  request_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  action text not null check (action = 'read_question_answer'),
  allowed boolean not null
);
alter table private.ai_query_audit_streams enable row level security;
alter table private.ai_query_audit_events enable row level security;
alter table private.ai_audit_read_grants enable row level security;
alter table private.ai_audit_access_events enable row level security;
revoke all on private.ai_query_audit_streams, private.ai_query_audit_events, private.ai_audit_read_grants, private.ai_audit_access_events from public, anon, authenticated, service_role;
revoke all on sequence private.ai_audit_access_events_id_seq from public, anon, authenticated, service_role;

create function private.ai_audit_check_cipher(p_cipher jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_cipher is null or jsonb_typeof(p_cipher) <> 'object'
    or octet_length(p_cipher::text) > 262144
    or not (p_cipher ?& array['version','algorithm','keyId','nonce','tag','ciphertext'])
    or (p_cipher - array['version','algorithm','keyId','nonce','tag','ciphertext']) <> '{}'::jsonb
    or p_cipher->>'version' is distinct from '1'
    or p_cipher->>'algorithm' is distinct from 'aes-256-gcm'
    or coalesce(p_cipher->>'keyId','') !~ '^[A-Za-z0-9_-]{1,80}$'
    or coalesce(p_cipher->>'nonce','') !~ '^[0-9a-f]{24}$'
    or coalesce(p_cipher->>'tag','') !~ '^[0-9a-f]{32}$'
    or coalesce(p_cipher->>'ciphertext','') !~ '^[0-9a-f]+$'
    or length(p_cipher->>'ciphertext') % 2 <> 0
  then raise exception using errcode='22023', message='invalid audit ciphertext'; end if;
end $$;

create function private.ai_query_audit_append(p_request_id uuid, p_event_id uuid, p_kind text, p_payload_digest text, p_cipher jsonb)
returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s private.ai_query_audit_streams; existing private.ai_query_audit_events; e private.ai_query_audit_events; t timestamptz; h text;
begin
  perform private.ai_audit_check_cipher(p_cipher);
  select * into s from private.ai_query_audit_streams where request_id=p_request_id for update;
  if not found then raise exception using errcode='42501', message='audit request unavailable'; end if;
  select * into existing from private.ai_query_audit_events where event_id=p_event_id;
  if found then
    if existing.request_id <> p_request_id or existing.kind <> p_kind or existing.payload_digest <> p_payload_digest then
      raise exception using errcode='22023', message='audit idempotency conflict';
    end if;
    return jsonb_build_object('event_id',existing.event_id,'sequence',existing.sequence,'event_hash',existing.event_hash,'replayed',true);
  end if;
  if (p_kind='received' and s.head_sequence<>0) or (p_kind<>'received' and s.head_sequence=0)
    or (s.state in ('succeeded','failed','denied','cancelled') and p_kind not in ('accounting','delivery_receipt','correction'))
    or (s.state='received' and p_kind not in ('received','running','denied','cancelled','failed'))
    or (s.state='running' and p_kind in ('received','running'))
    or (not s.identity_valid and p_kind not in ('received','denied','failed','correction'))
  then raise exception using errcode='22023', message='invalid audit transition'; end if;
  t := clock_timestamp();
  h := encode(sha256(convert_to(jsonb_build_array(s.head_hash,p_request_id,p_event_id,s.head_sequence+1,p_kind,t,p_payload_digest,p_cipher,s.actor_id,s.effective_user_id,s.actor_role,s.effective_role,s.identity_valid,s.policy_version,s.received_at,s.payload_digest)::text,'UTF8')),'hex');
  insert into private.ai_query_audit_events(event_id,request_id,sequence,kind,occurred_at,payload_digest,cipher,previous_hash,event_hash)
    values(p_event_id,p_request_id,s.head_sequence+1,p_kind,t,p_payload_digest,p_cipher,s.head_hash,h) returning * into e;
  update private.ai_query_audit_streams set head_sequence=e.sequence,head_hash=h,
    state=case when p_kind in ('running','succeeded','failed','denied','cancelled') then p_kind else state end where request_id=p_request_id;
  return jsonb_build_object('event_id',e.event_id,'sequence',e.sequence,'event_hash',h,'replayed',false);
end $$;

create function private.ai_query_audit_receive(p_request_id uuid,p_event_id uuid,p_actor uuid,p_effective uuid,p_policy_version text,p_payload_digest text,p_cipher jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ar text; er text; s private.ai_query_audit_streams; identity_ok boolean;
begin
  perform private.ai_audit_check_cipher(p_cipher);
  select role into ar from public.user_roles where user_id=p_actor;
  select role into er from public.user_roles where user_id=p_effective;
  identity_ok := ar is not null and er is not null and (p_actor=p_effective or ar='admin');
  insert into private.ai_query_audit_streams(request_id,actor_id,effective_user_id,actor_role,effective_role,identity_valid,policy_version,payload_digest)
    values(p_request_id,p_actor,p_effective,ar,er,identity_ok,p_policy_version,p_payload_digest) on conflict (request_id) do nothing;
  select * into s from private.ai_query_audit_streams where request_id=p_request_id for update;
  if s.actor_id<>p_actor or s.effective_user_id<>p_effective or s.payload_digest<>p_payload_digest or s.policy_version<>p_policy_version then
    raise exception using errcode='22023', message='audit idempotency conflict';
  end if;
  return private.ai_query_audit_append(p_request_id,p_event_id,'received',p_payload_digest,p_cipher)
    || jsonb_build_object('identity_valid',s.identity_valid);
end $$;

-- Read authorization is separate from admin/model management. No grants are seeded.
-- A denied read returns a generic envelope rather than raising, so its access audit commits.
create function private.ai_query_audit_read(p_actor uuid,p_effective uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare allowed boolean; body jsonb;
begin
  allowed := p_actor=p_effective and exists(select 1 from public.user_roles where user_id=p_actor)
    and exists(select 1 from private.ai_audit_read_grants where user_id=p_actor and valid_until>clock_timestamp());
  insert into private.ai_audit_access_events(actor_id,request_id,action,allowed) values(p_actor,p_request_id,'read_question_answer',coalesce(allowed,false));
  if not coalesce(allowed,false) then return jsonb_build_object('allowed',false); end if;
  select jsonb_build_object('request',to_jsonb(s),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.sequence) from private.ai_query_audit_events e where e.request_id=s.request_id),'[]'::jsonb)) into body
    from private.ai_query_audit_streams s where s.request_id=p_request_id;
  return jsonb_build_object('allowed',true,'record',body);
end $$;

-- Expected head/sequence must come from a separately protected checkpoint.
-- Without that external anchor a database owner could rewrite this entire chain.
create function private.ai_query_audit_verify(p_request_id uuid,p_expected_head text,p_expected_sequence bigint)
returns boolean language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s private.ai_query_audit_streams; e private.ai_query_audit_events; previous text:=repeat('0',64); n bigint:=0; computed text;
begin
  if p_expected_head is null or p_expected_sequence is null then return false; end if;
  select * into s from private.ai_query_audit_streams where request_id=p_request_id;
  if not found then return false; end if;
  for e in select * from private.ai_query_audit_events where request_id=p_request_id order by sequence loop
    n:=n+1;
    if e.sequence<>n or e.previous_hash<>previous then return false; end if;
    computed:=encode(sha256(convert_to(jsonb_build_array(previous,p_request_id,e.event_id,n,e.kind,e.occurred_at,e.payload_digest,e.cipher,s.actor_id,s.effective_user_id,s.actor_role,s.effective_role,s.identity_valid,s.policy_version,s.received_at,s.payload_digest)::text,'UTF8')),'hex');
    if e.event_hash<>computed then return false; end if;
    previous:=computed;
  end loop;
  return n>0 and n=s.head_sequence and n=p_expected_sequence and previous=s.head_hash and previous=p_expected_head;
end $$;

-- RPC shells are invoker-only; privileged implementations stay in the unexposed schema.
create function public.ai_query_audit_receive(p_request_id uuid,p_event_id uuid,p_actor uuid,p_effective uuid,p_policy_version text,p_payload_digest text,p_cipher jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select private.ai_query_audit_receive(p_request_id,p_event_id,p_actor,p_effective,p_policy_version,p_payload_digest,p_cipher) $$;
create function public.ai_query_audit_append(p_request_id uuid,p_event_id uuid,p_kind text,p_payload_digest text,p_cipher jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select private.ai_query_audit_append(p_request_id,p_event_id,p_kind,p_payload_digest,p_cipher) $$;
create function public.ai_query_audit_read(p_actor uuid,p_effective uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select private.ai_query_audit_read(p_actor,p_effective,p_request_id) $$;
create function public.ai_query_audit_verify(p_request_id uuid,p_expected_head text,p_expected_sequence bigint)
returns boolean language sql security invoker set search_path = '' as $$ select private.ai_query_audit_verify(p_request_id,p_expected_head,p_expected_sequence) $$;

revoke all on function private.ai_audit_check_cipher(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.ai_query_audit_receive(uuid,uuid,uuid,uuid,text,text,jsonb), private.ai_query_audit_append(uuid,uuid,text,text,jsonb), private.ai_query_audit_read(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ai_query_audit_receive(uuid,uuid,uuid,uuid,text,text,jsonb), public.ai_query_audit_append(uuid,uuid,text,text,jsonb), public.ai_query_audit_read(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.ai_query_audit_receive(uuid,uuid,uuid,uuid,text,text,jsonb), private.ai_query_audit_append(uuid,uuid,text,text,jsonb), private.ai_query_audit_read(uuid,uuid,uuid) to service_role;
grant execute on function public.ai_query_audit_receive(uuid,uuid,uuid,uuid,text,text,jsonb), public.ai_query_audit_append(uuid,uuid,text,text,jsonb), public.ai_query_audit_read(uuid,uuid,uuid) to service_role;
revoke all on function private.ai_query_audit_verify(uuid,text,bigint), public.ai_query_audit_verify(uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_audit_verify(uuid,text,bigint), public.ai_query_audit_verify(uuid,text,bigint) to service_role;
commit;
