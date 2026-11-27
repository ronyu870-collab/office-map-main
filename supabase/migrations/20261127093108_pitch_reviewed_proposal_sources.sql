begin;

alter function private.pitch_business_data_allowed(uuid,uuid,jsonb) rename to pitch_data_allowed_before_reviewed_proposal;
create function private.pitch_business_data_allowed(p_user uuid,p_session uuid,p_snapshots jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare ordinary jsonb; editorial jsonb; authority jsonb; grant_row jsonb; revision text;
begin
  if jsonb_typeof(p_snapshots) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_snapshots)>0 and current_setting('transaction_read_only')='on' then return false; end if;
  select coalesce(jsonb_agg(item) filter (where item->'binding'->>'domain' is distinct from 'business'),'[]'),
    coalesce(jsonb_agg(item) filter (where item->'binding'->>'domain'='business'),'[]')
    into ordinary,editorial from jsonb_array_elements(p_snapshots) item;
  if not private.pitch_data_allowed_before_reviewed_proposal(p_user,p_session,ordinary) then return false; end if;
  if editorial='[]'::jsonb then return true; end if;
  if to_regprocedure('private.ai_query_authority(uuid,uuid,uuid)') is null
    or to_regclass('private.ai_business_research_grants') is null then return false; end if;
  execute 'select private.ai_query_authority($1,$1,$2)' into authority using p_user,p_session;
  if authority->>'allowed' is distinct from 'true' or not coalesce(authority->'capabilities' ? 'query:catalog',false)
    or not coalesce(authority->'capabilities' ? 'export:internal',false) then return false; end if;
  execute 'select to_jsonb(g) from private.ai_business_research_grants g where user_id=$1 and enabled and valid_until>clock_timestamp() and allow_export for share'
    into grant_row using p_user;
  if grant_row is null then return false; end if;
  revision:=encode(sha256(convert_to(jsonb_build_array(authority->>'permission_revision',grant_row)::text,'UTF8')),'hex');
  return not exists (select 1 from jsonb_array_elements(editorial) item
    where item->'binding'->>'permissionRevision' is distinct from revision
    or item->'binding'->>'policyVersion' is distinct from 'business-research/1');
end $$;

revoke all on function private.pitch_data_allowed_before_reviewed_proposal(uuid,uuid,jsonb),
  private.pitch_business_data_allowed(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_reviewed_proposal;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_input->>'action' is distinct from 'business_generate_commit' or not p_input?'proposalContext' then
    return private.pitch_studio_access_before_reviewed_proposal(p_actor,p_session,p_input);
  end if;
  if p_input->>'reviewedPlanId' is null or p_input->>'parentProjectId' is null or not p_input?'expectedParentVersion'
    or jsonb_typeof(p_input->'proposalContext') is distinct from 'object'
    or jsonb_array_length(coalesce(p_input->'snapshots','[]'))=0 then
    raise exception 'PITCH_INVALID' using errcode='22023';
  end if;
  result:=private.pitch_studio_access_before_reviewed_proposal(p_actor,p_session,p_input);
  if result->>'replayed' is distinct from 'true' then
    insert into public.pitch_workspace_states(project_id,context,active_slide)
    values((result->>'projectId')::uuid,p_input->'proposalContext',(p_input->'slides'->0->>'slideId')::uuid);
  end if;
  return result;
end $$;

revoke all on function private.pitch_studio_access_before_reviewed_proposal(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;

commit;
