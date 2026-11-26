-- Control plane only: no account grants, provider enablement, price increase or production config seed.
begin;
create table private.ai_management_grants (
  user_id uuid primary key references auth.users(id),
  capabilities text[] not null check (capabilities <@ array['operations:read','models:write','budgets:write','tests:run','emergency:write','grants:write'] and array_position(capabilities,null) is null),
  valid_until timestamptz not null, revision uuid not null default gen_random_uuid(), reason text not null check (length(reason) between 1 and 500)
);
create table private.ai_management_windows (actor_id uuid primary key,starts_at timestamptz not null,requests int not null);
alter table private.ai_management_windows enable row level security;
revoke all on private.ai_management_windows from public,anon,authenticated,service_role;
create table private.ai_model_catalog (
  id text primary key check (id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$'),
  definition jsonb not null check (jsonb_typeof(definition)='object' and octet_length(definition::text)<=4096),
  revision uuid not null default gen_random_uuid(), updated_at timestamptz not null default clock_timestamp()
);
create table private.ai_control_versions (
  version uuid primary key default gen_random_uuid(), config jsonb not null,
  models jsonb not null, created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null, session_id uuid not null, reason text not null check (length(reason) between 1 and 500),
  restored_from uuid references private.ai_control_versions(version),
  check (octet_length(config::text)<=32768 and octet_length(models::text)<=65536)
);
create table private.ai_control_state (
  singleton boolean primary key default true check (singleton),
  version uuid references private.ai_control_versions(version), revision uuid not null default gen_random_uuid(),
  paused boolean not null default false,
  disabled_providers text[] not null default '{}' check (disabled_providers <@ array['deepseek','openai'] and array_position(disabled_providers,null) is null),
  disabled_models text[] not null default '{}' check (cardinality(disabled_models)<=100 and array_position(disabled_models,null) is null),
  changed_at timestamptz not null default clock_timestamp()
);
insert into private.ai_control_state(singleton) values(true);
create table private.ai_control_drafts (
  id uuid primary key, actor_id uuid not null, base_revision uuid not null, config jsonb not null,
  updated_at timestamptz not null default clock_timestamp(), check (octet_length(config::text)<=32768)
);
create table private.ai_management_events (
  id bigint generated always as identity primary key, at timestamptz not null default clock_timestamp(),
  actor_id uuid not null, session_id uuid not null, action text not null, reason text not null,
  before_state jsonb, after_state jsonb
);
create index ai_management_events_at on private.ai_management_events(at desc,id desc);
create index ai_control_versions_at on private.ai_control_versions(created_at desc,version desc);

alter table private.ai_management_grants enable row level security;
alter table private.ai_model_catalog enable row level security;
alter table private.ai_control_versions enable row level security;
alter table private.ai_control_state enable row level security;
alter table private.ai_control_drafts enable row level security;
alter table private.ai_management_events enable row level security;
revoke all on private.ai_management_grants, private.ai_model_catalog, private.ai_control_versions,
  private.ai_control_state,private.ai_control_drafts,private.ai_management_events from public,anon,authenticated,service_role;
revoke all on sequence private.ai_management_events_id_seq from public,anon,authenticated,service_role;

-- Deliberately independent of AI access/control: an emergency operator can recover a disabled service.
create function private.ai_management_authority(p_actor uuid,p_session uuid) returns text[]
language plpgsql security definer set search_path='' as $$
declare caps text[];
begin
  perform 1 from auth.users u join public.user_roles r on r.user_id=u.id
    where u.id=p_actor and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and r.role='admin' for share of u,r;
  if not found then return null; end if;
  perform 1 from auth.sessions s where s.id=p_session and s.user_id=p_actor
    and (s.not_after is null or s.not_after>clock_timestamp()) for share;
  if not found then return null; end if;
  select capabilities into caps from private.ai_management_grants
    where user_id=p_actor and valid_until>clock_timestamp() for share;
  return caps;
end $$;

create function private.ai_control_runtime(p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='3s' as $$
declare s private.ai_control_state; v private.ai_control_versions; disabled text[];
begin
  -- Only a currently verified self-admin session; business/disclosure checks remain separate and mandatory.
  perform 1 from auth.users u join public.user_roles r on r.user_id=u.id
    where u.id=p_actor and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and r.role='admin' for share of u,r;
  if not found then return jsonb_build_object('allowed',false); end if;
  perform 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>clock_timestamp()) for share;
  if not found then return jsonb_build_object('allowed',false); end if;
  select * into s from private.ai_control_state where singleton for share;
  select * into v from private.ai_control_versions where version=s.version;
  select coalesce(array_agg(id),'{}') into disabled from private.ai_model_catalog
    where definition->>'enabled'<>'true' or definition->>'verification'='unverified';
  return jsonb_build_object('allowed',true,'version',s.version,'revision',s.revision,'paused',s.paused,
    'disabledProviders',s.disabled_providers,'disabledModels',s.disabled_models||disabled,
    'config',v.config,'models',v.models);
end $$;

-- Defense in depth for a trusted application service; no arbitrary secret-bearing JSON may be stored.
create function private.ai_control_validate(p_config jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mode text; policy jsonb; model_key text; model private.ai_model_catalog; ids text[]:='{}'; models jsonb;
begin
  if p_config is null or jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>32768
    or p_config->>'protocol' is distinct from 'ai-control-config/1'
    or (select count(*) from jsonb_object_keys(p_config))<>5
    or not p_config ?& array['protocol','modes','purposes','budget','disabledTools']
    or jsonb_typeof(p_config->'modes') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_config->'modes'))<>3
    or not (p_config->'modes') ?& array['quick','professional','deep']
    or jsonb_typeof(p_config->'purposes') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_config->'purposes'))<>2
    or not (p_config->'purposes') ?& array['semantic_intent','synthesis']
    or jsonb_typeof(p_config->'budget') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_config->'budget'))<>7
    or not (p_config->'budget') ?& array['kind','dailyUsd','monthlyUsd','testDailyUsd','warningPercent','providerLimits','modelLimits']
    or jsonb_typeof(p_config->'disabledTools') is distinct from 'array'
    or jsonb_array_length(p_config->'disabledTools')>80
    or exists(select 1 from jsonb_array_elements(p_config->'disabledTools') x where jsonb_typeof(x)<>'string' or not (x#>>'{}') ~ '^[a-z_]{1,100}$')
    then raise exception using errcode='22023',message='invalid control config'; end if;
  foreach mode in array array['quick','professional','deep'] loop
    policy:=p_config->'modes'->mode;
    if jsonb_typeof(policy) is distinct from 'object' or (select count(*) from jsonb_object_keys(policy))<>3
      or not policy ?& array['model','fallback','limits'] or jsonb_typeof(policy->'limits') is distinct from 'object'
      or (select count(*) from jsonb_object_keys(policy->'limits'))<>6
      or not (policy->'limits') ?& array['tokens','usd','outputTokens','timeoutMs','attempts','tools']
      or not (policy->'limits'->>'tokens')::numeric between 1000 and 60000
      or not (policy->'limits'->>'usd')::numeric between 0.000001 and 5
      or not (policy->'limits'->>'outputTokens')::numeric between 256 and 4096
      or not (policy->'limits'->>'timeoutMs')::numeric between 1000 and 18000
      or not (policy->'limits'->>'attempts')::numeric between 1 and 10
      or not (policy->'limits'->>'tools')::numeric between 1 and 12
      then raise exception using errcode='22023',message='invalid mode policy'; end if;
    ids:=array_append(ids,policy->>'model');
    if policy->>'fallback' is not null then ids:=array_append(ids,policy->>'fallback');end if;
  end loop;
  for model_key in select value from jsonb_each_text(p_config->'purposes') where value is not null loop ids:=array_append(ids,model_key);end loop;
  if p_config->'budget'->>'kind' not in ('observe','soft','hard')
    or not (p_config->'budget'->>'dailyUsd')::numeric between 0.000001 and 10000
    or not (p_config->'budget'->>'monthlyUsd')::numeric between 0.000001 and 100000
    or not (p_config->'budget'->>'testDailyUsd')::numeric between 0 and 100
    then raise exception using errcode='22023',message='invalid budget'; end if;
  for model_key in select distinct unnest(ids) loop
    select * into model from private.ai_model_catalog where id=model_key for share;
    if not found or model.definition->>'enabled' is distinct from 'true'
      or model.definition->>'verification' not in ('verified','environment_legacy')
      then raise exception using errcode='22023',message='model not approved'; end if;
    if exists(select 1 from jsonb_each(p_config->'modes') m where (m.value->>'model'=model_key or m.value->>'fallback'=model_key)
      and model.definition->>'tools' is distinct from 'true') then raise exception using errcode='22023',message='model capability mismatch';end if;
  end loop;
  select jsonb_agg(definition order by id) into models from private.ai_model_catalog where id=any(ids);
  return models;
end $$;

create function private.ai_control_manage(p_actor uuid,p_session uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare caps text[]; s private.ai_control_state; v private.ai_control_versions; draft private.ai_control_drafts;
  config jsonb; models jsonb; reason text; before_state jsonb; selected uuid; needed text; admission_count int;
begin
  caps:=private.ai_management_authority(p_actor,p_session);
  if caps is null then return jsonb_build_object('allowed',false);end if;
  needed:=case p_action when 'read' then 'operations:read' when 'history' then 'operations:read'
    when 'draft' then 'models:write' when 'publish' then 'models:write' when 'rollback' then 'models:write'
    when 'emergency' then 'emergency:write' else null end;
  if needed is null or not (needed=any(caps) or p_action='read' and cardinality(caps)>0
    or p_action='history' and ('models:write'=any(caps) or 'budgets:write'=any(caps))
    or p_action in ('draft','publish','rollback') and 'budgets:write'=any(caps)) then return jsonb_build_object('allowed',false);end if;
  if p_action='read' and p_input->>'admit'='true' then
    insert into private.ai_management_windows(actor_id,starts_at,requests) values(p_actor,date_trunc('minute',clock_timestamp()),1)
      on conflict(actor_id) do update set starts_at=excluded.starts_at,requests=case when private.ai_management_windows.starts_at=excluded.starts_at then private.ai_management_windows.requests+1 else 1 end returning requests into admission_count;
    if admission_count>60 then return jsonb_build_object('allowed',false,'reason','rate_limit');end if;
  end if;
  if p_action in ('read','history') then
    select * into s from private.ai_control_state where singleton for share;
  else
    select * into s from private.ai_control_state where singleton for update;
  end if;
  if p_action='read' then
    select * into v from private.ai_control_versions where version=s.version;
    select coalesce(jsonb_agg(definition order by id),'[]') into models from private.ai_model_catalog;
    return jsonb_build_object('allowed',true,'capabilities',caps,'state',to_jsonb(s),'config',v.config,'models',models,
      'globalControl',(select jsonb_build_object('enabled',enabled,'revision',revision) from private.ai_query_control where singleton),
      'drafts',coalesce((select jsonb_agg(to_jsonb(d)) from private.ai_control_drafts d where actor_id=p_actor),'[]'));
  elsif p_action='history' then
    return jsonb_build_object('allowed',true,'versions',coalesce((select jsonb_agg(to_jsonb(x)) from
      (select h.version,h.created_at,h.actor_id,h.reason,h.restored_from,h.config from private.ai_control_versions h order by h.created_at desc,h.version desc limit 50) x),'[]'));
  end if;
  if (p_input->>'expectedRevision')::uuid is distinct from s.revision then return jsonb_build_object('allowed',true,'conflict',true);end if;
  before_state:=to_jsonb(s);
  if p_action='draft' then
    -- Validation remains stricter in the server boundary (deployment caps and credentials).
    config:=p_input->'config';models:=private.ai_control_validate(config);
    if not 'models:write'=any(caps) then
      select * into v from private.ai_control_versions where version=s.version;
      if v.version is null or config->'purposes' is distinct from v.config->'purposes'
        or config->'disabledTools' is distinct from v.config->'disabledTools'
        or exists(select 1 from jsonb_each(config->'modes') m where (m.value-'limits') is distinct from (v.config->'modes'->m.key-'limits'))
        then return jsonb_build_object('allowed',false);end if;
    end if;
    if not 'budgets:write'=any(caps) then
      select * into v from private.ai_control_versions where version=s.version;
      if v.version is null or config->'budget' is distinct from v.config->'budget'
        or exists(select 1 from jsonb_each(config->'modes') m where m.value->'limits' is distinct from v.config->'modes'->m.key->'limits')
        then return jsonb_build_object('allowed',false);end if;
    end if;
    -- One bounded draft per operator. Draft revisions are independent of global publication.
    delete from private.ai_control_drafts where actor_id=p_actor;
    insert into private.ai_control_drafts(id,actor_id,base_revision,config) values(gen_random_uuid(),p_actor,s.revision,config) returning * into draft;
    return jsonb_build_object('allowed',true,'draft',to_jsonb(draft));
  elsif p_action in ('publish','rollback') then
    if p_action='publish' then
      select * into draft from private.ai_control_drafts where id=(p_input->>'draftId')::uuid and actor_id=p_actor for update;
      if not found or draft.base_revision<>s.revision then return jsonb_build_object('allowed',true,'conflict',true);end if;
      config:=draft.config;
    else
      select * into v from private.ai_control_versions where version=(p_input->>'version')::uuid;
      if not found then raise exception using errcode='22023',message='version not found';end if;
      config:=v.config;selected:=v.version;
    end if;
    -- Revalidate CURRENT model approvals; old snapshots cannot restore revoked models.
    models:=private.ai_control_validate(config);
    if not 'models:write'=any(caps) then
      select * into v from private.ai_control_versions where version=s.version;
      if v.version is null or config->'purposes' is distinct from v.config->'purposes'
        or config->'disabledTools' is distinct from v.config->'disabledTools'
        or exists(select 1 from jsonb_each(config->'modes') m where (m.value-'limits') is distinct from (v.config->'modes'->m.key-'limits'))
        then return jsonb_build_object('allowed',false);end if;
    end if;
    if not 'budgets:write'=any(caps) then
      select * into v from private.ai_control_versions where version=s.version;
      if v.version is null or config->'budget' is distinct from v.config->'budget'
        or exists(select 1 from jsonb_each(config->'modes') m where m.value->'limits' is distinct from v.config->'modes'->m.key->'limits')
        then return jsonb_build_object('allowed',false);end if;
    end if;
    reason:=p_input->>'reason';
    insert into private.ai_control_versions(config,models,actor_id,session_id,reason,restored_from)
      values(config,models,p_actor,p_session,reason,selected) returning * into v;
    update private.ai_control_state set version=v.version,revision=gen_random_uuid(),changed_at=clock_timestamp() where singleton returning * into s;
    if p_action='publish' then delete from private.ai_control_drafts where id=draft.id;end if;
  elsif p_action='emergency' then
    reason:=p_input->>'reason';
    if p_input->>'paused' not in ('true','false') or jsonb_typeof(p_input->'disabledProviders') is distinct from 'array'
      or jsonb_typeof(p_input->'disabledModels') is distinct from 'array' then raise exception using errcode='22023',message='invalid emergency state';end if;
    update private.ai_control_state set paused=(p_input->>'paused')::boolean,
      disabled_providers=array(select jsonb_array_elements_text(p_input->'disabledProviders')),
      disabled_models=array(select jsonb_array_elements_text(p_input->'disabledModels')),
      revision=gen_random_uuid(),changed_at=clock_timestamp() where singleton returning * into s;
  end if;
  insert into private.ai_management_events(actor_id,session_id,action,reason,before_state,after_state)
    values(p_actor,p_session,p_action,reason,before_state,to_jsonb(s));
  return jsonb_build_object('allowed',true,'state',to_jsonb(s));
end $$;

create function public.ai_control_runtime(p_actor uuid,p_session uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.ai_control_runtime(p_actor,p_session) $$;
create function public.ai_control_manage(p_actor uuid,p_session uuid,p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.ai_control_manage(p_actor,p_session,p_action,p_input) $$;
revoke all on function private.ai_management_authority(uuid,uuid),private.ai_control_validate(jsonb),
  private.ai_control_runtime(uuid,uuid),public.ai_control_runtime(uuid,uuid),
  private.ai_control_manage(uuid,uuid,text,jsonb),public.ai_control_manage(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_control_runtime(uuid,uuid),public.ai_control_runtime(uuid,uuid),
  private.ai_control_manage(uuid,uuid,text,jsonb),public.ai_control_manage(uuid,uuid,text,jsonb) to service_role;
-- Non-text operational projection. The original audit remains authoritative.
create table private.ai_operation_requests (
  request_id uuid primary key references private.ai_query_audit_streams(request_id),
  received_at timestamptz not null, updated_at timestamptz not null default clock_timestamp(),
  last_sequence bigint not null default 0, state text not null default 'received',
  metadata jsonb not null default '{}'
);
create table private.ai_operation_events (
  event_id uuid primary key references private.ai_query_audit_events(event_id),
  request_id uuid not null references private.ai_operation_requests(request_id),
  sequence bigint not null, at timestamptz not null, metadata jsonb not null,
  unique(request_id,sequence), check (octet_length(metadata::text)<=8192)
);
create index ai_operation_requests_time on private.ai_operation_requests(received_at desc,request_id desc);
create index ai_operation_requests_configuration on private.ai_operation_requests((metadata->>'configurationVersion'),received_at desc);
create index ai_operation_requests_state on private.ai_operation_requests(state,updated_at) where state in ('received','running');
create index ai_operation_events_request on private.ai_operation_events(request_id,sequence);
create index ai_operation_events_summary_time on private.ai_operation_events(at) where metadata->>'type'='summary';
create index ai_operation_events_attempt_time on private.ai_operation_events(at,request_id,sequence) where metadata->>'type'='model_attempt';
create index ai_operation_events_error_time on private.ai_operation_events(at) where metadata ? 'errorCode';
create index ai_operation_events_model on private.ai_operation_events((metadata->>'provider'),(metadata->>'model'),at) where metadata->>'type'='model_attempt';
alter table private.ai_operation_requests enable row level security;
alter table private.ai_operation_events enable row level security;
revoke all on private.ai_operation_requests,private.ai_operation_events from public,anon,authenticated,service_role;

create function private.ai_operations_project(p_request_id uuid,p_events jsonb) returns void
language plpgsql security definer set search_path='' set statement_timeout='3s' as $$
declare item jsonb; meta jsonb; ev private.ai_query_audit_events; stream private.ai_query_audit_streams; next_state text;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>32 then raise exception using errcode='22023',message='invalid projection batch';end if;
  select * into stream from private.ai_query_audit_streams where request_id=p_request_id;
  if not found then raise exception using errcode='22023',message='audit stream absent';end if;
  insert into private.ai_operation_requests(request_id,received_at,updated_at) values(p_request_id,stream.received_at,stream.received_at) on conflict do nothing;
  for item in select value from jsonb_array_elements(p_events) loop
    meta:=item->'metadata';
    if jsonb_typeof(meta) is distinct from 'object' or meta->>'protocol' is distinct from 'ai-operations/1'
      or octet_length(meta::text)>8192
      or exists(select 1 from jsonb_object_keys(meta) k where k not in ('protocol','kind','type','testing','mode','configurationVersion','route','taskType','status','phase','tool','tools','durationMs','formalResult','recoveryRequested','recoveryCompleted','paidModelCalls','filesRequested','filesCompleted','toolCalls','reusedTools','attempt','provider','model','purpose','fallback','attemptState','errorCode','errorCategory','usageStatus','inputTokens','outputTokens','cachedInputTokens','reasoningTokens','reservationTokens','chargedTokens','estimateUsd','messageBytes','toolBytes','opaqueBytes','systemBytes','observationBytes'))
      then raise exception using errcode='22023',message='invalid projection metadata';end if;
    select * into ev from private.ai_query_audit_events where event_id=(item->>'eventId')::uuid and request_id=p_request_id and kind=meta->>'kind';
    if not found then raise exception using errcode='22023',message='audit event absent';end if;
    insert into private.ai_operation_events(event_id,request_id,sequence,at,metadata)
      values(ev.event_id,p_request_id,ev.sequence,ev.occurred_at,meta) on conflict do nothing;
    -- Out-of-order delivery never regresses the visible request lifecycle.
    next_state:=case when meta->>'kind'='succeeded' then coalesce(meta->>'status',case when (select metadata->>'formalResult' from private.ai_operation_requests where request_id=p_request_id)='true' then 'completed' else 'unknown' end)
      when meta->>'kind'='denied' then coalesce(meta->>'status','denied')
      when meta->>'kind' in ('failed','cancelled') then meta->>'kind'
      when meta->>'kind'='correction' then coalesce(meta->>'status','unknown')
      when meta->>'kind'='received' then 'received'
      when meta->>'status' in ('partial','completed') then meta->>'status'
      when meta->>'kind' in ('running','tool_started','tool_finished','accounting') then 'running' else null end;
    update private.ai_operation_requests set updated_at=greatest(updated_at,ev.occurred_at),last_sequence=ev.sequence,
      state=coalesce(next_state,state),
      metadata=metadata|| (meta-array['protocol','kind','type','attempt','provider','model','purpose','fallback','attemptState','usageStatus','inputTokens','outputTokens','cachedInputTokens','reasoningTokens','reservationTokens','chargedTokens','estimateUsd','messageBytes','toolBytes','opaqueBytes','systemBytes','observationBytes'] - case when meta->>'type'='summary' then '{}'::text[] else array['durationMs'] end)
      where request_id=p_request_id and last_sequence<ev.sequence;
  end loop;
end $$;
create function public.ai_operations_project(p_request_id uuid,p_events jsonb) returns void
language sql security invoker set search_path='' as $$select private.ai_operations_project(p_request_id,p_events)$$;
revoke all on function private.ai_operations_project(uuid,jsonb),public.ai_operations_project(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_operations_project(uuid,jsonb),public.ai_operations_project(uuid,jsonb) to service_role;
create function private.ai_operations_read(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare caps text[]; f timestamptz; t timestamptz; action text; bucket text; step interval; answer jsonb;
  page_size int; cursor_time timestamptz; cursor_id uuid; target uuid; actor_filter uuid;
begin
  caps:=private.ai_management_authority(p_actor,p_session);
  if caps is null or not 'operations:read'=any(caps) then return jsonb_build_object('allowed',false);end if;
  action:=p_input->>'action';
  if action='detail' then
    target:=(p_input->>'requestId')::uuid;
    return jsonb_build_object('allowed',true,'asOf',clock_timestamp(),
      'request',(select to_jsonb(r) from private.ai_operation_requests r where request_id=target),
      'events',coalesce((select jsonb_agg(to_jsonb(x) order by sequence) from
        (select event_id,sequence,at,metadata from private.ai_operation_events where request_id=target order by sequence limit 512) x),'[]'),
      'hasMore',(select count(*)>512 from private.ai_operation_events where request_id=target));
  end if;
  if action not in ('overview','tasks') then raise exception using errcode='22023',message='invalid operations action';end if;
  f:=(p_input->>'from')::timestamptz;t:=(p_input->>'to')::timestamptz;
  if f is null or t is null or t<=f or t-f>interval '31 days' or t>clock_timestamp()+interval '1 minute' then raise exception using errcode='22023',message='invalid operations range';end if;
  actor_filter:=(p_input->>'actorId')::uuid;
  if actor_filter is not null and not 'grants:write'=any(caps) then return jsonb_build_object('allowed',false);end if;
  if action='tasks' then
    page_size:=coalesce((p_input->>'pageSize')::int,25);
    cursor_time:=(p_input->>'beforeTime')::timestamptz;cursor_id:=(p_input->>'beforeId')::uuid;
    if page_size not between 1 and 50 or (cursor_time is null)<>(cursor_id is null) then raise exception using errcode='22023',message='invalid operations page';end if;
    with page as materialized (
      select r.* from private.ai_operation_requests r
      where received_at>=f and received_at<t
        and (p_input->>'state' is null or r.state=p_input->>'state')
        and (p_input->>'mode' is null or r.metadata->>'mode'=p_input->>'mode')
        and (p_input->>'route' is null or r.metadata->>'route'=p_input->>'route')
        and (p_input->>'taskType' is null or r.metadata->>'taskType'=p_input->>'taskType')
        and (p_input->>'configurationVersion' is null or r.metadata->>'configurationVersion'=p_input->>'configurationVersion')
        and (p_input->>'formalResult' is null or r.metadata->>'formalResult'=p_input->>'formalResult')
        and (p_input->>'filesComplete' is null or (case when (r.metadata->>'filesRequested')::int>0 then ((r.metadata->>'filesCompleted')::int=(r.metadata->>'filesRequested')::int)::text else 'unknown' end)=p_input->>'filesComplete')
        and (actor_filter is null or exists(select 1 from private.ai_query_audit_streams a where a.request_id=r.request_id and a.actor_id=actor_filter))
        and (cursor_time is null or case when p_input->>'order'='oldest' then (r.received_at,r.request_id)>(cursor_time,cursor_id) else (r.received_at,r.request_id)<(cursor_time,cursor_id) end)
        and (p_input->>'provider' is null or exists(select 1 from private.ai_operation_events e where e.request_id=r.request_id and e.metadata->>'provider'=p_input->>'provider'))
        and (p_input->>'model' is null or exists(select 1 from private.ai_operation_events e where e.request_id=r.request_id and e.metadata->>'model'=p_input->>'model'))
        and (p_input->>'errorCategory' is null or r.metadata->>'errorCategory'=p_input->>'errorCategory' or exists(select 1 from private.ai_operation_events e where e.request_id=r.request_id and e.metadata->>'errorCategory'=p_input->>'errorCategory'))
        and (p_input->>'errorCode' is null or r.metadata->>'errorCode'=p_input->>'errorCode' or exists(select 1 from private.ai_operation_events e where e.request_id=r.request_id and e.metadata->>'errorCode'=p_input->>'errorCode'))
        and (p_input->>'fallback' is null or exists(select 1 from private.ai_operation_events e where e.request_id=r.request_id and e.metadata->>'fallback'=p_input->>'fallback'))
      order by case when p_input->>'order'='oldest' then received_at end asc,case when p_input->>'order'='oldest' then request_id end asc,received_at desc,request_id desc limit page_size+1
    ) select jsonb_build_object('allowed',true,'asOf',clock_timestamp(),'items',coalesce(jsonb_agg(to_jsonb(page) order by case when p_input->>'order'='oldest' then received_at end asc,case when p_input->>'order'='oldest' then request_id end asc,received_at desc,request_id desc),'[]'),'hasMore',count(*)>page_size)
      into answer from page;
    if (answer->>'hasMore')::boolean then answer:=jsonb_set(answer,'{items}',(answer->'items')-page_size);end if;
    return answer;
  end if;
  bucket:=case when t-f<=interval '1 hour' then 'minute' when t-f<=interval '2 days' then 'hour' else 'day' end;
  step:=case bucket when 'minute' then interval '1 minute' when 'hour' then interval '1 hour' else interval '1 day' end;
  with requests as materialized (
    select * from private.ai_operation_requests r where received_at>=f and received_at<t and metadata->>'testing' is distinct from 'true'
      and (p_input->>'state' is null or r.state=p_input->>'state')
      and (p_input->>'taskType' is null or r.metadata->>'taskType'=p_input->>'taskType')
      and (p_input->>'mode' is null or r.metadata->>'mode'=p_input->>'mode')
      and (p_input->>'route' is null or r.metadata->>'route'=p_input->>'route')
      and (actor_filter is null or exists(select 1 from private.ai_query_audit_streams a where a.request_id=r.request_id and a.actor_id=actor_filter))
      and (p_input->>'provider' is null or exists(select 1 from private.ai_operation_events e where e.request_id=r.request_id and e.metadata->>'provider'=p_input->>'provider'))
      and (p_input->>'model' is null or exists(select 1 from private.ai_operation_events e where e.request_id=r.request_id and e.metadata->>'model'=p_input->>'model'))
      and (p_input->>'purpose' is null or exists(select 1 from private.ai_operation_events e where e.request_id=r.request_id and e.metadata->>'purpose'=p_input->>'purpose'))
  ), attempts as materialized (
    select distinct on (e.request_id,e.metadata->>'attempt') e.* from private.ai_operation_events e
      where e.at>=f and e.at<t and e.metadata->>'type'='model_attempt' and not exists(select 1 from private.ai_model_tests x where x.id=e.request_id)
      and (p_input->>'provider' is null or e.metadata->>'provider'=p_input->>'provider') and (p_input->>'model' is null or e.metadata->>'model'=p_input->>'model') and (p_input->>'purpose' is null or e.metadata->>'purpose'=p_input->>'purpose')
      and (not (p_input ?| array['state','taskType','mode','route','actorId']) or exists(select 1 from requests r where r.request_id=e.request_id)) order by e.request_id,e.metadata->>'attempt',e.sequence
  ), request_spend as (
    select request_id,count(*) filter(where metadata->>'usageStatus'<>'not_sent') calls,
      count(*) filter(where metadata->>'fallback'='true' and metadata->>'usageStatus'<>'not_sent') fallbacks,
      sum((metadata->>'estimateUsd')::numeric) filter(where metadata->>'usageStatus'='provider_reported') estimated_usd,
      sum((metadata->>'estimateUsd')::numeric) filter(where metadata->>'usageStatus'='unknown_reserved') reserved_unknown_usd,
      sum((metadata->>'inputTokens')::numeric+(metadata->>'outputTokens')::numeric) filter(where metadata->>'usageStatus'='provider_reported') tokens
    from attempts group by request_id
  ), usage_bins as (
    select date_trunc(bucket,at at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai' at,
      count(*) filter(where metadata->>'usageStatus'<>'not_sent') calls,
      sum((metadata->>'inputTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported') input_tokens,
      sum((metadata->>'outputTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported') output_tokens,
      sum((metadata->>'estimateUsd')::numeric) filter(where metadata->>'usageStatus'='provider_reported') estimated_usd,
      sum((metadata->>'estimateUsd')::numeric) filter(where metadata->>'usageStatus'='unknown_reserved') reserved_unknown_usd
    from attempts group by 1
  ), ticks as (
    select generate_series(date_trunc(bucket,f at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai',t-interval '1 microsecond',step) at
  ), bins as (
    select date_trunc(bucket,received_at at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai' at,
      count(*) requests,count(*) filter(where state='completed') completed,count(*) filter(where state='partial') partial,
      count(*) filter(where state='failed') failed,count(*) filter(where state='cancelled') cancelled,
      count(*) filter(where state='denied') denied,count(*) filter(where metadata->>'errorCode' in ('token_reservation','cost_reservation','account_admission','actual_token_limit','actual_cost_limit','attempt_limit','global_daily','global_monthly','provider_daily','provider_monthly','model_daily','model_monthly','test_daily')) budget
    from requests group by 1
  ), model_groups as (
    select metadata->>'provider' provider,metadata->>'model' model,count(*) filter(where metadata->>'usageStatus'<>'not_sent') calls,
      count(*) filter(where metadata->>'usageStatus'='not_sent') not_sent,count(*) filter(where metadata->>'usageStatus'='unknown_reserved') unknown_usage,
      sum((metadata->>'inputTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported') input_tokens,sum((metadata->>'outputTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported') output_tokens,
      sum((metadata->>'cachedInputTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported') cached_input_tokens,sum((metadata->>'reasoningTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported') reasoning_tokens,
      sum((metadata->>'estimateUsd')::numeric) filter(where metadata->>'usageStatus'='provider_reported') estimated_usd,
      percentile_cont(.5) within group(order by (metadata->>'durationMs')::numeric) p50_ms,
      percentile_cont(.95) within group(order by (metadata->>'durationMs')::numeric) p95_ms,
      max(at) filter(where metadata->>'attemptState'='completed') last_success,
      max(at) filter(where metadata->>'attemptState'='failed' and metadata->>'usageStatus'<>'not_sent') last_failure,
      count(*) filter(where metadata->>'attemptState'='failed' and metadata->>'usageStatus'<>'not_sent') failed_calls,count(*) filter(where metadata->>'fallback'='true' and metadata->>'usageStatus'<>'not_sent') fallback_calls,
      count(distinct request_id) filter(where request_id in(select request_id from requests where metadata->>'taskType'<>'social')) business_requests,
      count(distinct request_id) filter(where request_id in(select request_id from requests where metadata->>'taskType'<>'social' and state='completed')) business_completed
    from attempts group by 1,2
  ) select jsonb_build_object('allowed',true,'asOf',clock_timestamp(),'from',f,'to',t,'bucket',bucket,
    'metrics',(select jsonb_build_object('requests',count(*),'completed',count(*) filter(where state='completed'),'partial',count(*) filter(where state='partial'),
      'failed',count(*) filter(where state='failed'),'cancelled',count(*) filter(where state='cancelled'),'denied',count(*) filter(where state='denied'),
      'clarification',count(*) filter(where state='clarification'),'incomplete',count(*) filter(where state='incomplete'),'businessCompleted',count(*) filter(where state='completed' and metadata->>'taskType'<>'social'),'businessEnded',count(*) filter(where state in ('completed','partial','incomplete','failed') and metadata->>'taskType'<>'social'),'running',count(*) filter(where state in ('received','running') and updated_at>=clock_timestamp()-interval '3 minutes'),
      'possiblyInterrupted',count(*) filter(where state in ('received','running') and updated_at<clock_timestamp()-interval '3 minutes'),
      'p95Ms',percentile_cont(.95) within group(order by (metadata->>'durationMs')::numeric),
      'formalResults',count(*) filter(where metadata->>'formalResult'='true'),
      'fileTasks',count(*) filter(where (metadata->>'filesRequested')::int>0),
      'fileTasksCompleted',count(*) filter(where (metadata->>'filesRequested')::int>0 and metadata->>'filesRequested'=metadata->>'filesCompleted')) from requests),
    'usage',(select jsonb_build_object('reservationTokens',sum((metadata->>'reservationTokens')::bigint),'chargedTokens',sum((metadata->>'chargedTokens')::bigint),'calls',count(*) filter(where metadata->>'usageStatus'<>'not_sent'),
      'notSent',count(*) filter(where metadata->>'usageStatus'='not_sent'),'unknownUsage',count(*) filter(where metadata->>'usageStatus'='unknown_reserved'),
      'inputTokens',sum((metadata->>'inputTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported'),'outputTokens',sum((metadata->>'outputTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported'),
      'cachedInputTokens',sum((metadata->>'cachedInputTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported'),'reasoningTokens',sum((metadata->>'reasoningTokens')::bigint) filter(where metadata->>'usageStatus'='provider_reported'),
      'estimatedUsd',sum((metadata->>'estimateUsd')::numeric) filter(where metadata->>'usageStatus'='provider_reported'),
      'reservedUnknownUsd',sum((metadata->>'estimateUsd')::numeric) filter(where metadata->>'usageStatus'='unknown_reserved'),
      'actualBilledUsd',null,'billingStatus','not_reconciled') from attempts),
    'efficiency',(select jsonb_build_object('zeroPaidRequests',count(*) filter(where r.metadata->>'paidModelCalls'='0'),'modelCallsPerRequest',avg((r.metadata->>'paidModelCalls')::numeric),
      'toolCallsPerRequest',sum((r.metadata->>'toolCalls')::numeric)/nullif(count(*),0),'reusedTools',sum((r.metadata->>'reusedTools')::bigint),
      'fallbackRequests',count(*) filter(where s.fallbacks>0),'recoveryRequests',count(*) filter(where r.metadata->>'recoveryRequested'='true'),'recoveryCompleted',count(*) filter(where r.metadata->>'recoveryRequested'='true' and r.metadata->>'recoveryCompleted'='true' and r.state='completed'),'legalRecoveryRate',100.0*count(*) filter(where r.metadata->>'recoveryRequested'='true' and r.metadata->>'recoveryCompleted'='true' and r.state='completed')/nullif(count(*) filter(where r.metadata->>'recoveryRequested'='true'),0)) from requests r left join request_spend s using(request_id)),
    'usageTrend',(select jsonb_agg(jsonb_build_object('at',ticks.at,'calls',coalesce(b.calls,0),'inputTokens',b.input_tokens,'outputTokens',b.output_tokens,'estimatedUsd',b.estimated_usd,'reservedUnknownUsd',b.reserved_unknown_usd) order by ticks.at) from ticks left join usage_bins b using(at)),
    'costRanking',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select r.request_id,r.state,r.metadata->>'taskType' task_type,r.metadata->>'configurationVersion' configuration_version,s.calls,s.tokens,(r.metadata->>'toolCalls')::numeric tools,s.estimated_usd,s.reserved_unknown_usd,(r.metadata->>'durationMs')::numeric duration_ms from requests r join request_spend s using(request_id)
      order by case coalesce(p_input->>'costOrder','estimated_usd') when 'tokens' then s.tokens when 'calls' then s.calls when 'tools' then (r.metadata->>'toolCalls')::numeric when 'duration' then (r.metadata->>'durationMs')::numeric when 'failed' then case when r.state in ('failed','incomplete','partial') then s.estimated_usd end else s.estimated_usd end desc nulls last,r.request_id limit 20)x),
    'costDimensions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select d.dimension,d.value,count(*) requests,count(*) filter(where r.state='completed') completed,
      sum(s.estimated_usd) estimated_usd,sum(s.reserved_unknown_usd) reserved_unknown_usd,avg(s.estimated_usd) average_usd,avg(s.estimated_usd) filter(where r.state='completed') average_success_usd,sum(s.estimated_usd) filter(where r.state in ('failed','partial','incomplete')) unsuccessful_usd
      from requests r left join request_spend s using(request_id) left join private.ai_query_audit_streams a using(request_id)
      cross join lateral (values ('taskType',coalesce(r.metadata->>'taskType','unknown')),('route',coalesce(r.metadata->>'route','unknown')),('mode',coalesce(r.metadata->>'mode','unknown')),('state',r.state),('actor',case when 'grants:write'=any(caps) then a.actor_id::text end)) d(dimension,value)
      where d.value is not null group by 1,2 order by 1,sum(s.estimated_usd) desc nulls last limit 200)x),
    'routes',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from (select coalesce(metadata->>'route','unknown') route,count(*) requests from requests group by 1) g),
    'models',(select coalesce(jsonb_agg(to_jsonb(model_groups)),'[]') from model_groups),
    'trend',(select jsonb_agg(jsonb_build_object('at',ticks.at,'requests',coalesce(bins.requests,0),'completed',coalesce(bins.completed,0),'partial',coalesce(bins.partial,0),
      'failed',coalesce(bins.failed,0),'cancelled',coalesce(bins.cancelled,0),'denied',coalesce(bins.denied,0),'budget',coalesce(bins.budget,0)) order by ticks.at) from ticks left join bins using(at)),
    'coverage',jsonb_build_object('firstProjectedAt',(select min(received_at) from private.ai_operation_requests),'projectedRequests',(select count(*) from requests),
      'auditRequests',(select count(*) from private.ai_query_audit_streams where received_at>=f and received_at<t),
      'missingEvents',(select count(*) from private.ai_query_audit_events e join private.ai_query_audit_streams a using(request_id)
        where a.received_at>=f and a.received_at<t and e.kind<>'delivery_chunk' and not exists(select 1 from private.ai_operation_events p where p.event_id=e.event_id)))) into answer;
  return answer;
end $$;
create function public.ai_operations_read(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_operations_read(p_actor,p_session,p_input)$$;
revoke all on function private.ai_operations_read(uuid,uuid,jsonb),public.ai_operations_read(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_operations_read(uuid,uuid,jsonb),public.ai_operations_read(uuid,uuid,jsonb) to service_role;
-- Extend the same runtime attempt reservation: cross-request counters are not a second model executor.
-- Occupancy is integer USD nanos. Unknown/crashed attempts retain the full reservation indefinitely.
create table private.ai_model_budget_totals (
  scope text not null, period text not null check (period in ('day','month')), starts_on date not null,
  held_nanos bigint not null default 0 check (held_nanos>=0), primary key(scope,period,starts_on)
);
create table private.ai_model_budget_attempts (
  request_id uuid not null references private.ai_query_audit_streams(request_id), attempt int not null check(attempt between 1 and 10),
  actor_id uuid not null, session_id uuid not null, configuration_version uuid,
  provider text not null check(provider in ('deepseek','openai')), model_id text not null,
  testing boolean not null, day_start date not null, month_start date not null,
  scopes text[] not null, reserved_nanos bigint not null check(reserved_nanos>=0), held_nanos bigint not null check(held_nanos>=0),
  state text not null default 'reserved' check(state in ('reserved','provider_reported','unknown_reserved','not_sent')),
  created_at timestamptz not null default clock_timestamp(), settled_at timestamptz,
  primary key(request_id,attempt)
);
create index ai_model_budget_attempts_day on private.ai_model_budget_attempts(day_start,state);
alter table private.ai_model_budget_totals enable row level security;
alter table private.ai_model_budget_attempts enable row level security;
revoke all on private.ai_model_budget_totals,private.ai_model_budget_attempts from public,anon,authenticated,service_role;

create function private.ai_model_budget(p_actor uuid,p_session uuid,p_request_id uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='4s' as $$
declare s private.ai_control_state; cfg jsonb; prior private.ai_model_budget_attempts; authority jsonb;
  n int; provider_id text; model_id text; version_id uuid; testing boolean; cost bigint; settled bigint; delta bigint; usage text;
  today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  month_first date:=date_trunc('month',clock_timestamp() at time zone 'Asia/Shanghai')::date;
  scopes text[]; scope_id text; period_id text; start_date date; held bigint; cap numeric; policy jsonb; reason text;
begin
  if p_action='read' then
    if not coalesce('operations:read'=any(private.ai_management_authority(p_actor,p_session)),false) then return jsonb_build_object('allowed',false);end if;
    return jsonb_build_object('allowed',true,'asOf',clock_timestamp(),'totals',coalesce((select jsonb_agg(jsonb_build_object('scope',scope,'period',period,'startsOn',starts_on,'occupiedUsd',held_nanos::numeric/1000000000))
      from private.ai_model_budget_totals where (period='day' and starts_on=today) or (period='month' and starts_on=month_first)),'[]'),
      'unsettledAttempts',(select count(*) from private.ai_model_budget_attempts where state in ('reserved','unknown_reserved') and month_start=month_first));
  end if;
  n:=(p_input->>'attempt')::int;
  if n is null or n not between 1 and 10 then raise exception using errcode='22023',message='invalid budget attempt';end if;
  if p_action='settle' then
    select * into prior from private.ai_model_budget_attempts where request_id=p_request_id and attempt=n for update;
    -- A preflight refusal has no reservation to settle. It never consumes global budget.
    if not found and p_input->>'usageStatus'='not_sent' then return jsonb_build_object('allowed',true,'notReserved',true);end if;
    if prior.actor_id is distinct from p_actor or prior.session_id is distinct from p_session then return jsonb_build_object('allowed',false);end if;
    usage:=p_input->>'usageStatus';
    if usage not in ('provider_reported','unknown_reserved','not_sent') or jsonb_typeof(p_input->'estimateUsd') is distinct from 'number'
      or not (p_input->>'estimateUsd')::numeric between 0 and 100000 then raise exception using errcode='22023',message='invalid settlement';end if;
    settled:=case when usage='unknown_reserved' then prior.reserved_nanos when usage='not_sent' then 0 else ceil((p_input->>'estimateUsd')::numeric*1000000000)::bigint end;
    if prior.state<>'reserved' then
      if prior.state=usage and prior.held_nanos=settled then return jsonb_build_object('allowed',true,'replayed',true);end if;
      raise exception using errcode='22023',message='settlement conflict';
    end if;
    delta:=settled-prior.held_nanos;
    -- Preserve attribution to the period at admission, even when settlement crosses midnight/month.
    for scope_id in select unnest(prior.scopes) order by 1 loop
      foreach period_id in array array['day','month'] loop
        start_date:=case period_id when 'day' then prior.day_start else prior.month_start end;
        update private.ai_model_budget_totals set held_nanos=held_nanos+delta where scope=scope_id and period=period_id and starts_on=start_date;
      end loop;
    end loop;
    update private.ai_model_budget_attempts set state=usage,held_nanos=settled,settled_at=clock_timestamp() where request_id=p_request_id and attempt=n;
    return jsonb_build_object('allowed',true,'occupiedUsd',settled::numeric/1000000000);
  elsif p_action<>'reserve' then raise exception using errcode='22023',message='invalid budget action';end if;
  provider_id:=p_input->>'provider';model_id:=p_input->>'modelId';version_id:=(p_input->>'configurationVersion')::uuid;
  testing:=coalesce((p_input->>'testing')::boolean,false);
  if testing then
    authority:=private.ai_control_admin(p_actor,p_session,'test_check',jsonb_build_object('requestId',p_request_id));
    if authority->>'allowed' is distinct from 'true' or n<>1 or authority->'model'->>'id' is distinct from model_id or authority->'model'->>'provider' is distinct from provider_id
      or (p_input->>'reserveUsd')::numeric>(authority->'test'->>'max_usd')::numeric then return jsonb_build_object('allowed',false,'reason','account_admission');end if;
  else
    authority:=private.ai_query_authority(p_actor,p_actor,p_session);
    if authority->>'allowed' is distinct from 'true' then return jsonb_build_object('allowed',false,'reason','account_admission');end if;
  end if;
  if not exists(select 1 from private.ai_query_audit_streams where request_id=p_request_id and actor_id=p_actor and effective_user_id=p_actor and state='running')
    then return jsonb_build_object('allowed',false,'reason','account_admission');end if;
  if provider_id not in ('deepseek','openai') or model_id is null or model_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$'
    or jsonb_typeof(p_input->'reserveUsd') is distinct from 'number' or not (p_input->>'reserveUsd')::numeric between 0 and 5
    then raise exception using errcode='22023',message='invalid reservation';end if;
  select * into s from private.ai_control_state where singleton for share;
  if s.paused or provider_id=any(s.disabled_providers) or model_id=any(s.disabled_models)
    or exists(select 1 from private.ai_model_catalog where id=model_id and (definition->>'enabled' is distinct from 'true' or not testing and definition->>'verification'='unverified'))
    then return jsonb_build_object('allowed',false,'reason','account_admission');end if;
  select config->'budget' into cfg from private.ai_control_versions where version=s.version;
  select * into prior from private.ai_model_budget_attempts where request_id=p_request_id and attempt=n for update;
  -- Never authorize a duplicate send after an ambiguous admission/worker interruption.
  if found then return jsonb_build_object('allowed',false,'reason','account_admission','alreadyReserved',true);end if;
  cost:=ceil((p_input->>'reserveUsd')::numeric*1000000000)::bigint;
  scopes:=array['global','provider:'||provider_id,'model:'||model_id];
  if testing then scopes:=array_append(scopes,'tests');end if;
  for scope_id in select unnest(scopes) order by 1 loop
    foreach period_id in array array['day','month'] loop
      start_date:=case period_id when 'day' then today else month_first end;
      insert into private.ai_model_budget_totals(scope,period,starts_on) values(scope_id,period_id,start_date) on conflict do nothing;
      select held_nanos into held from private.ai_model_budget_totals where scope=scope_id and period=period_id and starts_on=start_date for update;
      policy:=case when scope_id='global' then cfg when scope_id like 'provider:%' then cfg->'providerLimits'->provider_id when scope_id like 'model:%' then cfg->'modelLimits'->model_id else null end;
      cap:=case when scope_id='tests' and period_id='day' then coalesce((cfg->>'testDailyUsd')::numeric,0)
        when period_id='day' then (policy->>'dailyUsd')::numeric else (policy->>'monthlyUsd')::numeric end;
      if cap is not null and (cfg->>'kind'='hard' or scope_id='tests') and held+cost>floor(cap*1000000000) then
        reason:=case scope_id when 'global' then 'global_' when 'tests' then 'test_' else split_part(scope_id,':',1)||'_' end||case period_id when 'day' then 'daily' else 'monthly' end;
        return jsonb_build_object('allowed',false,'reason',reason);
      end if;
    end loop;
  end loop;
  insert into private.ai_model_budget_attempts(request_id,attempt,actor_id,session_id,configuration_version,provider,model_id,testing,day_start,month_start,scopes,reserved_nanos,held_nanos)
    values(p_request_id,n,p_actor,p_session,version_id,provider_id,model_id,testing,today,month_first,scopes,cost,cost);
  foreach scope_id in array scopes loop
    update private.ai_model_budget_totals set held_nanos=held_nanos+cost where scope=scope_id and ((period='day' and starts_on=today) or (period='month' and starts_on=month_first));
  end loop;
  return jsonb_build_object('allowed',true,'reservedUsd',cost::numeric/1000000000);
end $$;
create function public.ai_model_budget(p_actor uuid,p_session uuid,p_request_id uuid,p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_model_budget(p_actor,p_session,p_request_id,p_action,p_input)$$;
revoke all on function private.ai_model_budget(uuid,uuid,uuid,text,jsonb),public.ai_model_budget(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_model_budget(uuid,uuid,uuid,text,jsonb),public.ai_model_budget(uuid,uuid,uuid,text,jsonb) to service_role;
-- Piggyback the safe projection on existing durable audit RPCs: zero additional
-- network round trips for metadata, and a projection failure cannot undo audit.
create function private.ai_query_audit_append_operational(p_request_id uuid,p_event_id uuid,p_kind text,p_payload_digest text,p_cipher jsonb,p_metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt jsonb;
begin
  receipt:=private.ai_query_audit_append(p_request_id,p_event_id,p_kind,p_payload_digest,p_cipher);
  if p_metadata is not null then
    begin
      perform private.ai_operations_project(p_request_id,jsonb_build_array(jsonb_build_object('eventId',p_event_id,'metadata',p_metadata)));
    exception when others then raise log 'AI_OPERATIONS_PROJECTION_UNAVAILABLE';end;
  end if;
  return receipt;
end $$;
create function private.ai_query_audit_receive_operational(p_request_id uuid,p_event_id uuid,p_actor uuid,p_effective uuid,p_policy_version text,p_payload_digest text,p_cipher jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt jsonb;
begin
  receipt:=private.ai_query_audit_receive(p_request_id,p_event_id,p_actor,p_effective,p_policy_version,p_payload_digest,p_cipher);
  begin
    perform private.ai_operations_project(p_request_id,jsonb_build_array(jsonb_build_object('eventId',p_event_id,'metadata',jsonb_build_object('protocol','ai-operations/1','kind','received','type','lifecycle'))));
  exception when others then raise log 'AI_OPERATIONS_PROJECTION_UNAVAILABLE';end;
  return receipt;
end $$;
create function public.ai_query_audit_append_operational(p_request_id uuid,p_event_id uuid,p_kind text,p_payload_digest text,p_cipher jsonb,p_metadata jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_query_audit_append_operational(p_request_id,p_event_id,p_kind,p_payload_digest,p_cipher,p_metadata)$$;
create function public.ai_query_audit_receive_operational(p_request_id uuid,p_event_id uuid,p_actor uuid,p_effective uuid,p_policy_version text,p_payload_digest text,p_cipher jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_query_audit_receive_operational(p_request_id,p_event_id,p_actor,p_effective,p_policy_version,p_payload_digest,p_cipher)$$;
revoke all on function private.ai_query_audit_append_operational(uuid,uuid,text,text,jsonb,jsonb),public.ai_query_audit_append_operational(uuid,uuid,text,text,jsonb,jsonb),
  private.ai_query_audit_receive_operational(uuid,uuid,uuid,uuid,text,text,jsonb),public.ai_query_audit_receive_operational(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_audit_append_operational(uuid,uuid,text,text,jsonb,jsonb),public.ai_query_audit_append_operational(uuid,uuid,text,text,jsonb,jsonb),
  private.ai_query_audit_receive_operational(uuid,uuid,uuid,uuid,text,text,jsonb),public.ai_query_audit_receive_operational(uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;
-- Fixed administration operations. No generic table, URL, SQL or script endpoint.
create table private.ai_model_tests (
 id uuid primary key, model_id text not null references private.ai_model_catalog(id), catalog_revision uuid not null,
 actor_id uuid not null, session_id uuid not null, kind text not null check(kind in ('connection','structured','tools','stream')),
 state text not null default 'running' check(state in ('running','passed','failed')), max_usd numeric not null check(max_usd>0 and max_usd<=.05),
 started_at timestamptz not null default clock_timestamp(),finished_at timestamptz,summary jsonb not null default '{}'
);
create index ai_model_tests_model on private.ai_model_tests(model_id,catalog_revision,kind,started_at desc);
create table private.ai_alert_rules (id text primary key, definition jsonb not null, revision uuid not null default gen_random_uuid());
create table private.ai_alerts (
 id uuid primary key default gen_random_uuid(), rule_id text not null references private.ai_alert_rules(id),
 state text not null check(state in ('new','acknowledged','ongoing','recovered','closed','silenced')),
 first_at timestamptz not null default clock_timestamp(),last_at timestamptz not null default clock_timestamp(),
 recovered_at timestamptz,silenced_until timestamptz, observed numeric, sample_count bigint not null default 0,
 unique(rule_id)
);
alter table private.ai_model_tests enable row level security;
alter table private.ai_alert_rules enable row level security;
alter table private.ai_alerts enable row level security;
revoke all on private.ai_model_tests,private.ai_alert_rules,private.ai_alerts from public,anon,authenticated,service_role;
-- No synthetic healthy states or outbound notifications. Evaluation is bounded and
-- coalesced per rule (including concurrent administrators); last_at is evidence time.
create function private.ai_alert_evaluate() returns void
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare r record; a private.ai_alerts; metric text; n bigint; value numeric; threshold numeric; f timestamptz; t timestamptz:=clock_timestamp(); o jsonb;
begin
 for r in select * from private.ai_alert_rules where definition->>'enabled'='true' order by id for update skip locked loop
  select * into a from private.ai_alerts where rule_id=r.id;
  if found and t-a.last_at<make_interval(mins=>greatest(1,(r.definition->>'cooldownMinutes')::int)) then continue;end if;
  f:=t-make_interval(mins=>least(1440,(r.definition->>'windowMinutes')::int));metric:=r.definition->>'metric';threshold:=(r.definition->>'threshold')::numeric;
  n:=0;value:=null;
  if metric in ('unknown_percent','fallback_percent','calls_per_request','estimated_usd') then
   select count(*),case metric when 'unknown_percent' then 100.0*count(*) filter(where metadata->>'usageStatus'='unknown_reserved')/nullif(count(*),0)
    when 'fallback_percent' then 100.0*count(*) filter(where metadata->>'fallback'='true')/nullif(count(*),0)
    when 'calls_per_request' then count(*)::numeric/nullif(count(distinct request_id),0)
    else sum((metadata->>'estimateUsd')::numeric) filter(where metadata->>'usageStatus'='provider_reported') end into n,value
    from private.ai_operation_events e where at>=f and at<t and metadata->>'type'='model_attempt' and metadata->>'usageStatus'<>'not_sent' and not exists(select 1 from private.ai_model_tests x where x.id=e.request_id);
  elsif metric='consecutive_failures' then
   with recent as(select state,received_at from private.ai_operation_requests where received_at>=f and received_at<t and state in ('completed','partial','incomplete','failed') and metadata->>'testing' is distinct from 'true' order by received_at desc limit 1000), marked as(select state,sum(case when state<>'failed' then 1 else 0 end) over(order by received_at desc) successes from recent)
   select count(*),count(*) filter(where state='failed' and successes=0) into n,value from marked;
  elsif metric='configuration_failures' then
   select count(*),count(*) filter(where metadata->>'errorCode' in ('invalid_configuration','not_configured','admission_service_unavailable')) into n,value from private.ai_operation_events where at>=f and at<t and metadata->>'type'='model_attempt';
  elsif metric='budget_percent' then
   select 1,max(100.0*b.held_nanos/1000000000/nullif((v.config->'budget'->>case b.period when 'day' then 'dailyUsd' else 'monthlyUsd' end)::numeric,0)) into n,value
    from private.ai_model_budget_totals b cross join private.ai_control_state s join private.ai_control_versions v on v.version=s.version
    where b.scope='global' and b.starts_on=case b.period when 'day' then (t at time zone 'Asia/Shanghai')::date else date_trunc('month',t at time zone 'Asia/Shanghai')::date end;
  elsif metric='telemetry_gap' then
   select count(*),extract(epoch from t-max(a.occurred_at))/60 into n,value from private.ai_query_audit_events a
    where a.occurred_at>=f and a.occurred_at<t and a.kind<>'delivery_chunk' and not exists(select 1 from private.ai_operation_events e where e.event_id=a.event_id);
  else
   select count(*),case metric when 'failure_rate' then 100.0*count(*) filter(where state='failed')/nullif(count(*) filter(where state in ('completed','partial','incomplete','failed')),0)
    when 'p95_ms' then percentile_cont(.95) within group(order by (metadata->>'durationMs')::numeric)
    when 'file_failure_percent' then 100.0*count(*) filter(where (metadata->>'filesRequested')::int>0 and metadata->>'filesRequested' is distinct from metadata->>'filesCompleted')/nullif(count(*) filter(where (metadata->>'filesRequested')::int>0),0)
    when 'stalled' then count(*) filter(where state in ('received','running') and updated_at<t-interval '3 minutes')::numeric end into n,value
    from private.ai_operation_requests where received_at>=f and received_at<t and metadata->>'testing' is distinct from 'true';
  end if;
  if n>=(r.definition->>'minimumSamples')::int and value>=threshold then
   insert into private.ai_alerts(rule_id,state,observed,sample_count) values(r.id,'new',value,n)
    on conflict(rule_id) do update set last_at=t,observed=value,sample_count=n,recovered_at=null,
    state=case when private.ai_alerts.state='silenced' and private.ai_alerts.silenced_until>t then 'silenced' when private.ai_alerts.state='acknowledged' then 'acknowledged' when private.ai_alerts.state in ('new','ongoing') then 'ongoing' else 'new' end;
  elsif a.id is not null then
   update private.ai_alerts set last_at=t,observed=value,sample_count=n,
    state=case when state='silenced' and silenced_until>t then 'silenced' when n>=(r.definition->>'minimumSamples')::int and value<threshold then 'recovered' else state end,
    recovered_at=case when n>=(r.definition->>'minimumSamples')::int and value<threshold then coalesce(recovered_at,t) else recovered_at end where id=a.id;
  end if;
 end loop;
end $$;
revoke all on function private.ai_alert_evaluate() from public,anon,authenticated,service_role;
-- Durable, cross-instance coalescing. Triggered after real AI responses even when
-- nobody has the management page open. Never delays delivery or probes a model.
create table private.ai_alert_clock (singleton boolean primary key default true check(singleton), last_at timestamptz not null);
insert into private.ai_alert_clock values(true,'epoch');
alter table private.ai_alert_clock enable row level security;
revoke all on private.ai_alert_clock from public,anon,authenticated,service_role;
create function public.ai_control_alert_tick() returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='3s' as $$
begin
 if not pg_try_advisory_xact_lock(190419,621126) then return jsonb_build_object('evaluated',false);end if;
 update private.ai_alert_clock set last_at=clock_timestamp() where singleton and last_at<=clock_timestamp()-interval '1 minute';
 if not found then return jsonb_build_object('evaluated',false);end if;
 perform private.ai_alert_evaluate();
 return jsonb_build_object('evaluated',true);
end $$;
revoke all on function public.ai_control_alert_tick() from public,anon,authenticated,service_role;
grant execute on function public.ai_control_alert_tick() to service_role;
create table private.ai_offline_evaluations (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,session_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),configuration_version uuid,
 summary jsonb not null check(octet_length(summary::text)<=16384)
);
alter table private.ai_offline_evaluations enable row level security;
revoke all on private.ai_offline_evaluations from public,anon,authenticated,service_role;
create index ai_offline_evaluations_time on private.ai_offline_evaluations(created_at desc);
create function private.ai_control_admin(p_actor uuid,p_session uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='6s' as $$
declare caps text[]; needed text; reason text; old jsonb; after_value jsonb; model private.ai_model_catalog; test private.ai_model_tests;
 target uuid; tab text; columns text; assignments text; domain text; expected uuid; s private.ai_control_state; selected_id text; policy jsonb;
begin
 caps:=private.ai_management_authority(p_actor,p_session);
 needed:=case when p_action in ('registry','diagnostics','evaluations','evaluation_save') then 'operations:read'
  when p_action in ('catalog','inherit','approve') then 'models:write'
  when p_action in ('test_start','test_check','test_finish') then 'tests:run'
  when p_action in ('grants','grant') then 'grants:write'
  when p_action in ('alert_rule','alert_action') then 'emergency:write'
  when p_action='global' then 'emergency:write' else null end;
 if needed is null or caps is null or not (needed=any(caps) or p_action in ('registry','evaluations','evaluation_save') and ('models:write'=any(caps) or 'tests:run'=any(caps))) then return jsonb_build_object('allowed',false);end if;
 if p_action='evaluations' then
  return jsonb_build_object('allowed',true,'runs',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,created_at,configuration_version,summary from private.ai_offline_evaluations order by created_at desc limit 100)x),'[]'));
 elsif p_action='evaluation_save' then
  if p_input->'summary'->>'suiteVersion'<>'ai6-control-1' or p_input->'summary'->>'scope'<>'synthetic_offline_only' or p_input->'summary'->>'paidCalls'<>'0' or jsonb_array_length(p_input->'summary'->'results')>30 then raise exception using errcode='22023',message='invalid registered evaluation';end if;
  insert into private.ai_offline_evaluations(actor_id,session_id,configuration_version,summary) values(p_actor,p_session,(p_input->>'configurationVersion')::uuid,p_input->'summary') returning to_jsonb(ai_offline_evaluations.*) into after_value;
  return jsonb_build_object('allowed',true,'run',after_value);
 elsif p_action='registry' then
  return jsonb_build_object('allowed',true,'models',coalesce((select jsonb_agg(to_jsonb(c) order by id) from private.ai_model_catalog c),'[]'),
   'tests',coalesce((select jsonb_agg(to_jsonb(t)) from(select id,model_id,catalog_revision,kind,state,started_at,finished_at,summary from private.ai_model_tests order by started_at desc limit 100)t),'[]'));
 elsif p_action='diagnostics' then
  perform private.ai_alert_evaluate();
  return jsonb_build_object('allowed',true,'asOf',clock_timestamp(),
   'rules',coalesce((select jsonb_agg(to_jsonb(r) order by id) from private.ai_alert_rules r),'[]'),
   'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by last_at desc) from private.ai_alerts a),'[]'),
   'toolsHealth',coalesce((select jsonb_agg(to_jsonb(x)) from(select tool->>'name' name,count(*) calls,count(*) filter(where tool->>'status'='limited') failures,
     max(e.at) filter(where tool->>'status'='ready') last_success,max(e.at) filter(where tool->>'status'='limited') last_failure
     from private.ai_operation_events e cross join lateral jsonb_array_elements(coalesce(e.metadata->'tools','[]')) tool
     where e.at>clock_timestamp()-interval '24 hours' and e.metadata->>'type'='summary' group by 1 order by 1 limit 80)x),'[]'),
   'errors',coalesce((select jsonb_agg(to_jsonb(x)) from(select metadata->>'errorCode' code,metadata->>'provider' provider,metadata->>'model' model,metadata->>'tool' tool,metadata->>'phase' phase,
     count(distinct request_id) requests,min(at) first_at,max(at) last_at from private.ai_operation_events where at>clock_timestamp()-interval '24 hours' and metadata ? 'errorCode' group by 1,2,3,4,5 order by count(distinct request_id) desc limit 100)x),'[]'));
 elsif p_action='grants' then
  if length(coalesce(p_input->>'search',''))>100 then raise exception using errcode='22023',message='invalid search';end if;
  return jsonb_build_object('allowed',true,'users',coalesce((select jsonb_agg(to_jsonb(x)) from (
   select u.id,left(coalesce(u.raw_user_meta_data->>'name',u.raw_user_meta_data->>'full_name',''),120) name,r.role,
    to_jsonb(m) management,to_jsonb(q) query,to_jsonb(ar) audit_read,to_jsonb(ae) audit_export,to_jsonb(l) lease,to_jsonb(b) business,to_jsonb(k) knowledge
   from auth.users u join public.user_roles r on r.user_id=u.id
   left join private.ai_management_grants m on m.user_id=u.id left join private.ai_query_grants q on q.user_id=u.id
   left join private.ai_audit_read_grants ar on ar.user_id=u.id left join private.ai_audit_export_grants ae on ae.user_id=u.id
   left join private.ai_lease_research_grants l on l.user_id=u.id left join private.ai_business_research_grants b on b.user_id=u.id
   left join private.ai_knowledge_grants k on k.user_id=u.id
   where u.deleted_at is null and (p_input->>'beforeId' is null or u.id>(p_input->>'beforeId')::uuid)
    and (coalesce(p_input->>'search','')='' or u.id::text=p_input->>'search' or position(lower(p_input->>'search') in lower(coalesce(u.raw_user_meta_data->>'name',u.raw_user_meta_data->>'full_name','')))>0)
   order by u.id limit 26)x),'[]'));
 end if;
 reason:=p_input->>'reason';
 if p_action not in ('test_check','test_finish') and (reason is null or length(btrim(reason)) not between 1 and 500) then raise exception using errcode='22023',message='reason required';end if;
 if p_action in ('catalog','inherit','approve') then
  selected_id:=coalesce(p_input->'definition'->>'id',p_input->>'modelId');
  if selected_id is null or selected_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$' then raise exception using errcode='22023',message='invalid model';end if;
  -- Publication and registry updates share the same lock order.
  select * into s from private.ai_control_state where singleton for update;
  select * into model from private.ai_model_catalog where id=selected_id for update;
  old:=to_jsonb(model);
  expected:=(p_input->>'expectedRevision')::uuid;
  if p_action<>'inherit' and model.revision is distinct from expected then return jsonb_build_object('allowed',true,'conflict',true);end if;
  if p_action='approve' then
   if model.id is null or exists(select 1 from unnest(array['connection','structured','tools','stream']) k where not exists(select 1 from private.ai_model_tests t where t.model_id=model.id and t.catalog_revision=model.revision and t.kind=k and t.state='passed')) then return jsonb_build_object('allowed',false);end if;
   after_value:=model.definition||jsonb_build_object('verification','verified','verifiedAt',clock_timestamp());
  else
   after_value:=p_input->'definition';
   if jsonb_typeof(after_value) is distinct from 'object' or octet_length(after_value::text)>4096
    or exists(select 1 from jsonb_object_keys(after_value) k where k not in ('id','provider','model','name','enabled','verification','verifiedAt','tools','structured','streaming','reasoning','continuation','contextLimit','outputLimit','inputRate','cachedInputRate','outputRate','currency','priceSource','priceDate'))
    or after_value->>'id' is distinct from selected_id or after_value->>'provider' not in ('deepseek','openai') then raise exception using errcode='22023',message='invalid candidate';end if;
   if p_action='inherit' and model.id is not null then return jsonb_build_object('allowed',true,'conflict',true);end if;
   after_value:=after_value||jsonb_build_object('verification',case p_action when 'inherit' then 'environment_legacy' else 'unverified' end,'verifiedAt',null);
  end if;
  if model.id is null and (select count(*) from private.ai_model_catalog)>=100 then raise exception using errcode='22023',message='catalog full';end if;
  insert into private.ai_model_catalog(id,definition) values(selected_id,after_value) on conflict(id) do update set definition=excluded.definition,revision=gen_random_uuid(),updated_at=clock_timestamp();
  select to_jsonb(c) into after_value from private.ai_model_catalog c where id=selected_id;
 elsif p_action in ('test_start','test_check','test_finish') then
  target:=(p_input->>'requestId')::uuid;
  if p_action='test_start' then
   select * into s from private.ai_control_state where singleton for share;
   if s.paused or not exists(select 1 from private.ai_query_control where enabled) then return jsonb_build_object('allowed',false);end if;
   select * into model from private.ai_model_catalog where id=p_input->>'modelId' for share;
   if model.id is null or model.revision is distinct from (p_input->>'expectedRevision')::uuid or model.definition->>'enabled'<>'true' or model.id=any(s.disabled_models) or model.definition->>'model'=any(s.disabled_models) or model.definition->>'provider'=any(s.disabled_providers) then return jsonb_build_object('allowed',false);end if;
   if exists(select 1 from private.ai_model_tests where actor_id=p_actor and started_at>clock_timestamp()-interval '1 minute') then return jsonb_build_object('allowed',false);end if;
   insert into private.ai_model_tests(id,model_id,catalog_revision,actor_id,session_id,kind,max_usd) values(target,model.id,model.revision,p_actor,p_session,p_input->>'kind',(p_input->>'maxUsd')::numeric) returning * into test;
  else
   select * into test from private.ai_model_tests where id=target and actor_id=p_actor and session_id=p_session for update;
   if not found then return jsonb_build_object('allowed',false);end if;
   select * into model from private.ai_model_catalog where id=test.model_id for share;
   if model.revision<>test.catalog_revision then return jsonb_build_object('allowed',false);end if;
  end if;
  if p_action='test_finish' then
   if test.state<>'running' then return jsonb_build_object('allowed',false);end if;
   if p_input->>'state' not in ('passed','failed') or octet_length((p_input->'summary')::text)>4096 then raise exception using errcode='22023',message='invalid test result';end if;
   update private.ai_model_tests set state=p_input->>'state',finished_at=clock_timestamp(),summary=p_input->'summary' where id=target;
  else
   select * into s from private.ai_control_state where singleton for share;
   if test.state<>'running' or test.started_at<clock_timestamp()-interval '2 minutes' or s.paused or model.definition->>'enabled'<>'true'
    or model.definition->>'provider'=any(s.disabled_providers) or model.id=any(s.disabled_models) or model.definition->>'model'=any(s.disabled_models)
    or not exists(select 1 from private.ai_query_control where enabled) then return jsonb_build_object('allowed',false);end if;
   if p_action='test_check' then return jsonb_build_object('allowed',true,'model',model.definition,'test',to_jsonb(test));end if;
  end if;
  after_value:=jsonb_build_object('testId',target,'state',p_input->>'state');
 elsif p_action='grant' then
  target:=(p_input->>'targetId')::uuid;domain:=p_input->>'domain';policy:=p_input->'policy';
  if target=p_actor or not exists(select 1 from auth.users u join public.user_roles r on r.user_id=u.id where u.id=target and r.role='admin' and u.deleted_at is null and (u.banned_until is null or u.banned_until<clock_timestamp())) then return jsonb_build_object('allowed',false);end if;
  tab:=case domain when 'management' then 'ai_management_grants' when 'query' then 'ai_query_grants' when 'audit_read' then 'ai_audit_read_grants' when 'audit_export' then 'ai_audit_export_grants' when 'lease' then 'ai_lease_research_grants' when 'business' then 'ai_business_research_grants' when 'knowledge' then 'ai_knowledge_grants' else null end;
  columns:=case domain when 'management' then 'capabilities,valid_until' when 'query' then 'enabled,valid_until,capabilities,fields,all_submarkets,submarkets,all_buildings,building_ids'
   when 'audit_read' then 'valid_until' when 'audit_export' then 'enabled,valid_until' when 'lease' then 'enabled,valid_until,sources,allow_details,allow_financials,allow_export,min_group_size,all_submarkets,submarkets,all_buildings,building_ids'
   when 'business' then 'enabled,valid_until,modules,profile_fields,allow_submissions,allow_export,all_submarkets,submarkets,all_buildings,building_ids' when 'knowledge' then 'enabled,valid_until,document_ids,allow_public_search' end;
  if tab is null or jsonb_typeof(policy) is distinct from 'object' or exists(select 1 from jsonb_object_keys(policy) k where not k=any(string_to_array(columns,','))) then raise exception using errcode='22023',message='invalid grant';end if;
  -- Serialize a newly created target policy as well as existing revisions.
  perform pg_advisory_xact_lock(hashtextextended(tab||target::text,0));
  execute format('select to_jsonb(g) from private.%I g where user_id=$1 for update',tab) into old using target;
  expected:=(p_input->>'expectedRevision')::uuid;
  if coalesce((old->>'revision')::uuid,case when old is not null then md5(old::text)::uuid else null end) is distinct from expected then return jsonb_build_object('allowed',true,'conflict',true);end if;
  policy:=policy||jsonb_build_object('user_id',target,'revision',gen_random_uuid(),case domain when 'management' then 'reason' when 'audit_read' then 'grant_reference' when 'audit_export' then 'grant_reference' else 'change_reference' end,reason);
  select string_agg(format('%I=excluded.%I',c,c),',') into assignments from jsonb_object_keys(policy) c where c<>'user_id';
  execute format('insert into private.%I select (jsonb_populate_record(null::private.%I,$1)).* on conflict(user_id) do update set %s returning to_jsonb(%I.*)',tab,tab,assignments,tab) into after_value using policy;
 elsif p_action='global' then
  select to_jsonb(c) into old from private.ai_query_control c where singleton for update;
  if (old->>'revision')::uuid is distinct from (p_input->>'expectedRevision')::uuid then return jsonb_build_object('allowed',true,'conflict',true);end if;
  update private.ai_query_control set enabled=(p_input->>'enabled')::boolean,change_reference=reason where singleton returning to_jsonb(ai_query_control.*) into after_value;
 elsif p_action='alert_rule' then
  selected_id:=p_input->'rule'->>'id';
  if selected_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$' or (select count(*) from private.ai_alert_rules)>=30 and not exists(select 1 from private.ai_alert_rules where id=selected_id) then raise exception using errcode='22023',message='invalid alert rule';end if;
  perform pg_advisory_xact_lock(hashtextextended('alert:'||selected_id,0));
  select to_jsonb(r) into old from private.ai_alert_rules r where id=selected_id for update;
  if (old->>'revision')::uuid is distinct from (p_input->>'expectedRevision')::uuid then return jsonb_build_object('allowed',true,'conflict',true);end if;
  insert into private.ai_alert_rules(id,definition) values(selected_id,p_input->'rule') on conflict(id) do update set definition=excluded.definition,revision=gen_random_uuid() returning to_jsonb(ai_alert_rules.*) into after_value;
 elsif p_action='alert_action' then
  select to_jsonb(a) into old from private.ai_alerts a where id=(p_input->>'alertId')::uuid for update;
  if old is null then return jsonb_build_object('allowed',false);end if;
  if p_input->>'state' not in ('acknowledged','closed','silenced') or p_input->>'state'='silenced' and ((p_input->>'until')::timestamptz is null or (p_input->>'until')::timestamptz not between clock_timestamp() and clock_timestamp()+interval '7 days') then raise exception using errcode='22023',message='invalid alert action';end if;
  update private.ai_alerts set state=p_input->>'state',silenced_until=(p_input->>'until')::timestamptz where id=(p_input->>'alertId')::uuid returning to_jsonb(ai_alerts.*) into after_value;
 end if;
 insert into private.ai_management_events(actor_id,session_id,action,reason,before_state,after_state) values(p_actor,p_session,p_action,coalesce(reason,'fixed protocol completion'),old,after_value);
 return jsonb_build_object('allowed',true,'result',after_value);
end $$;
create function public.ai_control_admin(p_actor uuid,p_session uuid,p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.ai_control_admin(p_actor,p_session,p_action,p_input)$$;
revoke all on function private.ai_control_admin(uuid,uuid,text,jsonb),public.ai_control_admin(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_control_admin(uuid,uuid,text,jsonb),public.ai_control_admin(uuid,uuid,text,jsonb) to service_role;

commit;
