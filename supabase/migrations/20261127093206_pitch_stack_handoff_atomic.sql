begin;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_stacking_handoff;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  pid uuid;
  tid uuid;
  project public.pitch_projects;
  task private.pitch_workspace_tasks;
  part jsonb;
  generation jsonb;
  snapshot jsonb;
  save jsonb;
  administrator boolean;
begin
  if p_input->>'action' is distinct from 'workspace_task_complete_stacking' then
    return private.pitch_studio_access_before_stacking_handoff(p_actor,p_session,p_input);
  end if;
  pid:=(p_input->>'projectId')::uuid;
  tid:=(p_input->>'taskId')::uuid;
  -- Take the parent lock before the receipt, and recheck the lease before
  -- making a restricted source project or mutating the target.
  perform private.pitch_studio_access_before_stacking_handoff(p_actor,p_session,
    p_input||'{"action":"workspace_task_check"}'::jsonb);
  select * into project from public.pitch_projects where id=pid;
  select * into task from private.pitch_workspace_tasks where id=tid;
  part:=task.command->'part';
  generation:=p_input->'generation';
  snapshot:=generation->'snapshots'->0;
  save:=p_input->'save';
  if project.version is distinct from task.expected_version then
    raise exception 'PITCH_CONFLICT' using errcode='23505';
  end if;
  if part->>'mode' is distinct from 'handoff' or part->'stackingSource'->>'kind' is distinct from 'stacking-plan'
    or task.command->'replaceIds' is distinct from '[]'::jsonb
    or generation->>'action' is distinct from 'business_generate_commit'
    or (generation->>'projectId')::uuid is distinct from task.source_project_id
    or (generation->>'parentProjectId')::uuid is distinct from pid
    or (generation->>'expectedParentVersion')::integer is distinct from task.expected_version
    or generation->'scope' is distinct from jsonb_build_object('organizationId',project.organization_id,
      'region',project.region,'city',project.city,'businessLine',project.business_line)
    or jsonb_array_length(generation->'snapshots') is distinct from 1
    or snapshot->>'entityId' is distinct from part->'stackingSource'->>'buildingId'
    or snapshot->>'dataVersion' is distinct from part->>'dataVersion'
    or snapshot->'dataAsOf' is distinct from part->'dataAsOf'
    or snapshot->'binding'->>'domain' is distinct from 'business'
    or snapshot->'binding'->>'disclosure' is distinct from 'restricted'
    or snapshot->'binding'->>'permissionRevision' is distinct from part->>'permissionRevision'
    or snapshot->'binding'->>'policyVersion' is distinct from part->>'policyVersion'
    or jsonb_array_length(generation->'generated') is distinct from 1
    or jsonb_array_length(generation->'slides') is distinct from 1
    or generation->'generated'->0->'content'->>'disclosure' is distinct from 'restricted'
    or generation->'generated'->0->'content'->'sources'->0->'visual'->>'versionHash' is distinct from part->>'dataVersion'
    or generation->'generated'->0->'content'->'sources'->0->'visual'->'origin'->>'buildingId'
      is distinct from part->'stackingSource'->>'buildingId'
    or jsonb_array_length(save->'slides') is distinct from 1+(select count(*) from public.pitch_project_slides where project_id=pid)
    or save->'slides'->-1->>'assetId' is distinct from generation->'generated'->0->>'id'
    or save->'slides'->-1->'content' is distinct from generation->'slides'->0->'content' then
    raise exception 'PITCH_INVALID';
  end if;
  if to_regprocedure('private.ai_admin_session_authority(uuid,uuid)') is null then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  execute 'select private.ai_admin_session_authority($1,$2)' into administrator using p_actor,p_session;
  if administrator is distinct from true then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
  perform private.pitch_studio_access(p_actor,p_session,generation);
  return private.pitch_studio_access_before_stacking_handoff(p_actor,p_session,
    p_input||'{"action":"workspace_task_complete"}'::jsonb);
end $$;

revoke all on function private.pitch_studio_access_before_stacking_handoff(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
