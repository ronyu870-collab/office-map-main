-- Resolve a lost acknowledgement using the authenticated task, before reading newer source data.
begin;
alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_handoff_replay;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  pid uuid;
  tid uuid;
  task private.pitch_workspace_tasks;
begin
  if p_input->>'action' is distinct from 'workspace_handoff_replay' then
    return private.pitch_studio_access_before_handoff_replay(p_actor,p_session,p_input);
  end if;
  pid := (p_input->>'projectId')::uuid;
  tid := (p_input->>'taskId')::uuid;
  if not exists(select 1 from private.pitch_workspace_tasks where id=tid and project_id=pid and actor_id=p_actor) then
    return null;
  end if;
  -- Match the lock order used by completion, cancellation and task start.
  perform 1 from public.pitch_projects where id=pid and created_by=p_actor for update;
  if not found or not private.pitch_project_visible(p_actor,p_session,pid,'generate') then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  select * into task from private.pitch_workspace_tasks
    where id=tid and project_id=pid and actor_id=p_actor for update;
  if not found or task.command->'part'->>'mode' is distinct from 'handoff' then return null; end if;
  -- Older requests retain the original replay path.
  if not (task.command?'request') then return null; end if;
  if task.command->'request' is distinct from p_input->'request' then
    raise exception 'PITCH_CONFLICT' using errcode='23505';
  end if;
  return private.pitch_studio_access_before_handoff_replay(p_actor,p_session,
    jsonb_build_object('action','workspace_task_status','projectId',pid,'taskId',tid));
end $$;
revoke all on function private.pitch_studio_access_before_handoff_replay(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
