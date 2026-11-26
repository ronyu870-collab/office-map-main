-- Resolve document objects from their immutable business generation and publish refreshes atomically.
begin;
alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_bindings;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  op text:=p_input->>'action';
  pid uuid;
  project public.pitch_projects;
  result jsonb;
  generation jsonb;
begin
  if coalesce(op,'') not in ('workspace_document_bindings','workspace_data_refresh_commit') then
    return private.pitch_studio_access_before_bindings(p_actor,p_session,p_input);
  end if;
  pid:=(p_input->>'projectId')::uuid;
  if op='workspace_document_bindings' then
    select * into project from public.pitch_projects where id=pid and created_by=p_actor for share;
    if project.id is null or not private.pitch_project_visible(p_actor,p_session,pid,'generate') then
      raise exception 'PITCH_DENIED' using errcode='42501';
    end if;
    if project.version is distinct from (p_input->>'expectedVersion')::integer then
      raise exception 'PITCH_CONFLICT' using errcode='23505';
    end if;
    select coalesce(jsonb_agg(to_jsonb(c) order by c.asset_id,c.asset_version),'[]') into result
    from (
      select distinct on (s.asset_id,s.asset_version)
        s.asset_id,s.asset_version,g.project_id generation_id,
        sn.ordinality::int-1 snapshot_index,part.ordinality::int-1 content_index,
        sn.snapshot->'binding' binding, sn.snapshot->>'dataVersion' data_version,
        sn.snapshot->>'dataAsOf' data_as_of, sn.snapshot->'parameters' parameters,
        coalesce(sn.snapshot->'plans'->0->>'operation'='trend' and sn.snapshot->'parameters'->>'templateId'
          in ('building-profile','project-comparison'),false) compares_quarters,
        coalesce(g.parameters->'parts' @? '$[*] ? (@.mode == "dynamic" && exists(@.researchAssetId))',false) has_research,
        (select jsonb_agg(x - array['resultId','createdAt','snapshotId','dataVersion','scopeFingerprint','registryVersion','parameters','limitations','analysis'] order by row_number)
          from jsonb_array_elements(sn.snapshot->'results') with ordinality res(x,row_number)) results,
        part.content
      from public.pitch_project_slides s
      join public.pitch_asset_versions v on (v.asset_id,v.version)=(s.asset_id,s.asset_version)
      join public.pitch_content_assets a on a.id=s.asset_id
      join public.pitch_business_generations g on g.project_id=a.generated_project_id
      cross join lateral jsonb_array_elements(g.snapshots) with ordinality sn(snapshot,ordinality)
      cross join lateral jsonb_array_elements(sn.snapshot->'content') with ordinality part(content,ordinality)
      where s.project_id=pid and part.content->'sources'=v.content->'sources' and part.content->'blocks'=v.content->'blocks'
      order by s.asset_id,s.asset_version,sn.ordinality,part.ordinality
    ) c;
    return result;
  end if;

  select * into project from public.pitch_projects where id=pid and created_by=p_actor for update;
  if project.id is null or not private.pitch_project_visible(p_actor,p_session,pid,'generate') then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  if project.version is distinct from (p_input->>'expectedVersion')::integer then
    raise exception 'PITCH_CONFLICT' using errcode='23505';
  end if;
  generation:=p_input->'generation';
  if (generation->>'parentProjectId')::uuid is distinct from pid or generation->'scope' is distinct from jsonb_build_object(
    'organizationId',project.organization_id,'region',project.region,'city',project.city,'businessLine',project.business_line
  ) then raise exception 'PITCH_INVALID'; end if;
  perform private.pitch_studio_access_before_bindings(p_actor,p_session,generation||'{"action":"business_generate_commit"}'::jsonb);
  result:=private.pitch_studio_access_before_bindings(p_actor,p_session,p_input->'save'||jsonb_build_object(
    'action','workspace_save','projectId',pid,'expectedVersion',project.version
  ));
  update public.pitch_projects set state='archived' where id=(generation->>'projectId')::uuid;
  insert into private.pitch_events(actor_id,session_id,action,target_id,after_value)
    values(p_actor,p_session,op,pid::text,jsonb_build_object('version',project.version+1,'sourceProjectId',generation->>'projectId'));
  return result;
end $$;

revoke all on function private.pitch_studio_access_before_bindings(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
