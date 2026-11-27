begin;

alter function private.pitch_studio_access(uuid,uuid,jsonb)
  rename to pitch_studio_access_before_pinned_library;

create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  op text:=p_input->>'action';
  pid uuid;
  aid uuid;
  selected_version integer;
  request_key text;
  asset public.pitch_content_assets;
  source_version public.pitch_asset_versions;
  project public.pitch_projects;
  page jsonb;
  pages integer:=0;
  result jsonb;
begin
  if op is null or op not in ('library_normalize_pinned_lookup','library_normalize_pinned_commit') then
    return private.pitch_studio_access_before_pinned_library(p_actor,p_session,p_input);
  end if;

  pid:=(p_input->>'projectId')::uuid;
  aid:=(p_input->>'assetId')::uuid;
  selected_version:=(p_input->>'assetVersion')::integer;
  request_key:=p_input->>'compositionKey';
  select * into asset from public.pitch_content_assets where id=aid for share;
  select * into source_version from public.pitch_asset_versions where asset_id=aid and version=selected_version;
  if asset.state is distinct from 'published' or source_version.state is distinct from 'published'
    or not private.pitch_version_visible(p_actor,p_session,aid,selected_version,'generate')
    or exists(select 1 from private.pitch_content_media(source_version.content) media
      where not private.pitch_media_visible(p_actor,p_session,media.id,media.version))
  then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if (p_input->>'sourceSha') is distinct from source_version.sha256
    or not coalesce(request_key ~ '^[a-f0-9]{64}$',false)
  then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;

  if op='library_normalize_pinned_commit' then
    perform pg_advisory_xact_lock(hashtextextended(pid::text,0));
  end if;
  select * into project from public.pitch_projects where id=pid;
  if found then
    if project.created_by is distinct from p_actor or project.composition_key is distinct from request_key
    then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
    if not private.pitch_project_visible(p_actor,p_session,pid,'generate')
    then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    return jsonb_build_object('projectId',pid,'replayed',true);
  end if;
  if op='library_normalize_pinned_lookup' then return null;end if;

  if not exists(select 1 from public.pitch_design_themes where id=p_input->>'themeId' and state='published')
    or not exists(select 1 from public.pitch_templates where id='history-standardizer' and state='published')
  then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if not coalesce(jsonb_array_length(p_input->'slides') between 1 and 50,false)
    or p_input->'report'->>'engine' is distinct from 'history-normalize/1'
    or (p_input->'report'->>'assetId')::uuid is distinct from aid
    or (p_input->'report'->>'assetVersion')::integer is distinct from selected_version
  then raise exception 'PITCH_INVALID';end if;

  insert into public.pitch_projects(id,title,theme_id,theme_version,is_test_data,created_by,updated_by,
    organization_id,region,city,business_line,data_as_of,composition_key,normalization_report)
  values(pid,p_input->>'title',p_input->>'themeId',(p_input->>'themeVersion')::integer,source_version.is_test_data,
    p_actor,p_actor,asset.organization_id,asset.region,asset.city,asset.business_line,
    (source_version.content->>'dataAsOf')::date,request_key,p_input->'report');

  for page in select value from jsonb_array_elements(p_input->'slides') loop
    if page->'content'->'sources' is distinct from source_version.content->'sources'
      or page->'content'->'dataAsOf' is distinct from source_version.content->'dataAsOf'
      or page->'content'->'locale' is distinct from source_version.content->'locale'
      or page->'content'->'disclosure' is distinct from source_version.content->'disclosure'
      or page->'content'->'isTestData' is distinct from source_version.content->'isTestData'
      or page->'scene'->>'themeId' is distinct from p_input->>'themeId'
      or page->'scene'->>'themeVersion' is distinct from p_input->>'themeVersion'
    then raise exception 'PITCH_INVALID';end if;
    pages:=pages+1;
    insert into public.pitch_project_slides(id,project_id,position,asset_id,asset_version,template_id,template_version,
      layout_id,layout_version,theme_id,theme_version,content,scene,source_snapshot,created_by,updated_by)
    values((page->>'slideId')::uuid,pid,pages,aid,selected_version,'history-standardizer',1,
      page->'scene'->>'layoutId',(page->'scene'->>'layoutVersion')::integer,p_input->>'themeId',
      (p_input->>'themeVersion')::integer,page->'content',page->'scene',source_version.content->'sources',p_actor,p_actor);
  end loop;

  insert into public.pitch_workspace_states(project_id,context,active_slide)
  values(pid,jsonb_build_object('language',case when source_version.content->>'locale' like 'en%' then 'en' else 'zh' end),
    (p_input->'slides'->0->>'slideId')::uuid);
  result:=jsonb_build_object('projectId',pid,'pages',pages,'assetId',aid,'assetVersion',selected_version);
  insert into private.pitch_events(actor_id,session_id,action,target_id,after_value)
    values(p_actor,p_session,op,pid::text,result);
  return result;
end $$;

revoke all on function private.pitch_studio_access_before_pinned_library(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
