begin;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_edition;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid uuid; parent_id uuid; project public.pitch_projects; edition jsonb; result jsonb; prior_period text; next_period text;
begin
  if p_input->>'action'='workspace_edition_base' then
    pid:=(p_input->>'projectId')::uuid;
    select * into project from public.pitch_projects where id=pid and created_by=p_actor for share;
    if project.id is null or not private.pitch_project_visible(p_actor,p_session,pid,'generate') then
      raise exception 'PITCH_DENIED' using errcode='42501';
    end if;
    if project.version is distinct from (p_input->>'expectedVersion')::integer then
      raise exception 'PITCH_CONFLICT' using errcode='23505';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('slideId',s.id,'ownerProjectId',a.generated_project_id,
      'content',v.content,'recipeKey',g.parameters->'reviewedSlideKeys'->>s.id::text) order by s.position),'[]') into result
    from public.pitch_project_slides s
    join public.pitch_content_assets a on a.id=s.asset_id
    join public.pitch_asset_versions v on (v.asset_id,v.version)=(s.asset_id,s.asset_version)
    left join public.pitch_business_generations g on g.project_id=a.generated_project_id
    where s.project_id=pid and private.pitch_version_visible(p_actor,p_session,s.asset_id,s.asset_version,'generate');
    if jsonb_array_length(result)<>(select count(*) from public.pitch_project_slides where project_id=pid) then
      raise exception 'PITCH_DENIED' using errcode='42501';
    end if;
    return jsonb_build_object('pages',result,'title',(select parameters->>'title' from public.pitch_business_generations where project_id=pid),
      'recipeKeys',coalesce((
      select jsonb_agg(value) from public.pitch_business_generations own
      cross join lateral jsonb_each_text(own.parameters->'reviewedSlideKeys') entries(key,value) where own.project_id=pid
    ),'[]'));
  end if;
  if p_input->>'action' is distinct from 'business_generate_commit' or not p_input?'editionSave' then
    return private.pitch_studio_access_before_edition(p_actor,p_session,p_input);
  end if;
  pid:=(p_input->>'projectId')::uuid;
  parent_id:=(p_input->>'parentProjectId')::uuid;
  edition:=p_input->'editionSave';
  if pid is null or parent_id is null or pid=parent_id or (p_input->>'reviewedPlanId')::uuid is null
    or jsonb_typeof(edition) is distinct from 'object' or jsonb_typeof(edition->'slides') is distinct from 'array'
    or jsonb_array_length(edition->'slides') not between 1 and 50
    or (edition->>'projectId')::uuid is distinct from pid or (edition->>'expectedVersion')::int is distinct from 1 then
    raise exception 'PITCH_INVALID' using errcode='22023';
  end if;
  if not private.pitch_project_visible(p_actor,p_session,parent_id,'generate') then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  select * into project from public.pitch_projects where id=parent_id and created_by=p_actor for share;
  if project.id is null then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if project.version is distinct from (p_input->>'expectedParentVersion')::integer then
    raise exception 'PITCH_CONFLICT' using errcode='23505';
  end if;
  select context->>'period' into prior_period from public.pitch_workspace_states where project_id=parent_id;
  next_period:=edition->'context'->>'period';
  if coalesce(prior_period,'') !~ '^20[0-9]{2}-Q[1-4]$' or coalesce(next_period,'') !~ '^20[0-9]{2}-Q[1-4]$'
    or prior_period=next_period or next_period is distinct from p_input->'proposalContext'->>'period'
    or p_input->'scope' is distinct from jsonb_build_object('organizationId',project.organization_id,
    'region',project.region,'city',project.city,'businessLine',project.business_line) then
    raise exception 'PITCH_INVALID' using errcode='22023';
  end if;
  -- Do not persist a duplicate of the overlay in the generation parameters.
  -- The ordinary save owns history, dependency checks, order and page settings.
  result:=private.pitch_studio_access_before_edition(p_actor,p_session,p_input-'editionSave');
  if result->>'replayed' is distinct from 'true' then
    if exists(select 1 from jsonb_array_elements(edition->'slides') selected(page)
      where not exists(select 1 from public.pitch_project_slides s
        where s.project_id in (parent_id,pid) and s.asset_id=(page->>'assetId')::uuid
          and s.asset_version=(page->>'assetVersion')::int)) then
      raise exception 'PITCH_INVALID' using errcode='22023';
    end if;
    perform private.pitch_studio_access(p_actor,p_session,edition||'{"action":"workspace_save"}'::jsonb);
    result:=result||jsonb_build_object('pages',jsonb_array_length(edition->'slides'));
  end if;
  return result;
end $$;

revoke all on function private.pitch_studio_access_before_edition(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
