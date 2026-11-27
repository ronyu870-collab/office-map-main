begin;

-- Compare stable formal sources and their result tables, ignoring receipt IDs
-- and issuance timestamps. Both the preview and the final commit use this.
create function private.pitch_quarter_edition_evidence(p_snapshots jsonb) returns jsonb
language sql immutable set search_path='' as $$
  with quarterly as (
    select s,r,r->'parameters' p from jsonb_array_elements(case
      when jsonb_typeof(p_snapshots)='array' then p_snapshots else '[]'::jsonb end) snaps(s)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s->'results')='array' then s->'results' else '[]'::jsonb end) results(r)
    where s->'binding'->>'domain'='quarter' and s->'binding'->>'disclosure'='internal'
  ), queries as (
    select s,r,case
      when jsonb_typeof(p->'executedPlan')='object' then p->'executedPlan'
      -- Reviewed market reports archive the original query envelope. Its
      -- observed timestamp and returned groups are not query inputs.
      when jsonb_typeof(p->'scope')='object' and jsonb_typeof(p->'scope'->'pitchScope')='string'
        and jsonb_typeof(p->'scope'->'buildingIds')='array' and jsonb_typeof(p->'metric')='string'
        and ((r->>'operation' in ('aggregate','group_aggregate') and jsonb_typeof(p->'period')='object')
          or (r->>'operation'='trend' and jsonb_typeof(p->'start')='object' and jsonb_typeof(p->'end')='object'))
      then jsonb_set(p-'groups','{scope}',(p->'scope')-'readAt') end plan
    from quarterly
  ), receipts as (
    select case when s?'id' and s?'entityId' and plan is not null
      and coalesce(r->>'sourceFingerprint','') ~ '^[0-9a-f]{64}$' and jsonb_typeof(r->'table')='object'
      then jsonb_build_array(s->>'id',s->>'entityId',r->>'operation',plan) end intent,
      jsonb_build_array(r->>'sourceFingerprint',r->'table') version
    from queries
  )
  select case when count(*)>0 and count(*)=count(distinct intent) then
    jsonb_build_object('intent',jsonb_agg(intent order by intent),
      'version',jsonb_agg(jsonb_build_array(intent,version) order by intent))
  end from receipts
$$;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_correction;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op text:=p_input->>'action'; parent_id uuid; destination uuid;
  project public.pitch_projects; original public.pitch_business_generations;
  edition jsonb; context jsonb; before_evidence jsonb; after_evidence jsonb; state text; result jsonb;
begin
  if op is distinct from 'workspace_edition_correction_probe'
    and not (coalesce(op='business_generate_commit',false) and p_input?'quarterCorrection') then
    return private.pitch_studio_access_before_correction(p_actor,p_session,p_input);
  end if;

  parent_id:=(p_input->>case when op='workspace_edition_correction_probe' then 'projectId' else 'parentProjectId' end)::uuid;
  if not private.pitch_project_visible(p_actor,p_session,parent_id,'generate') then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  select * into project from public.pitch_projects where id=parent_id and created_by=p_actor for share;
  if project.id is null then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if project.version is distinct from (p_input->>case when op='workspace_edition_correction_probe' then 'expectedVersion' else 'expectedParentVersion' end)::int then
    raise exception 'PITCH_CONFLICT' using errcode='23505';
  end if;
  select w.context into context from public.pitch_workspace_states w where w.project_id=parent_id;
  select * into original from public.pitch_business_generations where project_id=parent_id;
  if context->>'business' is distinct from 'market-report' or coalesce(context->>'period','') !~ '^20[0-9]{2}-Q[1-4]$'
    or (op='workspace_edition_correction_probe' and context->>'period' is distinct from p_input->>'period')
    or coalesce(jsonb_typeof(p_input->'snapshots'),'')<>'array' then
    raise exception 'PITCH_INVALID' using errcode='22023';
  end if;

  before_evidence:=private.pitch_quarter_edition_evidence(original.snapshots);
  after_evidence:=private.pitch_quarter_edition_evidence(p_input->'snapshots');
  state:=case when before_evidence is null or after_evidence is null
      or original.parameters->>'reviewedPlanId' is null
      or context->>'period' is distinct from original.parameters->'proposalContext'->>'period' then 'unavailable'
    when before_evidence->'intent' is distinct from after_evidence->'intent' then 'scope_changed'
    when before_evidence->'version'=after_evidence->'version' then 'unchanged'
    else 'changed' end;
  if op='workspace_edition_correction_probe' then return jsonb_build_object('state',state);end if;
  if state<>'changed' or p_input->'quarterCorrection' is distinct from 'true'::jsonb then
    raise exception 'PITCH_PROPOSAL_REVIEW_REQUIRED' using errcode='23505';
  end if;

  destination:=(p_input->>'projectId')::uuid;
  edition:=p_input->'editionSave';
  if destination is null or destination=parent_id or (p_input->>'reviewedPlanId')::uuid is null
    or p_input->>'requestKey'=original.request_key
    or jsonb_typeof(edition) is distinct from 'object' or jsonb_typeof(edition->'slides') is distinct from 'array'
    or jsonb_array_length(edition->'slides') not between 1 and 50
    or (edition->>'projectId')::uuid is distinct from destination or (edition->>'expectedVersion')::int is distinct from 1
    or exists(select 1 from unnest(array['business','period','client','language','buildingIds']) key
      where edition->'context'->key is distinct from context->key or p_input->'proposalContext'->key is distinct from context->key)
    or p_input->'scope' is distinct from jsonb_build_object('organizationId',project.organization_id,
      'region',project.region,'city',project.city,'businessLine',project.business_line)
    then raise exception 'PITCH_INVALID' using errcode='22023';end if;

  result:=private.pitch_studio_access_before_correction(p_actor,p_session,p_input-'editionSave'-'quarterCorrection');
  if result->>'replayed' is distinct from 'true' then
    if exists(select 1 from jsonb_array_elements(edition->'slides') selected(page)
      where not exists(select 1 from public.pitch_project_slides s
        where s.project_id in (parent_id,destination) and s.asset_id=(page->>'assetId')::uuid
          and s.asset_version=(page->>'assetVersion')::int)) then
      raise exception 'PITCH_INVALID' using errcode='22023';
    end if;
    perform private.pitch_studio_access(p_actor,p_session,edition||'{"action":"workspace_save"}'::jsonb);
    result:=result||jsonb_build_object('pages',jsonb_array_length(edition->'slides'));
  end if;
  return result;
end $$;

revoke all on function private.pitch_quarter_edition_evidence(jsonb),
  private.pitch_studio_access_before_correction(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
