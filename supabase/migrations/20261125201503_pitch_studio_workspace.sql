-- Stage 05: owner-bound editor, optimistic revisions, durable generation receipts.
alter table public.pitch_exports add column authorization_snapshot jsonb check(authorization_snapshot is null or jsonb_typeof(authorization_snapshot)='array');
create table public.pitch_workspace_states (
 project_id uuid primary key references public.pitch_projects(id),
 context jsonb not null default '{}' check(jsonb_typeof(context)='object'),
 page_settings jsonb not null default '{}' check(jsonb_typeof(page_settings)='object'),
 active_slide uuid, deleted_at timestamptz
);
create table private.pitch_workspace_revisions (
 project_id uuid not null references public.pitch_projects(id), version integer not null,
 snapshot jsonb not null, created_at timestamptz not null default now(), primary key(project_id,version)
);
create table private.pitch_workspace_preferences (
 user_id uuid primary key references auth.users(id), value jsonb not null default '{}'
);
create table private.pitch_workspace_tasks (
 id uuid primary key, project_id uuid not null references public.pitch_projects(id), actor_id uuid not null references auth.users(id),
 source_project_id uuid not null unique, command jsonb not null, expected_version integer not null,
 state text not null default 'queued' check(state in ('queued','processing','completed','failed','cancelled')),
 attempts integer not null default 0, token uuid, lease_until timestamptz default (clock_timestamp()+interval '90 seconds'), error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index pitch_workspace_tasks_owner on private.pitch_workspace_tasks(actor_id,created_at desc);
create table private.pitch_workspace_custom_assets(asset_id uuid primary key references public.pitch_content_assets(id));
alter table public.pitch_workspace_states enable row level security;
alter table private.pitch_workspace_revisions enable row level security;
alter table private.pitch_workspace_preferences enable row level security;
alter table private.pitch_workspace_tasks enable row level security;
alter table private.pitch_workspace_custom_assets enable row level security;
revoke all on public.pitch_workspace_states,private.pitch_workspace_revisions,private.pitch_workspace_preferences,private.pitch_workspace_tasks,private.pitch_workspace_custom_assets from public,anon,authenticated,service_role;
grant select on public.pitch_workspace_states to authenticated;

create or replace function private.pitch_project_visible(p_user uuid,p_session uuid,p_id uuid,p_cap text default 'read') returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from public.pitch_projects p left join public.pitch_workspace_states w on w.project_id=p.id where p.id=p_id and p.created_by=p_user
 and private.pitch_access(p_user,p_session,p.organization_id,p.region,p.city,p.business_line,p_cap)
 and private.pitch_business_dependencies(p_user,p_session,p.id,p_cap)
 and w.deleted_at is null
 and (w.project_id is null or (
   (p_cap<>'client' or not exists(select 1 from jsonb_each(w.page_settings) x where x.value->>'manual'='true'))
   and not exists(select 1 from public.pitch_project_slides s join public.pitch_content_assets a on a.id=s.asset_id
    join public.pitch_asset_versions v on v.asset_id=s.asset_id and v.version=s.asset_version
    where s.project_id=p.id and (a.state<>'published' or v.state<>'published' or not private.pitch_version_visible(p_user,p_session,s.asset_id,s.asset_version,case when p_cap='client' then 'client' else 'generate' end)))
 )))
$$;
create policy pitch_workspace_owner_read on public.pitch_workspace_states for select to authenticated using(private.pitch_project_visible(auth.uid(),private.pitch_session(),project_id));

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_v4;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op text:=p_input->>'action'; pid uuid:=(p_input->>'projectId')::uuid; p public.pitch_projects; w public.pitch_workspace_states;
 item jsonb; result jsonb; n integer:=0; t private.pitch_workspace_tasks; aid uuid; sc jsonb; c jsonb; authority jsonb; lease_export boolean:=false; lease_details boolean:=false; allowed text[]:='{}';
begin
 if op not like 'workspace_%' then
  -- Editing while an export runs must never silently produce a different deck.
  if op in ('export_context','export_complete') and exists(select 1 from public.pitch_workspace_states where project_id=pid) then
   if exists(select 1 from public.pitch_exports e where e.id=(p_input->>'exportId')::uuid and e.project_id=pid and e.slide_versions is distinct from
    (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'version',s.version) order by position),'[]') from public.pitch_project_slides s where s.project_id=pid)) then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  end if;
  if op='export_download' then
   for item in select x from public.pitch_exports e cross join lateral jsonb_array_elements(e.authorization_snapshot) x where e.id=(p_input->>'exportId')::uuid and e.project_id=pid loop
    if not private.pitch_version_visible(p_actor,p_session,(item->>'assetId')::uuid,(item->>'assetVersion')::integer,case when p_input->>'audience'='client' then 'client' else 'generate' end) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    for c in select value from jsonb_array_elements(item->'media') loop
     if not private.pitch_media_visible(p_actor,p_session,(c->>'id')::uuid,(c->>'version')::integer) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    end loop;
   end loop;
  end if;
  if op='export_prepare' and exists(select 1 from public.pitch_exports e where e.id=(p_input->>'exportId')::uuid and e.render_options->'pages' is distinct from p_input->'pages') then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  if op='export_prepare' and p_input?'pages' then update public.pitch_exports set render_options=render_options-'pages' where id=(p_input->>'exportId')::uuid and project_id=pid;end if;
  result:=private.pitch_studio_access_v4(p_actor,p_session,p_input);
  if op='export_prepare' then
   update public.pitch_exports set authorization_snapshot=coalesce(authorization_snapshot,(select coalesce(jsonb_agg(jsonb_build_object('assetId',s.asset_id,'assetVersion',s.asset_version,'media',(select coalesce(jsonb_agg(to_jsonb(cm)),'[]') from private.pitch_content_media(s.content) cm))),'[]') from public.pitch_project_slides s where s.project_id=pid)) where id=(p_input->>'exportId')::uuid and project_id=pid;
  end if;
  if op='export_prepare' and p_input?'pages' then
   if jsonb_array_length(p_input->'pages') not between 1 and 50 or exists(select 1 from jsonb_array_elements_text(p_input->'pages') x where x::integer<0 or x::integer>=(select count(*) from public.pitch_project_slides where project_id=pid)) then raise exception 'PITCH_INVALID';end if;
   update public.pitch_exports set render_options=render_options||jsonb_build_object('pages',p_input->'pages') where id=(p_input->>'exportId')::uuid and project_id=pid;
  end if;
  return result;
 end if;
 perform private.pitch_studio_access_v4(p_actor,p_session,jsonb_build_object('action','catalog'));
 if not private.pitch_access(p_actor,p_session,null,null,null,null,'read') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
 if op='workspace_capabilities' then
  if to_regprocedure('public.ai_query_authority(uuid,uuid,uuid)') is not null then
   execute 'select public.ai_query_authority($1,$1,$2)' into authority using p_actor,p_session;
   if authority->>'allowed'='true' and authority->'capabilities'?'query:catalog' then
    if authority->'capabilities'?'export:internal' then
     if authority->'capabilities'?'query:brochure' then allowed:=array_append(allowed,'building-profile');end if;
     if authority->'capabilities'?'query:quarter' then
      allowed:=allowed||array['project-comparison'];
      if authority->'fields'?'netEffectiveRent' then allowed:=allowed||array['rent-comparison','rent-trend'];end if;
      if authority->'fields'?'vacantArea' and authority->'fields'?'totalArea' then allowed:=allowed||array['vacancy-comparison','vacancy-trend'];end if;
      if authority->'fields'?'netEffectiveRent' and authority->'fields'?'vacantArea' and authority->'fields'?'totalArea' then allowed:=array_append(allowed,'building-submarket');end if;
     end if;
    end if;
    if to_regclass('private.ai_lease_research_grants') is not null then
     execute 'select allow_export,allow_details from private.ai_lease_research_grants where user_id=$1 and enabled and valid_until>clock_timestamp() and cardinality(sources)>0' into lease_export,lease_details using p_actor;
     if lease_export then allowed:=array_append(allowed,'lease-industry-distribution');if lease_details then allowed:=array_append(allowed,'lease-representatives');end if;end if;
    end if;
   end if;
  end if;
  return jsonb_build_object('allowedDynamic',to_jsonb(allowed),'buildingSearch',coalesce(authority->>'allowed'='true' and authority->'capabilities'?'query:catalog',false));
 elsif op='workspace_admin' then
  if not private.pitch_access(p_actor,p_session,null,null,null,null,'admin') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  return jsonb_build_object('documents',(select count(*) from public.pitch_source_documents d where private.pitch_access(p_actor,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain')),
   'storageBytes',(select coalesce(sum(d.size_bytes),0) from public.pitch_source_documents d where private.pitch_access(p_actor,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain')),
   'projects',(select count(*) from public.pitch_projects p where private.pitch_access(p_actor,p_session,p.organization_id,p.region,p.city,p.business_line,'admin')),
   'exports',coalesce((select jsonb_agg(to_jsonb(x)) from (select e.id,e.filename,e.state,e.created_at,e.format,p.title from public.pitch_exports e join public.pitch_projects p on p.id=e.project_id where private.pitch_access(p_actor,p_session,p.organization_id,p.region,p.city,p.business_line,'admin') order by e.created_at desc,e.id limit 31 offset least(10000,coalesce((p_input->>'offset')::integer,0))) x),'[]'),
   'failures',coalesce((select jsonb_agg(to_jsonb(x)) from (select t.id,t.state,t.error_code,t.updated_at,p.title from private.pitch_workspace_tasks t join public.pitch_projects p on p.id=t.project_id where t.state='failed' and private.pitch_access(p_actor,p_session,p.organization_id,p.region,p.city,p.business_line,'admin') order by t.updated_at desc limit 30) x),'[]'),
   'grants',coalesce((select jsonb_agg(jsonb_build_object('organization',g.organization_id,'region',g.region,'city',g.city,'businessLine',g.business_line,'generate',g.can_generate,'clientExport',g.can_client_export,'maintainer',g.maintainer,'validUntil',g.valid_until)) from private.pitch_grants g where g.user_id=p_actor),'[]'));
 elsif op='workspace_preferences' then
  if p_input?'value' then insert into private.pitch_workspace_preferences values(p_actor,p_input->'value') on conflict(user_id) do update set value=excluded.value;end if;
  return coalesce((select value from private.pitch_workspace_preferences where user_id=p_actor),'{}');
 elsif op='workspace_list' then
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select p.id,p.title,p.version,p.state,p.updated_at,p.is_test_data,w.deleted_at,
   (select count(*) from public.pitch_project_slides s where s.project_id=p.id) page_count
   from public.pitch_projects p left join public.pitch_workspace_states w on w.project_id=p.id
   where p.created_by=p_actor and private.pitch_access(p_actor,p_session,p.organization_id,p.region,p.city,p.business_line,'read')
   and not exists(select 1 from private.pitch_workspace_tasks t where t.source_project_id=p.id)
   and (case when p_input->>'filter'='deleted' then w.deleted_at is not null when p_input->>'filter'='archived' then p.state='archived' and w.deleted_at is null else p.state<>'archived' and w.deleted_at is null end)
   and (coalesce(p_input->>'q','')='' or strpos(lower(p.title),lower(p_input->>'q'))>0)
   order by p.updated_at desc,p.id limit 31 offset least(10000,coalesce((p_input->>'offset')::integer,0))) x),'[]');
 elsif op='workspace_create' then
  sc:=p_input->'scope';
  if not private.pitch_access(p_actor,p_session,sc->>'organizationId',sc->>'region',sc->>'city',sc->>'businessLine','generate') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  insert into public.pitch_projects(id,title,theme_id,theme_version,is_test_data,created_by,updated_by,organization_id,region,city,business_line,data_as_of)
   values(pid,p_input->>'title',p_input->>'themeId',(p_input->>'themeVersion')::integer,false,p_actor,p_actor,sc->>'organizationId',sc->>'region',sc->>'city',sc->>'businessLine',current_date);
  insert into public.pitch_workspace_states(project_id,context) values(pid,p_input->'context');
 else
  select * into p from public.pitch_projects where id=pid for update;
  if p.id is null or p.created_by<>p_actor or not private.pitch_access(p_actor,p_session,p.organization_id,p.region,p.city,p.business_line,'generate') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  select * into w from public.pitch_workspace_states where project_id=pid;
  if op='workspace_lifecycle' then
   if p.version<>(p_input->>'expectedVersion')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   insert into public.pitch_workspace_states(project_id) values(pid) on conflict do nothing;
   update public.pitch_workspace_states set deleted_at=case when p_input->>'state'='deleted' then now() else null end where project_id=pid;
   update public.pitch_projects set state=case when p_input->>'state'='archived' then 'archived' else 'draft' end,version=version+1,updated_at=now() where id=pid;
  else
   if not private.pitch_project_visible(p_actor,p_session,pid,'generate') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   insert into public.pitch_workspace_states(project_id) values(pid) on conflict do nothing;
   if op='workspace_get' then
    result:=private.pitch_studio_access_v4(p_actor,p_session,jsonb_build_object('action','get_project','projectId',pid));
    return result||jsonb_build_object('workspace',(select to_jsonb(x) from public.pitch_workspace_states x where project_id=pid),
     'history',coalesce((select jsonb_agg(to_jsonb(x)) from(select version,created_at from private.pitch_workspace_revisions where project_id=pid order by version desc limit 30)x),'[]'),
     'tasks',coalesce((select jsonb_agg(to_jsonb(x)-'command'-'token') from (select * from private.pitch_workspace_tasks where project_id=pid order by created_at desc limit 20)x),'[]'));
   elsif op='workspace_revision' then
    select snapshot into result from private.pitch_workspace_revisions where project_id=pid and version=(p_input->>'revision')::integer;
    if result is null then raise exception 'PITCH_INVALID';end if;return result;
   elsif op='workspace_custom' then
    aid:=(p_input->>'assetId')::uuid;c:=p_input->'content';
    if exists(select 1 from public.pitch_content_assets where id=aid) then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
    if c->>'disclosure'<>'internal' or exists(select 1 from jsonb_array_elements(c->'blocks') b where b->>'kind' not in ('paragraph','image')) then raise exception 'PITCH_INVALID';end if;
    insert into public.pitch_content_assets(id,category_id,names,visibility,allow_internal_generation,allow_client_export,allow_external_ai,disclosure,is_test_data,created_by,updated_by,organization_id,region,city,business_line,state,data_as_of)
     values(aid,(select id from public.pitch_asset_categories where system_code='general'),jsonb_build_object('zh',c->>'title'),'private',true,false,false,'internal',(c->>'isTestData')::boolean,p_actor,p_actor,p.organization_id,p.region,p.city,p.business_line,'published',(c->>'dataAsOf')::date);
    insert into public.pitch_asset_versions(asset_id,version,protocol,content,sha256,created_by,state,visibility,allow_internal_generation,allow_client_export,allow_external_ai,disclosure,is_test_data)
     values(aid,1,'colliers-pitch/1',c,p_input->>'sha256',p_actor,'published','private',true,false,false,'internal',(c->>'isTestData')::boolean);
    insert into private.pitch_workspace_custom_assets values(aid);
    return jsonb_build_object('assetId',aid);
   elsif op='workspace_save' then
    if p.version<>(p_input->>'expectedVersion')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
    if jsonb_array_length(p_input->'slides')>50 then raise exception 'PITCH_INVALID';end if;
    insert into private.pitch_workspace_revisions values(pid,p.version,jsonb_build_object('project',to_jsonb(p),'workspace',(select to_jsonb(x) from public.pitch_workspace_states x where project_id=pid),'slides',(select coalesce(jsonb_agg(to_jsonb(s) order by position),'[]') from public.pitch_project_slides s where project_id=pid)),now()) on conflict do nothing;
    for item in select value from jsonb_array_elements(p_input->'slides') loop
     if not private.pitch_version_visible(p_actor,p_session,(item->>'assetId')::uuid,(item->>'assetVersion')::integer,'generate') or not exists(select 1 from public.pitch_content_assets a join public.pitch_asset_versions v on v.asset_id=a.id where a.id=(item->>'assetId')::uuid and v.version=(item->>'assetVersion')::integer and a.state='published' and v.state='published') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
     for c in select to_jsonb(cm) from private.pitch_content_media(item->'content') cm loop
      if not private.pitch_media_visible(p_actor,p_session,(c->>'id')::uuid,(c->>'version')::integer) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
     end loop;
    end loop;
    delete from private.pitch_workspace_revisions where project_id=pid and version not in(select version from private.pitch_workspace_revisions where project_id=pid order by version desc limit 30);
    delete from public.pitch_project_slides where project_id=pid;
    for item in select value from jsonb_array_elements(p_input->'slides') loop
     n:=n+1;
     insert into public.pitch_project_slides(id,project_id,position,version,asset_id,asset_version,template_id,template_version,layout_id,layout_version,theme_id,theme_version,content,scene,source_snapshot,created_by,updated_by)
      values((item->>'id')::uuid,pid,n,p.version+1,(item->>'assetId')::uuid,(item->>'assetVersion')::integer,item->>'templateId',(item->>'templateVersion')::integer,item->'scene'->>'layoutId',(item->'scene'->>'layoutVersion')::integer,item->'scene'->>'themeId',(item->'scene'->>'themeVersion')::integer,item->'content',item->'scene',item->'content'->'sources',p_actor,p_actor);
    end loop;
    update public.pitch_workspace_states set context=p_input->'context',page_settings=p_input->'settings',active_slide=(p_input->>'activeSlide')::uuid where project_id=pid;
    update public.pitch_projects set title=p_input->>'title',theme_id=p_input->>'themeId',theme_version=(p_input->>'themeVersion')::integer,version=version+1,updated_at=now(),is_test_data=exists(select 1 from public.pitch_project_slides s where s.project_id=pid and s.content->>'isTestData'='true') where id=pid;
   elsif op='workspace_task_start' then
    perform pg_advisory_xact_lock(hashtextextended(p_actor::text,5));
    if exists(select 1 from private.pitch_workspace_tasks x where x.project_id=pid and x.id<>(p_input->>'taskId')::uuid and x.state in ('queued','processing') and x.lease_until>clock_timestamp())
     or (select count(*) from private.pitch_workspace_tasks x where x.actor_id=p_actor and x.id<>(p_input->>'taskId')::uuid and x.state in ('queued','processing') and x.lease_until>clock_timestamp())>=2 then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
    if p.version<>(p_input->>'expectedVersion')::integer or w.deleted_at is not null then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
    insert into private.pitch_workspace_tasks(id,project_id,actor_id,source_project_id,command,expected_version) values((p_input->>'taskId')::uuid,pid,p_actor,(p_input->>'sourceProjectId')::uuid,p_input->'command',p.version) on conflict do nothing;
    select * into t from private.pitch_workspace_tasks where id=(p_input->>'taskId')::uuid;
    if t.actor_id<>p_actor or t.project_id<>pid or t.command<>p_input->'command' then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
    return to_jsonb(t)-'command'-'token';
   elsif op like 'workspace_task_%' then
    select * into t from private.pitch_workspace_tasks where id=(p_input->>'taskId')::uuid and project_id=pid and actor_id=p_actor for update;
    if t.id is null then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    if t.state in ('queued','processing') and t.lease_until<clock_timestamp() then update private.pitch_workspace_tasks set state='failed',error_code='PITCH_WORKER_TIMEOUT',updated_at=now() where id=t.id;t.state:='failed';end if;
    if op='workspace_task_claim' then
     if t.state<>'queued' then return '{"claimed":false}';end if;
     update private.pitch_workspace_tasks set state='processing',attempts=attempts+1,token=(p_input->>'token')::uuid,lease_until=clock_timestamp()+interval '55 seconds',updated_at=now() where id=t.id;
     return jsonb_build_object('claimed',true,'task',to_jsonb(t));
    elsif op='workspace_task_cancel' and t.state in ('queued','processing') then update private.pitch_workspace_tasks set state='cancelled',updated_at=now() where id=t.id;
    elsif op='workspace_task_retry' then
     if t.state<>'failed' or t.attempts>=3 or t.expected_version<>p.version then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
     update private.pitch_workspace_tasks set state='queued',lease_until=clock_timestamp()+interval '90 seconds',error_code=null,updated_at=now() where id=t.id;
    elsif op in ('workspace_task_complete','workspace_task_fail','workspace_task_check') then
     if t.state<>'processing' or t.token is distinct from (p_input->>'token')::uuid then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
     if op='workspace_task_complete' then
      -- Save and receipt transition are one transaction; cancellation cannot race the commit.
      perform private.pitch_studio_access(p_actor,p_session,(p_input->'save')||jsonb_build_object('action','workspace_save','projectId',pid,'expectedVersion',t.expected_version));
      update private.pitch_workspace_tasks set state='completed',updated_at=now() where id=t.id;
     elsif op='workspace_task_fail' then update private.pitch_workspace_tasks set state='failed',error_code=case when p_input->>'errorCode' ~ '^PITCH_[A-Z_]+$' then p_input->>'errorCode' else 'PITCH_GENERATION_FAILED' end,updated_at=now() where id=t.id;end if;
    end if;
    return (select to_jsonb(x)-'command'-'token' from private.pitch_workspace_tasks x where id=t.id);
   else raise exception 'PITCH_INVALID';end if;
  end if;
 end if;
 insert into private.pitch_events(actor_id,session_id,action,target_id,after_value) values(p_actor,p_session,op,pid::text,jsonb_build_object('version',(select version from public.pitch_projects where id=pid)));
 return jsonb_build_object('projectId',pid,'version',(select version from public.pitch_projects where id=pid));
end $$;
revoke all on function private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
