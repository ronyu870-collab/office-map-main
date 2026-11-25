-- Phase 06. Closed by default. No production grants, provider keys or sample facts.
begin;
create table private.pitch_ai_config(id boolean primary key default true check(id),revision integer not null default 1,config jsonb not null,updated_by uuid references auth.users(id),updated_at timestamptz not null default now());
insert into private.pitch_ai_config(id,config) values(true,'{"enabled":false,"revision":1,"default":null,"extraction":null,"analysis":null,"enabledTasks":[],"maxInputBytes":12000,"retries":0,"concurrency":1,"batchUsd":0.25,"dailyUsd":1,"monthlyUsd":10,"fallback":"none","vision":false,"embedding":false}');
create table private.pitch_ai_policies(
 asset_id uuid not null,asset_version integer not null,revision integer not null,mode text not null check(mode in('deterministic_only','controlled_internal_ai','redacted_external','approved_provider')),
 provider text check(provider in('deepseek','openai')),model text,approved_text text not null default '' check(octet_length(approved_text)<=24000),reason text not null,
 approved_by uuid not null references auth.users(id),expires_at timestamptz not null,updated_at timestamptz not null default now(),
 primary key(asset_id,asset_version),foreign key(asset_id,asset_version) references public.pitch_asset_versions(asset_id,version),
 check(mode not in('redacted_external','approved_provider') or (provider is not null and model is not null)),check(mode<>'redacted_external' or length(approved_text)>0)
);
create table private.pitch_ai_tasks(
 id uuid primary key,batch_id uuid not null,actor_id uuid not null references auth.users(id),session_id uuid not null,
 asset_id uuid not null,asset_version integer not null,request jsonb not null,request_hash text not null,
 state text not null default 'queued' check(state in('queued','processing','completed','failed','cancelled','paused')),
 attempts integer not null default 0,token uuid,lease_until timestamptz,cache_key text,policy_revision integer,config_revision integer,
 result jsonb,error_code text,cached boolean not null default false,reserved_usd numeric not null default 0,charged_usd numeric not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(asset_id,asset_version) references public.pitch_asset_versions(asset_id,version)
);
create index pitch_ai_queue on private.pitch_ai_tasks(actor_id,state,created_at);
create index pitch_ai_batch on private.pitch_ai_tasks(batch_id,actor_id);
create index pitch_ai_task_time on private.pitch_ai_tasks(created_at desc,id);
create index pitch_ai_budget on private.pitch_ai_tasks(created_at) include(reserved_usd,charged_usd);
create table private.pitch_ai_reservations(id uuid primary key default gen_random_uuid(),task_id uuid not null references private.pitch_ai_tasks(id),token uuid not null,usd numeric not null check(usd>=0),created_at timestamptz not null default clock_timestamp());
create index pitch_ai_reservation_time on private.pitch_ai_reservations(created_at);
create index pitch_ai_reservation_task on private.pitch_ai_reservations(task_id,token,created_at desc);
create table private.pitch_ai_cache(actor_id uuid not null references auth.users(id),cache_key text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,cache_key));
create table private.pitch_ai_attempts(id uuid primary key default gen_random_uuid(),task_id uuid not null references private.pitch_ai_tasks(id),token uuid not null unique,record jsonb not null,created_at timestamptz not null default now());
create index pitch_ai_attempt_time on private.pitch_ai_attempts(created_at desc);
create table private.pitch_ai_events(id uuid primary key,actor_id uuid not null references auth.users(id),event text not null,template_id text,asset_id uuid references public.pitch_content_assets(id),project_id uuid references public.pitch_projects(id),task_id uuid references private.pitch_ai_tasks(id),layout text,created_at timestamptz not null default now());
create index pitch_ai_event_time on private.pitch_ai_events(created_at desc);
create table private.pitch_ai_candidates(id uuid primary key,actor_id uuid not null references auth.users(id),project_id uuid not null references public.pitch_projects(id),project_version integer not null,slide_id uuid not null,asset_id uuid not null,asset_version integer not null,content jsonb not null,scope jsonb not null,state text not null default 'submitted' check(state in('submitted','accepted','rejected','withdrawn')),materialized_id uuid references public.pitch_content_assets(id),reviewed_by uuid references auth.users(id),created_at timestamptz not null default now());
create table private.pitch_ai_origins(asset_id uuid primary key references public.pitch_content_assets(id),source_asset_id uuid not null,source_version integer not null,task_id uuid references private.pitch_ai_tasks(id),candidate_id uuid references private.pitch_ai_candidates(id),foreign key(source_asset_id,source_version) references public.pitch_asset_versions(asset_id,version),check(asset_id<>source_asset_id));
-- No browser or service-role table bypass. The existing authenticated RPC is the only writer.
alter table private.pitch_ai_config enable row level security;
alter table private.pitch_ai_policies enable row level security;
alter table private.pitch_ai_tasks enable row level security;
alter table private.pitch_ai_cache enable row level security;
alter table private.pitch_ai_attempts enable row level security;
alter table private.pitch_ai_events enable row level security;
alter table private.pitch_ai_candidates enable row level security;
alter table private.pitch_ai_origins enable row level security;
alter table private.pitch_ai_reservations enable row level security;
revoke all on private.pitch_ai_reservations from public,anon,authenticated,service_role;
revoke all on private.pitch_ai_config,private.pitch_ai_policies,private.pitch_ai_tasks,private.pitch_ai_cache,private.pitch_ai_attempts,private.pitch_ai_events,private.pitch_ai_candidates,private.pitch_ai_origins from public,anon,authenticated,service_role;

-- Retain all pre-existing checks, add transitive provenance for adopted AI/user candidates.
create function private.pitch_ai_candidate_visible(p_user uuid,p_session uuid,p_id uuid,p_cap text default 'generate') returns boolean
language plpgsql security definer set search_path='' as $$
declare k private.pitch_ai_candidates;a public.pitch_content_assets;g public.pitch_business_generations;ref jsonb;
begin
 select * into k from private.pitch_ai_candidates where id=p_id;
 if k.id is null or k.state not in('submitted','accepted') then return false;end if;
 select * into a from public.pitch_content_assets where id=k.asset_id;
 if a.id is null or a.state<>'published' or a.current_version<>k.asset_version or not a.allow_internal_generation or a.valid_from>current_date or a.valid_until<current_date
 or not private.pitch_access(p_user,p_session,k.scope->>'organizationId',k.scope->>'region',k.scope->>'city',k.scope->>'businessLine',p_cap)
 or p_cap='client' and (a.is_test_data or not a.allow_client_export) then return false;end if;
 -- Consent shares this page snapshot, never its private project or file. All
 -- underlying documents, media and business dependencies still need independent access.
 for ref in select value from jsonb_array_elements(k.content->'sources') loop
  if ref->>'documentId' is not null and not private.pitch_document_visible(p_user,p_session,(ref->>'documentId')::uuid) then return false;end if;
 end loop;
 if exists(select 1 from private.pitch_content_media(k.content) m where not private.pitch_media_visible(p_user,p_session,m.id,m.version)) then return false;end if;
 select * into g from public.pitch_business_generations where project_id=a.generated_project_id;
 if g.project_id is not null then
  -- Account-bound live snapshots cannot be republished through page submission.
  if jsonb_array_length(g.snapshots)>0 then return false;end if;
  for ref in select value from jsonb_array_elements(g.bindings) loop
   if not private.pitch_version_visible(p_user,p_session,(ref->>'id')::uuid,(ref->>'version')::integer,p_cap) then return false;end if;
  end loop;
 end if;
 return true;
end $$;
do $$begin execute replace(pg_get_functiondef('private.pitch_asset_visible(uuid,uuid,uuid,text)'::regprocedure),'FUNCTION private.pitch_asset_visible(', 'FUNCTION private.pitch_asset_visible_v5(');end$$;
create or replace function private.pitch_asset_visible(p_user uuid,p_session uuid,p_id uuid,p_cap text default 'read') returns boolean
language sql security definer set search_path='' as $$
 select private.pitch_asset_visible_v5(p_user,p_session,p_id,p_cap)
 and not exists(select 1 from private.pitch_ai_origins o where o.asset_id=p_id and
  ((case when o.candidate_id is not null then not private.pitch_ai_candidate_visible(p_user,p_session,o.candidate_id,case when p_cap='client' then 'client' else 'generate' end)
   else not private.pitch_version_visible(p_user,p_session,o.source_asset_id,o.source_version,case when p_cap='client' then 'client' else 'generate' end) end)
   or exists(select 1 from private.pitch_ai_candidates c where c.id=o.candidate_id and c.state<>'accepted')))
$$;
do $$begin execute replace(pg_get_functiondef('private.pitch_version_visible(uuid,uuid,uuid,integer,text)'::regprocedure),'FUNCTION private.pitch_version_visible(', 'FUNCTION private.pitch_version_visible_v5(');end$$;
create or replace function private.pitch_version_visible(p_user uuid,p_session uuid,p_id uuid,p_version integer,p_cap text default 'read') returns boolean
language sql security definer set search_path='' as $$
 select private.pitch_version_visible_v5(p_user,p_session,p_id,p_version,p_cap)
 and not exists(select 1 from private.pitch_ai_origins o where o.asset_id=p_id and
  ((case when o.candidate_id is not null then not private.pitch_ai_candidate_visible(p_user,p_session,o.candidate_id,case when p_cap='client' then 'client' else 'generate' end)
   else not private.pitch_version_visible_v5(p_user,p_session,o.source_asset_id,o.source_version,case when p_cap='client' then 'client' else 'generate' end) end)
   or exists(select 1 from private.pitch_ai_candidates c where c.id=o.candidate_id and c.state<>'accepted')))
$$;

create function private.pitch_ai_authorized(p_actor uuid,p_session uuid,p_task uuid) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from private.pitch_ai_tasks t join public.pitch_content_assets a on a.id=t.asset_id
 where t.id=p_task and t.actor_id=p_actor and a.current_version=t.asset_version and a.state<>'archived'
 and private.pitch_version_visible(p_actor,p_session,t.asset_id,t.asset_version,'generate')
 and (t.policy_revision is null or exists(select 1 from private.pitch_ai_policies p join private.pitch_ai_config c on c.id
 where p.asset_id=t.asset_id and p.asset_version=t.asset_version and p.revision=t.policy_revision and c.revision=t.config_revision
 and c.config->>'enabled'='true' and c.config->'enabledTasks' ? (t.request->>'task') and p.expires_at>clock_timestamp()
 and private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'admin')
 and p.mode in('redacted_external','approved_provider') and (p.mode='redacted_external' or private.pitch_version_visible(p_actor,p_session,t.asset_id,t.asset_version,'ai')))))
$$;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_v5;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op text:=p_input->>'action';aid uuid:=(p_input->>'assetId')::uuid;tid uuid:=(p_input->>'taskId')::uuid;bid uuid:=(p_input->>'batchId')::uuid;
 a public.pitch_content_assets;v public.pitch_asset_versions;p private.pitch_ai_policies;t private.pitch_ai_tasks;c private.pitch_ai_config;candidate private.pitch_ai_candidates;
 item jsonb;result jsonb;profile jsonb;key text;amount numeric;budget numeric;counter integer;is_admin boolean;pid uuid:=(p_input->>'projectId')::uuid;
begin
 if op='library_confirm' and exists(select 1 from jsonb_array_elements(p_input->'items') x join private.pitch_ai_origins o on o.asset_id=(x->>'assetId')::uuid) then
  for item in select value from jsonb_array_elements(p_input->'items') loop
   if exists(select 1 from private.pitch_ai_origins where asset_id=(item->>'assetId')::uuid) then
    select * into a from public.pitch_content_assets where id=(item->>'assetId')::uuid for update;
    if a.current_version<>(item->>'expectedVersion')::integer or not private.pitch_version_visible(p_actor,p_session,a.id,a.current_version,'generate') or not private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain') or item->'asset'->>'state'<>'published' then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    perform private.pitch_studio_access_v5(p_actor,p_session,item||jsonb_build_object('action','asset_save'));
    update public.pitch_content_assets set search_tokens=array(select jsonb_array_elements_text(item->'tokens')) where id=a.id;
   else perform private.pitch_studio_access_v5(p_actor,p_session,jsonb_build_object('action','library_confirm','items',jsonb_build_array(item),'acknowledgePartial',p_input->'acknowledgePartial'));end if;
   counter:=coalesce(counter,0)+1;
  end loop;return jsonb_build_object('confirmed',counter);
 end if;
 if op not like 'ai_%' then
  result:=private.pitch_studio_access_v5(p_actor,p_session,p_input);
  if op in('workspace_task_complete','workspace_task_fail','workspace_save','export_complete','export_fail') then
   insert into private.pitch_ai_events(id,actor_id,event,project_id,layout,template_id)
    values(gen_random_uuid(),p_actor,case op when 'workspace_save' then 'corrected' when 'workspace_task_complete' then 'generated' when 'workspace_task_fail' then 'generation_failed' when 'export_complete' then 'export_completed' else 'export_failed' end,pid,
     case when op='workspace_save' then p_input->'slides'->0->'scene'->>'layoutId' end,
     case when op like 'workspace_task_%' then (select coalesce(command->'part'->>'templateId',command->'part'->'parameters'->>'templateId') from private.pitch_workspace_tasks where id=(p_input->>'taskId')::uuid) end);
  end if;
  return result;
 end if;
 perform private.pitch_studio_access_v5(p_actor,p_session,jsonb_build_object('action','catalog'));
 if not private.pitch_access(p_actor,p_session) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
 is_admin:=private.pitch_access(p_actor,p_session,p_cap=>'admin');
 select * into c from private.pitch_ai_config where id;
 if op='ai_config' then
  if is_admin then return c.config;end if;
  return jsonb_build_object('enabled',false,'deterministic',true,'reason','admin_only');
 elsif op='ai_config_save' then
  if not is_admin then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  select * into c from private.pitch_ai_config where id for update;
  if c.revision<>(p_input->'config'->>'revision')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  if p_input->'config'->>'fallback'<>'none' or p_input->'config'->>'vision'<>'false' or p_input->'config'->>'embedding'<>'false' then raise exception 'PITCH_INVALID';end if;
  update private.pitch_ai_config set config=(p_input->'config')||jsonb_build_object('revision',revision+1),revision=revision+1,updated_by=p_actor,updated_at=now() where id returning config into result;
 elsif op in('ai_policies','ai_policy_save') then
  select * into a from public.pitch_content_assets where id=aid;
  if not private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'admin') or not private.pitch_version_visible(p_actor,p_session,aid,a.current_version,'generate') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if op='ai_policies' then return coalesce((select jsonb_agg(to_jsonb(x)) from private.pitch_ai_policies x where x.asset_id=aid),'[]');end if;
  perform pg_advisory_xact_lock(hashtextextended(aid::text,6));
  select * into p from private.pitch_ai_policies where asset_id=aid and asset_version=(p_input->>'version')::integer;
  if a.current_version<>(p_input->>'version')::integer or coalesce(p.revision,0)<>(p_input->>'expectedRevision')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  if (p_input->>'expiresAt')::timestamptz<=clock_timestamp() or (p_input->>'expiresAt')::timestamptz>clock_timestamp()+interval '90 days' then raise exception 'PITCH_INVALID';end if;
  if p_input->>'mode'='approved_provider' and not private.pitch_version_visible(p_actor,p_session,aid,a.current_version,'ai') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  insert into private.pitch_ai_policies(asset_id,asset_version,revision,mode,provider,model,approved_text,reason,approved_by,expires_at)
   values(aid,a.current_version,coalesce(p.revision,0)+1,p_input->>'mode',p_input->>'provider',p_input->>'model',p_input->>'approvedText',p_input->>'reason',p_actor,(p_input->>'expiresAt')::timestamptz)
   on conflict(asset_id,asset_version) do update set revision=excluded.revision,mode=excluded.mode,provider=excluded.provider,model=excluded.model,approved_text=excluded.approved_text,reason=excluded.reason,approved_by=excluded.approved_by,expires_at=excluded.expires_at,updated_at=now();
  delete from private.pitch_ai_cache where actor_id=p_actor;result:=jsonb_build_object('saved',true);
 elsif op='ai_start' then
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,6));
  if jsonb_array_length(p_input->'tasks') not between 1 and 10 then raise exception 'PITCH_INVALID';end if;
  if exists(select 1 from private.pitch_ai_tasks where batch_id=bid and (actor_id<>p_actor or request_hash<>p_input->>'requestHash')) then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  if not exists(select 1 from private.pitch_ai_tasks where batch_id=bid) and (select count(*) from private.pitch_ai_tasks where actor_id=p_actor and state in('queued','processing','paused'))+jsonb_array_length(p_input->'tasks')>30 then raise exception 'PITCH_INVALID';end if;
  for item in select value from jsonb_array_elements(p_input->'tasks') loop
   if not private.pitch_version_visible(p_actor,p_session,(item->>'assetId')::uuid,(item->>'version')::integer,'generate') or exists(select 1 from public.pitch_content_assets where id=(item->>'assetId')::uuid and current_version<>(item->>'version')::integer) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   insert into private.pitch_ai_tasks(id,batch_id,actor_id,session_id,asset_id,asset_version,request,request_hash)
    values((item->>'id')::uuid,bid,p_actor,p_session,(item->>'assetId')::uuid,(item->>'version')::integer,item-'id',p_input->>'requestHash') on conflict(id) do nothing;
  end loop;result:=jsonb_build_object('batchId',bid,'state','queued');
 elsif op='ai_status' then
  if not exists(select 1 from private.pitch_ai_tasks where batch_id=bid and actor_id=p_actor) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  update private.pitch_ai_tasks set state=case when reserved_usd>0 then 'failed' else 'paused' end,error_code='worker_timeout',token=null,lease_until=null,charged_usd=greatest(charged_usd,reserved_usd),updated_at=now()
   where batch_id=bid and actor_id=p_actor and state='processing' and lease_until<clock_timestamp();
  return coalesce((select jsonb_agg(to_jsonb(x)-'token'-'session_id'-'request_hash'-'cache_key'||jsonb_build_object('result',case when private.pitch_ai_authorized(p_actor,p_session,x.id) then x.result else null end,'authorized',private.pitch_ai_authorized(p_actor,p_session,x.id))) from private.pitch_ai_tasks x where batch_id=bid and actor_id=p_actor),'[]');
 elsif op in('ai_cancel','ai_resume') then
  if not exists(select 1 from private.pitch_ai_tasks where batch_id=bid and actor_id=p_actor) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if op='ai_cancel' then
   update private.pitch_ai_tasks set state='cancelled',token=null,lease_until=null,updated_at=now() where batch_id=bid and actor_id=p_actor and state in('queued','paused','processing');
  else
   update private.pitch_ai_tasks set state='queued',error_code=null,token=null,lease_until=null,policy_revision=null,config_revision=null,cache_key=null,updated_at=now() where batch_id=bid and actor_id=p_actor and state in('failed','paused','cancelled') and attempts<1+(c.config->>'retries')::integer;
  end if;result:=jsonb_build_object('batchId',bid);
 elsif op='ai_claim' then
  perform pg_advisory_xact_lock(62106006);
  update private.pitch_ai_tasks set state=case when reserved_usd>0 then 'failed' else 'paused' end,error_code='worker_timeout',charged_usd=greatest(charged_usd,reserved_usd),token=null,lease_until=null,updated_at=now() where state='processing' and lease_until<clock_timestamp();
  if (select count(*) from private.pitch_ai_tasks x where state='processing' or exists(select 1 from private.pitch_ai_reservations r where r.task_id=x.id and r.created_at>clock_timestamp()-interval '35 seconds' and not exists(select 1 from private.pitch_ai_attempts a where a.token=r.token)))>=(c.config->>'concurrency')::integer then return null;end if;
  select * into t from private.pitch_ai_tasks where batch_id=bid and actor_id=p_actor and state='queued' and attempts<1+(c.config->>'retries')::integer order by created_at,id for update skip locked limit 1;
  if t.id is null then return null;end if;
  if not private.pitch_ai_authorized(p_actor,p_session,t.id) then update private.pitch_ai_tasks set state='failed',error_code='authorization_denied',updated_at=now() where id=t.id;return null;end if;
  update private.pitch_ai_tasks set state='processing',attempts=attempts+1,token=gen_random_uuid(),lease_until=clock_timestamp()+interval '35 seconds',session_id=p_session,updated_at=now() where id=t.id returning * into t;
  return to_jsonb(t);
 elsif op in('ai_context','ai_model_authorize','ai_cache','ai_reserve','ai_attempt','ai_complete','ai_fail') then
  -- Keep lock order consistent with queue claiming and expired-lease recovery.
  perform pg_advisory_xact_lock(62106006);
  select * into t from private.pitch_ai_tasks where id=tid and actor_id=p_actor for update;
  if t.id is null then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  -- Attempts settle even if cancelled/revoked, without exposing content or releasing an unknown charge.
  if op='ai_attempt' then
   if not exists(select 1 from private.pitch_ai_reservations where task_id=t.id and token=(p_input->>'token')::uuid) or octet_length((p_input->'record')::text)>12000 then raise exception 'PITCH_INVALID';end if;
   insert into private.pitch_ai_attempts(task_id,token,record) values(t.id,(p_input->>'token')::uuid,p_input->'record') on conflict(token) do nothing;
   if not found then return jsonb_build_object('recorded',true);end if;
   perform pg_advisory_xact_lock(62106006);
   amount:=t.charged_usd+greatest(0,(p_input->'record'->>'estimateUsd')::numeric);
   select coalesce(sum(usd),0) into budget from private.pitch_ai_reservations where task_id=t.id;
   if amount>budget then insert into private.pitch_ai_reservations(task_id,token,usd) values(t.id,(p_input->>'token')::uuid,amount-budget);end if;
   update private.pitch_ai_tasks set charged_usd=amount where id=t.id;return jsonb_build_object('recorded',true);
  end if;
  if op='ai_fail' then
   if t.state='processing' and t.token=(p_input->>'token')::uuid then update private.pitch_ai_tasks set state=case when p_input->>'errorCode' in('budget_exceeded','PITCH_AI_DUPLICATE_PENDING') then 'paused' else 'failed' end,attempts=attempts-case when p_input->>'errorCode' in('budget_exceeded','PITCH_AI_DUPLICATE_PENDING') and not exists(select 1 from private.pitch_ai_reservations r where r.task_id=t.id and r.token=t.token) then 1 else 0 end,error_code=p_input->>'errorCode',token=null,lease_until=null,updated_at=now() where id=t.id;end if;return '{}';
  end if;
  if not private.pitch_ai_authorized(p_actor,p_session,t.id) or t.state<>'processing' or t.token is distinct from (p_input->>'token')::uuid or t.lease_until<clock_timestamp() then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  select * into a from public.pitch_content_assets where id=t.asset_id;select * into v from public.pitch_asset_versions where asset_id=t.asset_id and version=t.asset_version;
  if op='ai_context' then return jsonb_build_object('content',v.content,'hash',v.sha256,'config',c.config);end if;
  if op='ai_model_authorize' then
   select * into p from private.pitch_ai_policies where asset_id=t.asset_id and asset_version=t.asset_version;
   profile:=case when t.request->>'task' in('classify','extract') then coalesce(nullif(c.config->'extraction','null'),c.config->'default') else coalesce(nullif(c.config->'analysis','null'),c.config->'default') end;
   if not is_admin or c.config->>'enabled'<>'true' or not(c.config->'enabledTasks' ? (t.request->>'task')) or profile is null or profile='null' or p.expires_at is null or p.expires_at<=clock_timestamp()
    or p.mode not in('redacted_external','approved_provider') or profile->>'provider' is distinct from p.provider or profile->>'model' is distinct from p.model
    or p.mode='approved_provider' and not private.pitch_version_visible(p_actor,p_session,t.asset_id,t.asset_version,'ai') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   update private.pitch_ai_tasks set policy_revision=p.revision,config_revision=c.revision where id=t.id;
   return jsonb_build_object('policyRevision',p.revision,'configRevision',c.revision,'mode',p.mode,'approvedText',p.approved_text,'profile',profile,'config',c.config);
  elsif op='ai_cache' then
   perform pg_advisory_xact_lock(62106006);
   key:=p_input->>'cacheKey';if length(key)<>64 then raise exception 'PITCH_INVALID';end if;
   update private.pitch_ai_tasks set cache_key=key where id=t.id;
   if exists(select 1 from private.pitch_ai_tasks x where x.actor_id=p_actor and x.id<>t.id and x.cache_key=key and x.state='processing' and x.lease_until>clock_timestamp()) then return jsonb_build_object('pending',true);end if;
   return (select result from private.pitch_ai_cache where actor_id=p_actor and cache_key=key and created_at>now()-interval '30 days');
  elsif op='ai_reserve' then
   perform pg_advisory_xact_lock(62106006);amount:=(p_input->>'usd')::numeric;
   if amount<0 or amount>5 or t.policy_revision is null then raise exception 'PITCH_INVALID';end if;
   if (select coalesce(sum(r.usd),0) from private.pitch_ai_reservations r join private.pitch_ai_tasks x on x.id=r.task_id where x.batch_id=t.batch_id)+amount>(c.config->>'batchUsd')::numeric
    or (select coalesce(sum(usd),0) from private.pitch_ai_reservations where created_at>=date_trunc('day',clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')+amount>(c.config->>'dailyUsd')::numeric
    or (select coalesce(sum(usd),0) from private.pitch_ai_reservations where created_at>=date_trunc('month',clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')+amount>(c.config->>'monthlyUsd')::numeric then return jsonb_build_object('allowed',false);end if;
   insert into private.pitch_ai_reservations(task_id,token,usd) values(t.id,t.token,amount);
   update private.pitch_ai_tasks set reserved_usd=reserved_usd+amount where id=t.id;return jsonb_build_object('allowed',true);
  elsif op='ai_complete' then
   if octet_length((p_input->'result')::text)>32000 then raise exception 'PITCH_INVALID';end if;
   update private.pitch_ai_tasks set state='completed',result=p_input->'result',cached=coalesce((p_input->>'cached')::boolean,false),token=null,lease_until=null,error_code=null,updated_at=now() where id=t.id;
   insert into private.pitch_ai_cache(actor_id,cache_key,result) values(p_actor,t.cache_key,p_input->'result') on conflict(actor_id,cache_key) do update set result=excluded.result,created_at=now();
   return jsonb_build_object('completed',true);
  end if;
 elsif op='ai_search' then
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
   select a.id,a.current_version version,a.city,a.region,a.tags,a.data_as_of,a.business_line,
    v.content->>'title' title,v.content->>'locale' language,b.profile->>'kind' kind,
    b.profile->>'serviceType' service,b.profile->>'propertyType' property,b.profile->>'submarket' submarket,b.profile->>'clientIndustry' industry,
    b.profile->'scale'->>'value' scale,b.profile->>'occurredOn' occurred_on
   from public.pitch_content_assets a join public.pitch_asset_versions v on v.asset_id=a.id and v.version=a.current_version
   left join public.pitch_business_profiles b on b.asset_id=a.id and b.asset_version=a.current_version
   where a.state='published' and v.state='published' and a.generated_project_id is null
    and private.pitch_version_visible(p_actor,p_session,a.id,a.current_version,case when p_input->>'client'='true' then 'client' else 'generate' end)
    and (not p_input?'kind' or b.profile->>'kind'=p_input->>'kind') and (not p_input?'city' or a.city=p_input->>'city') and (not p_input?'region' or a.region=p_input->>'region')
    and (not p_input?'language' or v.content->>'locale'=p_input->>'language') and (not p_input?'service' or b.profile->>'serviceType'=p_input->>'service') and (not p_input?'property' or b.profile->>'propertyType'=p_input->>'property')
    and (not p_input?'since' or b.profile->>'occurredOn'>=p_input->>'since')
    and (coalesce(p_input->>'q','')='' or strpos(lower(v.content->>'title'),lower(p_input->>'q'))>0 or a.search_tokens && array(select jsonb_array_elements_text(coalesce(p_input->'tokens','[]'))))
   order by a.data_as_of desc,a.id limit 201) x),'[]');
 elsif op='ai_feedback' then
  if aid is not null and not private.pitch_asset_visible(p_actor,p_session,aid,'generate') or pid is not null and not private.pitch_project_visible(p_actor,p_session,pid,'generate')
   or tid is not null and not exists(select 1 from private.pitch_ai_tasks where id=tid and actor_id=p_actor) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  insert into private.pitch_ai_events(id,actor_id,event,template_id,asset_id,project_id,task_id,layout) values((p_input->>'eventId')::uuid,p_actor,p_input->>'event',p_input->>'templateId',aid,pid,tid,p_input->>'layout') on conflict(id) do nothing;
  result:=jsonb_build_object('recorded',true);
 elsif op='ai_submit_candidate' then
  if not private.pitch_project_visible(p_actor,p_session,pid,'generate') or not exists(select 1 from public.pitch_projects where id=pid and created_by=p_actor and version=(p_input->>'expectedVersion')::integer) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  select to_jsonb(s) into item from public.pitch_project_slides s where s.id=(p_input->>'slideId')::uuid and s.project_id=pid;
  if item is null then raise exception 'PITCH_INVALID';end if;
  insert into private.pitch_ai_candidates(id,actor_id,project_id,project_version,slide_id,asset_id,asset_version,content,scope)
   select (p_input->>'candidateId')::uuid,p_actor,pid,(p_input->>'expectedVersion')::integer,(item->>'id')::uuid,(item->>'asset_id')::uuid,(item->>'asset_version')::integer,item->'content',jsonb_build_object('organizationId',p.organization_id,'region',p.region,'city',p.city,'businessLine',p.business_line) from public.pitch_projects p where p.id=pid on conflict(id) do nothing;
  result:=jsonb_build_object('submitted',true);
 elsif op in('ai_candidate_preview','ai_candidate_review','ai_candidate_context') then
  select * into candidate from private.pitch_ai_candidates where id=(p_input->>'candidateId')::uuid for update;
  if candidate.id is null or not private.pitch_access(p_actor,p_session,candidate.scope->>'organizationId',candidate.scope->>'region',candidate.scope->>'city',candidate.scope->>'businessLine','admin')
   or not private.pitch_ai_candidate_visible(p_actor,p_session,candidate.id) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if op='ai_candidate_review' then update private.pitch_ai_candidates set state=p_input->>'state',reviewed_by=p_actor where id=candidate.id;return jsonb_build_object('reviewed',true);end if;
  if op='ai_candidate_preview' then return jsonb_build_object('content',candidate.content,'scope',candidate.scope);end if;
  if candidate.state<>'accepted' then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  return to_jsonb(candidate);
 elsif op='ai_result' then
  select * into t from private.pitch_ai_tasks where id=tid;
  if t.actor_id<>p_actor or t.state<>'completed' or not private.pitch_ai_authorized(p_actor,p_session,tid) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  return to_jsonb(t)-'token'-'session_id';
 elsif op='ai_adopt' then
  if not is_admin or p_input->'asset'->>'state'<>'draft' or p_input->'asset'->>'visibility'<>'private' or p_input->'asset'->>'allowClientExport'<>'false' or p_input->'asset'->>'allowExternalAi'<>'false' or p_input->'asset'->'content'->>'disclosure'<>'internal' then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if p_input?'candidateId' then
   select * into candidate from private.pitch_ai_candidates where id=(p_input->>'candidateId')::uuid for update;
   if candidate.state is distinct from 'accepted' or not private.pitch_ai_candidate_visible(p_actor,p_session,candidate.id)
    or not private.pitch_access(p_actor,p_session,candidate.scope->>'organizationId',candidate.scope->>'region',candidate.scope->>'city',candidate.scope->>'businessLine','admin') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   if candidate.materialized_id is not null then return jsonb_build_object('assetId',candidate.materialized_id);end if;
  else
   select * into t from private.pitch_ai_tasks where id=tid;
   if t.actor_id<>p_actor or t.state<>'completed' or not private.pitch_ai_authorized(p_actor,p_session,tid) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  end if;
  if exists(select 1 from private.pitch_ai_origins where asset_id=coalesce(candidate.asset_id,t.asset_id)) then raise exception 'PITCH_INVALID';end if;
  result:=private.pitch_studio_access_v5(p_actor,p_session,p_input||jsonb_build_object('action','library_candidate_commit','expectedVersion',0,'acknowledgePartial',true));
  insert into private.pitch_ai_origins values(aid,coalesce(candidate.asset_id,t.asset_id),coalesce(candidate.asset_version,t.asset_version),t.id,candidate.id);
  if candidate.id is not null then update private.pitch_ai_candidates set materialized_id=aid where id=candidate.id;end if;
  return result||jsonb_build_object('assetId',aid);
 elsif op='ai_operations' then
  if not is_admin then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  -- Scope filtering precedes aggregation; never return source/context/policy text.
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
   select t.id,t.batch_id,t.actor_id,t.asset_id,t.asset_version,t.request->>'task' task,t.state,t.cached,t.attempts,t.error_code,t.created_at,t.updated_at,t.reserved_usd,t.charged_usd,
    coalesce((select jsonb_agg(x.record) from private.pitch_ai_attempts x where x.task_id=t.id),'[]') attempts_log
   from private.pitch_ai_tasks t join public.pitch_content_assets a on a.id=t.asset_id
   where private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'admin')
    and (not p_input?'task' or t.request->>'task'=p_input->>'task') and (not p_input?'model' or exists(select 1 from private.pitch_ai_attempts x where x.task_id=t.id and x.record->>'model'=p_input->>'model'))
    and (not p_input?'from' or t.created_at>=(p_input->>'from')::timestamptz) and (not p_input?'to' or t.created_at<=(p_input->>'to')::timestamptz)
   order by t.created_at desc,t.id limit 101 offset least(coalesce((p_input->>'offset')::integer,0),10000)) x;
  return jsonb_build_object('tasks',result,'candidates',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,actor_id,project_version,state,created_at,materialized_id,jsonb_build_object('title',content->>'title') content,scope from private.pitch_ai_candidates k where private.pitch_access(p_actor,p_session,k.scope->>'organizationId',k.scope->>'region',k.scope->>'city',k.scope->>'businessLine','admin') and private.pitch_ai_candidate_visible(p_actor,p_session,k.id) order by created_at desc limit 30)x),'[]'),
   'usage',coalesce((select jsonb_agg(to_jsonb(x)) from(select e.event,e.template_id,e.layout,count(*) count from private.pitch_ai_events e left join public.pitch_content_assets a on a.id=e.asset_id left join public.pitch_projects p on p.id=e.project_id where e.created_at>now()-interval '30 days' and (e.asset_id is not null and private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'admin') or e.project_id is not null and private.pitch_access(p_actor,p_session,p.organization_id,p.region,p.city,p.business_line,'admin') or e.actor_id=p_actor) group by e.event,e.template_id,e.layout order by count(*) desc limit 30)x),'[]'));
 else raise exception 'PITCH_INVALID';end if;
 -- Reliable content-free audit metadata; transaction fails if this write fails.
 insert into private.pitch_ai_events(id,actor_id,event,asset_id,project_id,task_id) values(gen_random_uuid(),p_actor,op,aid,pid,tid);
 return result;
end $$;
revoke all on function private.pitch_studio_access_v5(uuid,uuid,jsonb),private.pitch_studio_access(uuid,uuid,jsonb),private.pitch_ai_authorized(uuid,uuid,uuid),private.pitch_ai_candidate_visible(uuid,uuid,uuid,text),private.pitch_version_visible_v5(uuid,uuid,uuid,integer,text),private.pitch_version_visible(uuid,uuid,uuid,integer,text) from public,anon,authenticated,service_role;
revoke all on function private.pitch_asset_visible_v5(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.pitch_version_visible(uuid,uuid,uuid,integer,text) to authenticated;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
