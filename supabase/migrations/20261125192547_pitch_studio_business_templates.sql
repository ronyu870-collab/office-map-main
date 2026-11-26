-- Additive phase 04. No production facts, account grants or pilot activation.
begin;
create table public.pitch_business_profiles (
 asset_id uuid not null,asset_version integer not null,profile jsonb not null check(jsonb_typeof(profile)='object'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 primary key(asset_id,asset_version),foreign key(asset_id,asset_version) references public.pitch_asset_versions(asset_id,version)
);
create table public.pitch_business_templates (
 id text not null,revision integer not null check(revision>0),category_id uuid not null references public.pitch_asset_categories(id),
 config jsonb not null check(jsonb_typeof(config)='object'),created_by uuid references auth.users(id),created_at timestamptz not null default now(),primary key(id,revision)
);
create table public.pitch_business_generations (
 project_id uuid primary key references public.pitch_projects(id),request_key text not null check(length(request_key)=64),parameters jsonb not null,
 bindings jsonb not null check(jsonb_typeof(bindings)='array'),snapshots jsonb not null check(jsonb_typeof(snapshots)='array'),
 recipes jsonb not null,changes jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
alter table public.pitch_content_assets add column generated_project_id uuid references public.pitch_projects(id);
create index pitch_business_profile_kind on public.pitch_business_profiles((profile->>'kind'),asset_id);
create index pitch_business_profile_search on public.pitch_business_profiles using gin(to_tsvector('simple',profile::text));

create function private.pitch_business_data_allowed(p_user uuid,p_session uuid,p_snapshots jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare s jsonb;a jsonb;g jsonb;rev text;
begin
 -- PostgREST table GET uses a read-only transaction. Canonical data authority
 -- deliberately locks grants; never weaken it for a raw table read. Dynamic
 -- snapshots are accessible only through the server's authenticated POST RPC,
 -- which reuses that exact authority and its revocation serialization.
 if jsonb_array_length(p_snapshots)>0 and current_setting('transaction_read_only')='on' then return false;end if;
 for s in select value from jsonb_array_elements(p_snapshots) loop
  if to_regprocedure('private.ai_query_authority(uuid,uuid,uuid)') is null then return false;end if;
  execute 'select private.ai_query_authority($1,$1,$2)' into a using p_user,p_session;
  if a->>'allowed' is distinct from 'true' then return false;end if;
  if s->'binding'->>'domain'='quarter' then
   if not(a->'capabilities' ? 'export:internal') or a->>'permission_revision' is distinct from s->'binding'->>'permissionRevision' or a->>'policy_version' is distinct from s->'binding'->>'policyVersion' then return false;end if;
  elsif s->'binding'->>'domain'='lease' then
   if to_regclass('private.ai_lease_research_grants') is null then return false;end if;
   execute 'select to_jsonb(g) from private.ai_lease_research_grants g where user_id=$1 and enabled and valid_until>clock_timestamp() and allow_export for share' into g using p_user;
   if g is null then return false;end if;
   rev:=encode(sha256(convert_to(jsonb_build_array(a->>'permission_revision',g)::text,'UTF8')),'hex');
   if rev is distinct from s->'binding'->>'permissionRevision' then return false;end if;
  else return false;end if;
 end loop;return true;
end $$;
create function private.pitch_business_dependencies(p_user uuid,p_session uuid,p_project uuid,p_cap text default 'read') returns boolean
language plpgsql security definer set search_path='' as $$
declare g public.pitch_business_generations;b jsonb;
begin
 select * into g from public.pitch_business_generations where project_id=p_project;
 if not found then return true;end if;
 if g.created_by<>p_user or p_cap='client' and jsonb_array_length(g.snapshots)>0 then return false;end if;
 for b in select value from jsonb_array_elements(g.bindings) loop
  if not exists(select 1 from public.pitch_content_assets a join public.pitch_asset_versions v on v.asset_id=a.id and v.version=(b->>'version')::integer
   where a.id=(b->>'id')::uuid and a.state='published' and v.state='published' and a.generated_project_id is null
   and private.pitch_version_visible(p_user,p_session,a.id,v.version,case when p_cap='client' then 'client' else 'generate' end)) then return false;end if;
 end loop;
 return private.pitch_business_data_allowed(p_user,p_session,g.snapshots);
end $$;
create or replace function private.pitch_project_visible(p_user uuid,p_session uuid,p_id uuid,p_cap text default 'read') returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from public.pitch_projects p where p.id=p_id and p.created_by=p_user
 and private.pitch_access(p_user,p_session,p.organization_id,p.region,p.city,p.business_line,p_cap)
 and private.pitch_business_dependencies(p_user,p_session,p.id,p_cap))
$$;
-- Derived private assets cannot be used through older generation/export paths to bypass original-asset or data revocation.
create or replace function private.pitch_asset_visible(p_user uuid,p_session uuid,p_id uuid,p_cap text default 'read') returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.pitch_content_assets a where a.id=p_id
 and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,p_cap)
 and (a.created_by=p_user or a.visibility='organization' and (a.state='published' or a.imported_from_page is not null and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain')))
 and ((a.state<>'archived' and (a.valid_from is null or a.valid_from<=current_date) and (a.valid_until is null or a.valid_until>=current_date)) or p_cap='read' and a.imported_from_page is not null and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain'))
 and (a.generated_project_id is null or private.pitch_business_dependencies(p_user,p_session,a.generated_project_id,p_cap))
 and case p_cap when 'generate' then a.allow_internal_generation when 'client' then a.state='published' and a.allow_client_export and a.disclosure='client_approved' and not a.is_test_data when 'ai' then a.state='published' and a.allow_external_ai and not a.is_test_data else true end)
$$;
-- Switching a case to anonymous also withdraws the ability to export older named versions.
create or replace function private.pitch_version_visible(p_user uuid,p_session uuid,p_id uuid,p_version integer,p_cap text default 'read') returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.pitch_asset_versions v join public.pitch_content_assets a on a.id=v.asset_id where v.asset_id=p_id and v.version=p_version and private.pitch_asset_visible(p_user,p_session,p_id,p_cap)
 and (a.created_by=p_user or v.visibility='organization' and (v.state='published' or a.imported_from_page is not null and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain')))
 and (p_version=a.current_version or not exists(select 1 from public.pitch_business_profiles bp where bp.asset_id=a.id and bp.asset_version=a.current_version and bp.profile->>'kind'='case' and bp.profile->>'disclosureMode'='anonymous') or p_cap='read' and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain'))
 and not exists(select 1 from public.pitch_source_references r join public.pitch_source_documents d on d.id=r.document_id where r.asset_id=p_id and r.asset_version=p_version and (not private.pitch_document_visible(p_user,p_session,d.id) or p_cap<>'read' and (d.state='archived' or d.valid_from>current_date or d.valid_until<current_date) or p_cap='client' and d.library_managed and (d.state<>'published' or not d.allow_client_export or d.is_test_data)))
 and case p_cap when 'generate' then v.allow_internal_generation when 'client' then v.state='published' and v.allow_client_export and v.disclosure='client_approved' and not v.is_test_data when 'ai' then v.state='published' and v.allow_external_ai and not v.is_test_data else true end)
$$;
alter table public.pitch_business_profiles enable row level security;
alter table public.pitch_business_templates enable row level security;
alter table public.pitch_business_generations enable row level security;
revoke all on public.pitch_business_profiles,public.pitch_business_templates,public.pitch_business_generations from public,anon,authenticated,service_role;
-- Profiles can contain internal client identity. Only maintainers may read raw profiles directly.
grant select on public.pitch_business_profiles,public.pitch_business_templates,public.pitch_business_generations to authenticated;
create policy pitch_business_profile_read on public.pitch_business_profiles for select to authenticated using(exists(select 1 from public.pitch_content_assets a where a.id=asset_id and private.pitch_version_visible(auth.uid(),private.pitch_session(),a.id,asset_version) and private.pitch_access(auth.uid(),private.pitch_session(),a.organization_id,a.region,a.city,a.business_line,'maintain')));
create policy pitch_business_template_read on public.pitch_business_templates for select to authenticated using(private.pitch_access(auth.uid(),private.pitch_session()));
create policy pitch_business_generation_read on public.pitch_business_generations for select to authenticated using(private.pitch_project_visible(auth.uid(),private.pitch_session(),project_id));

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_v3;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op text:=p_input->>'action';result jsonb;item jsonb;ref jsonb;b jsonb;scope jsonb;a public.pitch_content_assets;v public.pitch_asset_versions;
 g public.pitch_business_generations;recipe public.pitch_business_templates;pid uuid;aid uuid;revision integer;n integer:=0;cap text;media jsonb;oldversion integer;
begin
 perform private.pitch_studio_access_v3(p_actor,p_session,'{"action":"catalog"}');
 if op='business_catalog' then
  return jsonb_build_object('recipes',coalesce((select jsonb_agg(t.config order by t.id) from public.pitch_business_templates t where revision=(select max(x.revision) from public.pitch_business_templates x where x.id=t.id)),'[]'));
 elsif op='business_recipe' then
  select * into recipe from public.pitch_business_templates where id=p_input->>'templateId' order by revision desc limit 1;
  if recipe.id is null or recipe.config->>'enabled'<>'true' then raise exception 'PITCH_INVALID';end if;return recipe.config;
 elsif op='business_recipe_save' then
  if not private.pitch_access(p_actor,p_session,p_cap=>'admin') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  item:=p_input->'recipe';perform pg_advisory_xact_lock(hashtextextended(item->>'id',4));
  select coalesce(max(t.revision),0) into revision from public.pitch_business_templates t where id=item->>'id';
  if revision<>(item->>'revision')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  insert into public.pitch_business_templates(id,revision,category_id,config,created_by) values(item->>'id',revision+1,(item->>'categoryId')::uuid,item||jsonb_build_object('revision',revision+1),p_actor);result:=jsonb_build_object('revision',revision+1);
 elsif op in ('business_profile','business_generation_asset') then
  aid:=(p_input->>'assetId')::uuid;select * into a from public.pitch_content_assets where id=aid;
  select * into v from public.pitch_asset_versions where asset_id=aid and version=coalesce((p_input->>'version')::integer,a.current_version);
  if not private.pitch_version_visible(p_actor,p_session,aid,v.version) or a.generated_project_id is not null then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if op='business_profile' and not private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if op='business_generation_asset' and (a.state<>'published' or v.state<>'published' or not private.pitch_version_visible(p_actor,p_session,aid,v.version,'generate')) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  select profile into item from public.pitch_business_profiles where asset_id=aid and asset_version=v.version;
  if item is null then raise exception 'PITCH_INVALID';end if;
  select coalesce(jsonb_agg(to_jsonb(m)),'[]') into media from public.pitch_media_assets m where private.pitch_media_visible(p_actor,p_session,m.id,m.version)
   and ((m.id,m.version) in (select cm.id,cm.version from private.pitch_content_media(v.content) cm)
    or item->'photo'=jsonb_build_object('id',m.id,'version',m.version) or item->'photos' @> jsonb_build_array(jsonb_build_object('id',m.id,'version',m.version))
    or (m.id,m.version) in (select cm.id,cm.version from private.pitch_content_media(coalesce(item->'display',item->'content','{}')) cm));
  return jsonb_build_object('asset',to_jsonb(a),'version',to_jsonb(v),'profile',item,'media',media);
 elsif op='business_profile_save' then
  aid:=(p_input->>'assetId')::uuid;select * into a from public.pitch_content_assets where id=aid for update;
  if a.generated_project_id is not null or a.current_version is distinct from (p_input->>'expectedVersion')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  if not private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  item:=p_input->'profile';
  if item->>'employeeAccountId' is not null and not exists(select 1 from auth.users where id=(item->>'employeeAccountId')::uuid and deleted_at is null) then raise exception 'PITCH_INVALID';end if;
  if item->>'buildingId' is not null then
   if to_regclass('public.buildings') is null then raise exception 'PITCH_INVALID';end if;
   execute 'select exists(select 1 from public.buildings where id=$1)' into b using (item->>'buildingId')::uuid;
   if b<>'true'::jsonb then raise exception 'PITCH_INVALID';end if;
  end if;
  for ref in select value from jsonb_array_elements(coalesce(item->'caseAssetIds',item->'teamAssetIds','[]')) loop
   if not private.pitch_asset_visible(p_actor,p_session,(ref#>>'{}')::uuid) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  end loop;
  for ref in select value from jsonb_array_elements(coalesce(p_input->'media','[]')) loop
   if not private.pitch_media_visible(p_actor,p_session,(ref->>'id')::uuid,(ref->>'version')::integer) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  end loop;
  result:=private.pitch_studio_access_v3(p_actor,p_session,p_input||jsonb_build_object('action','library_candidate_commit','acknowledgePartial',true));
  insert into public.pitch_business_profiles values(aid,(result->>'version')::integer,item,p_actor,now());
 elsif op='business_search' then
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select a.id,a.current_version,a.region,a.city,a.business_line,a.tags,a.state,a.is_test_data,a.data_as_of,
    case when p.profile->>'kind'='case' then jsonb_build_object(v.content->>'locale',p.profile->'display'->>'title') else a.names end names,p.profile->>'kind' kind
   from public.pitch_content_assets a join public.pitch_asset_versions v on v.asset_id=a.id and v.version=a.current_version join public.pitch_business_profiles p on p.asset_id=a.id and p.asset_version=a.current_version
   where private.pitch_version_visible(p_actor,p_session,a.id,a.current_version) and a.generated_project_id is null
   and (a.state='published' or private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain'))
   and (not p_input?'kind' or p.profile->>'kind'=p_input->>'kind') and (not p_input?'region' or a.region=p_input->>'region') and (not p_input?'city' or a.city=p_input->>'city') and (not p_input?'line' or a.business_line=p_input->>'line')
   and (not p_input?'language' or v.content->>'locale'=p_input->>'language') and (not p_input?'tag' or a.tags @> array[p_input->>'tag'])
   and (not p_input?'q' or (case when p.profile->>'kind'='case' then p.profile->'display' else p.profile end)::text ilike '%'||(p_input->>'q')||'%')
   and (not p_input?'service' or p.profile->>'serviceType'=p_input->>'service') and (not p_input?'property' or p.profile->>'propertyType'=p_input->>'property')
   and (not p_input?'minimumScale' or (p.profile->'scale'->>'value')::numeric>=(p_input->>'minimumScale')::numeric)
   and (not p_input?'maximumScale' or (p.profile->'scale'->>'value')::numeric<=(p_input->>'maximumScale')::numeric)
   and (not p_input?'before' or a.id<(p_input->>'before')::uuid) order by a.id desc limit 31) x),'[]');
 elsif op='business_generation' then
  pid:=(p_input->>'projectId')::uuid;if not private.pitch_project_visible(p_actor,p_session,pid) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  select to_jsonb(x) into result from public.pitch_business_generations x where project_id=pid;if result is null then raise exception 'PITCH_INVALID';end if;return result;
 elsif op='business_generate_commit' then
  pid:=(p_input->>'projectId')::uuid;scope:=p_input->'scope';perform pg_advisory_xact_lock(hashtextextended(pid::text,0));
  if not private.pitch_access(p_actor,p_session,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine','generate') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  select * into g from public.pitch_business_generations where project_id=pid;
  if found then
   if g.created_by<>p_actor or g.request_key<>p_input->>'requestKey' or not private.pitch_project_visible(p_actor,p_session,pid,'generate') then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;return jsonb_build_object('projectId',pid,'replayed',true);
  end if;
  if exists(select 1 from public.pitch_projects where id=pid) then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  if p_input?'parentProjectId' and not private.pitch_project_visible(p_actor,p_session,(p_input->>'parentProjectId')::uuid,'generate') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if jsonb_array_length(p_input->'slides') not between 1 and 50 or jsonb_array_length(p_input->'generated') not between 1 and 100 then raise exception 'PITCH_INVALID';end if;
  if not private.pitch_business_data_allowed(p_actor,p_session,p_input->'snapshots') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  for b in select value from jsonb_array_elements(p_input->'bindings') loop
   select * into a from public.pitch_content_assets where id=(b->>'id')::uuid for share;
   if a.state<>'published' or a.generated_project_id is not null or a.current_version<>(b->>'version')::integer or not private.pitch_version_visible(p_actor,p_session,a.id,a.current_version,'generate')
    or not exists(select 1 from public.pitch_asset_versions where asset_id=a.id and version=a.current_version and state='published') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  end loop;
  for b in select value from jsonb_array_elements(p_input->'recipes') loop
   if not exists(select 1 from public.pitch_business_templates t where id=b->>'id' and revision=(b->>'revision')::integer and config->>'enabled'='true' and revision=(select max(x.revision) from public.pitch_business_templates x where x.id=t.id)) then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  end loop;
  perform private.pitch_studio_access_v3(p_actor,p_session,jsonb_build_object('action','registry','templateId','business-content','templateVersion',1,'themeId',p_input->>'themeId','themeVersion',p_input->'themeVersion'));
  insert into public.pitch_projects(id,title,parent_project_id,theme_id,theme_version,is_test_data,created_by,updated_by,organization_id,region,city,business_line,data_as_of,composition_key)
  values(pid,p_input->>'title',(p_input->>'parentProjectId')::uuid,p_input->>'themeId',(p_input->>'themeVersion')::integer,exists(select 1 from jsonb_array_elements(p_input->'generated') x where x->'content'->>'isTestData'='true'),p_actor,p_actor,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine',(p_input->'generated'->0->'content'->>'dataAsOf')::date,p_input->>'requestKey');
  insert into public.pitch_business_generations values(pid,p_input->>'requestKey',p_input-'generated'-'slides'-'snapshots'-'bindings'-'recipes'-'changes',p_input->'bindings',p_input->'snapshots',p_input->'recipes',p_input->'changes',p_actor,now());
  for item in select value from jsonb_array_elements(p_input->'generated') loop
   aid:=(item->>'id')::uuid;
   insert into public.pitch_content_assets(id,category_id,names,visibility,allow_internal_generation,allow_client_export,allow_external_ai,disclosure,is_test_data,created_by,updated_by,organization_id,region,city,business_line,state,data_as_of,generated_project_id)
   values(aid,(select id from public.pitch_asset_categories where system_code='general'),jsonb_build_object(item->'content'->>'locale',item->'content'->>'title'),'private',true,jsonb_array_length(p_input->'snapshots')=0 and item->'content'->>'disclosure'='client_approved' and item->'content'->>'isTestData'='false',false,item->'content'->>'disclosure',(item->'content'->>'isTestData')::boolean,p_actor,p_actor,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine','published',(item->'content'->>'dataAsOf')::date,pid);
   insert into public.pitch_asset_versions(asset_id,version,protocol,content,sha256,created_by,state,visibility,allow_internal_generation,allow_client_export,allow_external_ai,disclosure,is_test_data)
   select aid,1,'colliers-pitch/1',item->'content',item->>'sha256',p_actor,'published','private',true,allow_client_export,false,disclosure,is_test_data from public.pitch_content_assets where id=aid;
   for ref in select value from jsonb_array_elements(item->'content'->'sources') loop
    if ref->>'documentId' is not null and not private.pitch_document_visible(p_actor,p_session,(ref->>'documentId')::uuid) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    insert into public.pitch_source_references(id,asset_id,asset_version,document_id,page_id,kind,label,locator,source_version,record_id,sha256,data_as_of)
    values((ref->>'id')::uuid,aid,1,(ref->>'documentId')::uuid,(ref->>'pageId')::uuid,ref->>'kind',ref->>'label',ref->>'locator',ref->>'version',ref->>'recordId',ref->>'sha256',(ref->>'dataAsOf')::date);
   end loop;
  end loop;
  for item in select value from jsonb_array_elements(p_input->'slides') loop
   n:=n+1;aid:=(item->>'assetId')::uuid;
   if not exists(select 1 from public.pitch_content_assets where id=aid and generated_project_id=pid) or item->'scene'->>'themeId'<>p_input->>'themeId' or item->'scene'->>'rendererVersion'<>'pitch-scene/2' then raise exception 'PITCH_INVALID';end if;
   for ref in select to_jsonb(cm) from private.pitch_content_media(item->'content') cm loop
    if not private.pitch_media_visible(p_actor,p_session,(ref->>'id')::uuid,(ref->>'version')::integer) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    insert into public.pitch_asset_media values(aid,1,(ref->>'id')::uuid,(ref->>'version')::integer) on conflict do nothing;
   end loop;
   insert into public.pitch_project_slides(id,project_id,position,asset_id,asset_version,template_id,template_version,layout_id,layout_version,theme_id,theme_version,content,scene,source_snapshot,created_by,updated_by)
   values((item->>'slideId')::uuid,pid,n,aid,1,'business-content',1,item->'scene'->>'layoutId',2,p_input->>'themeId',(p_input->>'themeVersion')::integer,item->'content',item->'scene',item->'content'->'sources',p_actor,p_actor);
  end loop;result:=jsonb_build_object('projectId',pid,'pages',n);
 elsif op='business_restore' then
  pid:=(p_input->>'projectId')::uuid;
  if not private.pitch_project_visible(p_actor,p_session,(p_input->>'sourceProjectId')::uuid,'generate') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(pid::text,0));if exists(select 1 from public.pitch_projects where id=pid) then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  insert into public.pitch_projects(id,title,parent_project_id,theme_id,theme_version,is_test_data,created_by,updated_by,organization_id,region,city,business_line,data_as_of,composition_key)
   select pid,p_input->>'title',id,theme_id,theme_version,is_test_data,p_actor,p_actor,organization_id,region,city,business_line,data_as_of,composition_key from public.pitch_projects where id=(p_input->>'sourceProjectId')::uuid;
  insert into public.pitch_project_slides(id,project_id,position,asset_id,asset_version,template_id,template_version,layout_id,layout_version,theme_id,theme_version,content,scene,source_snapshot,created_by,updated_by)
   select gen_random_uuid(),pid,position,asset_id,asset_version,template_id,template_version,layout_id,layout_version,theme_id,theme_version,content,scene,source_snapshot,p_actor,p_actor from public.pitch_project_slides where project_id=(p_input->>'sourceProjectId')::uuid;
  insert into public.pitch_business_generations select pid,request_key,parameters,bindings,snapshots,recipes,changes,p_actor,now() from public.pitch_business_generations where project_id=(p_input->>'sourceProjectId')::uuid;
  result:=jsonb_build_object('projectId',pid);
 else
  if op in ('library_variant_commit','library_merge_commit') and exists(select 1 from public.pitch_content_assets where generated_project_id is not null and
   (id=(p_input->>'sourceId')::uuid or id in(select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_input->'sources','[]')) x))) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if op in ('asset_save','library_candidate_commit','library_variant_commit','library_merge_commit') then
   aid:=coalesce((p_input->>'assetId')::uuid,(p_input->>'targetId')::uuid);select current_version into oldversion from public.pitch_content_assets where id=aid;
   if exists(select 1 from public.pitch_content_assets where id=aid and generated_project_id is not null) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  end if;
  result:=private.pitch_studio_access_v3(p_actor,p_session,p_input);
  -- Content confirmation/revision pins the matching profile; the previous version is retained.
  if op in ('asset_save','library_candidate_commit','library_variant_commit','library_merge_commit') and aid is not null then
   insert into public.pitch_business_profiles select aid,a.current_version,p.profile,p_actor,now() from public.pitch_business_profiles p join public.pitch_content_assets a on a.id=aid where p.asset_id=coalesce((p_input->>'sourceId')::uuid,aid) and p.asset_version=coalesce((p_input->>'sourceVersion')::integer,oldversion) on conflict do nothing;
  elsif op='library_confirm' then
   for item in select value from jsonb_array_elements(p_input->'items') loop
    aid:=(item->>'assetId')::uuid;
    insert into public.pitch_business_profiles select aid,a.current_version,p.profile,p_actor,now() from public.pitch_business_profiles p join public.pitch_content_assets a on a.id=aid where p.asset_id=aid and p.asset_version=(item->>'expectedVersion')::integer on conflict do nothing;
   end loop;
  elsif op='project_clone_theme' then
   insert into public.pitch_business_generations select (p_input->>'projectId')::uuid,request_key,parameters,bindings,snapshots,recipes,changes,p_actor,now() from public.pitch_business_generations where project_id=(p_input->>'sourceProjectId')::uuid on conflict do nothing;
  end if;
  return result;
 end if;
 insert into private.pitch_events(actor_id,session_id,action,target_id,after_value) values(p_actor,p_session,op,coalesce(p_input->>'projectId',p_input->>'assetId',p_input->'recipe'->>'id','business'),result);
 return result;
end $$;
revoke all on function private.pitch_studio_access(uuid,uuid,jsonb),private.pitch_business_dependencies(uuid,uuid,uuid,text),private.pitch_business_data_allowed(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
-- RLS uses narrowly scoped predicates; no raw private state is exposed.
grant execute on function private.pitch_business_dependencies(uuid,uuid,uuid,text) to authenticated;
commit;

begin;
insert into public.pitch_templates(id,names,category_id,state,current_version) select 'business-content','{"zh":"企业业务模板","en":"Business templates"}',id,'published',1 from public.pitch_asset_categories where system_code='general';
insert into public.pitch_template_versions(template_id,version,adapter,config,sha256) values('business-content',1,'structured-content/2','{"id":"business-content","version":1,"names":{"zh":"企业业务模板","en":"Business templates"},"categoryCode":"general","assetTypes":["content"],"scenarios":["single-page","multi-page"],"inputSchema":"studio-parameters/2","adapter":"structured-content/2","dataSources":["content_asset"],"requiredPermissions":["internal_generate"],"layouts":["cover","section-divider","image-text","two-columns","kpi","team-profile","case-study","data-table","chart-insight","comparison","map-analysis","strategy-framework"],"exports":["pptx","png","svg","xlsx"],"ai":"none","missingData":"reject"}','7f0b8df8f194a7fdbdcf96bc9e9fb7fec83de0d18498823b8af823160437b466');
insert into public.pitch_business_templates(id,revision,category_id,config) select 'corporate-overview',1,id,'{"id":"corporate-overview","names":{"zh":"公司概览","en":"Corporate overview"},"description":"公司概览；保留经确认的事实、来源与业务日期。","accepts":["corporate"],"strategy":"overview","layoutId":"two-columns","maxAssets":1,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'corporate-metrics',1,id,'{"id":"corporate-metrics","names":{"zh":"公司核心指标","en":"Corporate metrics"},"description":"公司核心指标；保留经确认的事实、来源与业务日期。","accepts":["corporate"],"strategy":"metrics","layoutId":"kpi","maxAssets":1,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'corporate-capabilities',1,id,'{"id":"corporate-capabilities","names":{"zh":"业务能力","en":"Capabilities"},"description":"业务能力；保留经确认的事实、来源与业务日期。","accepts":["corporate"],"strategy":"capabilities","layoutId":"two-columns","maxAssets":1,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'team-single',1,id,'{"id":"team-single","names":{"zh":"单人介绍","en":"Member profile"},"description":"单人介绍；保留经确认的事实、来源与业务日期。","accepts":["team"],"strategy":"team","layoutId":"team-profile","maxAssets":1,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'team-multiple',1,id,'{"id":"team-multiple","names":{"zh":"多人团队","en":"Team profiles"},"description":"多人团队；保留经确认的事实、来源与业务日期。","accepts":["team"],"strategy":"team","layoutId":"team-profile","maxAssets":30,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'team-core',1,id,'{"id":"team-core","names":{"zh":"核心团队","en":"Core team"},"description":"核心团队；保留经确认的事实、来源与业务日期。","accepts":["team"],"strategy":"team","layoutId":"team-profile","maxAssets":12,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'team-roles',1,id,'{"id":"team-roles","names":{"zh":"项目人员分工","en":"Project roles"},"description":"项目人员分工；保留经确认的事实、来源与业务日期。","accepts":["team"],"strategy":"roles","layoutId":"data-table","maxAssets":30,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'team-organization',1,id,'{"id":"team-organization","names":{"zh":"团队组织结构","en":"Team organization"},"description":"团队组织结构；保留经确认的事实、来源与业务日期。","accepts":["team"],"strategy":"organization","layoutId":"data-table","maxAssets":30,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'case-detail',1,id,'{"id":"case-detail","names":{"zh":"案例详细页","en":"Detailed case study"},"description":"案例详细页；保留经确认的事实、来源与业务日期。","accepts":["case"],"strategy":"case-detail","layoutId":"case-study","maxAssets":1,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'case-brief',1,id,'{"id":"case-brief","names":{"zh":"案例精简页","en":"Brief case study"},"description":"案例精简页；保留经确认的事实、来源与业务日期。","accepts":["case"],"strategy":"case-brief","layoutId":"case-study","maxAssets":1,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'case-portfolio',1,id,'{"id":"case-portfolio","names":{"zh":"多案例组合","en":"Case portfolio"},"description":"多案例组合；保留经确认的事实、来源与业务日期。","accepts":["case"],"strategy":"case-portfolio","layoutId":"case-study","maxAssets":20,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'case-track-record',1,id,'{"id":"case-track-record","names":{"zh":"历史业绩汇总","en":"Track record"},"description":"历史业绩汇总；保留经确认的事实、来源与业务日期。","accepts":["case"],"strategy":"track-record","layoutId":"data-table","maxAssets":30,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'case-public-projects',1,id,'{"id":"case-public-projects","names":{"zh":"可公开项目展示","en":"Disclosed projects"},"description":"可公开项目展示；保留经确认的事实、来源与业务日期。","accepts":["case"],"strategy":"public-projects","layoutId":"data-table","maxAssets":30,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'research-page',1,id,'{"id":"research-page","names":{"zh":"研究观点与资料","en":"Research evidence"},"description":"研究观点与资料；保留经确认的事实、来源与业务日期。","accepts":["research"],"strategy":"research","layoutId":"two-columns","maxAssets":10,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
insert into public.pitch_business_templates(id,revision,category_id,config) select 'custom-content',1,id,'{"id":"custom-content","names":{"zh":"自定义内容板块","en":"Custom content"},"description":"自定义内容板块；保留经确认的事实、来源与业务日期。","accepts":["custom"],"strategy":"content","layoutId":"two-columns","maxAssets":10,"revision":1,"enabled":true}'::jsonb||jsonb_build_object('categoryId',id) from public.pitch_asset_categories where system_code='general';
commit;
