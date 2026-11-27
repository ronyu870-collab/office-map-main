begin;

alter table private.pitch_workspace_tasks add column workflow text not null default 'workspace'
  check(workflow in ('workspace','proposal'));

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_proposal_jobs;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  op text:=p_input->>'action';
  pid uuid;
  tid uuid;
  task private.pitch_workspace_tasks;
  project public.pitch_projects;
  confirmation jsonb;
  generation jsonb;
  target uuid;
  result jsonb;
begin
  if op in ('workspace_task_claim','workspace_task_check','workspace_task_complete','workspace_task_fail')
    and exists(select 1 from private.pitch_workspace_tasks
      where id=(p_input->>'taskId')::uuid and project_id=(p_input->>'projectId')::uuid
        and actor_id=p_actor and workflow='proposal') then
    if op='workspace_task_claim' then
      perform private.pitch_studio_access_before_proposal_jobs(p_actor,p_session,p_input||'{"action":"workspace_task_status"}'::jsonb);
      return '{"claimed":false}';
    end if;
    raise exception 'PITCH_INVALID';
  end if;
  if op is null or op not in ('workspace_proposal_start','workspace_proposal_lookup','workspace_proposal_claim','workspace_proposal_assemble',
    'workspace_proposal_complete','workspace_proposal_fail') then
    return private.pitch_studio_access_before_proposal_jobs(p_actor,p_session,p_input);
  end if;
  pid:=(p_input->>'projectId')::uuid;
  tid:=(p_input->>'taskId')::uuid;

  if op in ('workspace_proposal_start','workspace_proposal_lookup') then
    confirmation:=p_input->'confirmation';
    target:=(p_input->>'sourceProjectId')::uuid;
    if target is null or target=pid or jsonb_typeof(confirmation) is distinct from 'object'
      or octet_length(confirmation::text)>12000
      or (confirmation->>'projectId')::uuid is distinct from pid or (confirmation->>'taskId')::uuid is distinct from tid
      or (confirmation->>'planId')::uuid is null or (confirmation->>'expectedVersion')::integer is null
      or coalesce(confirmation->>'contextFingerprint','') !~ '^[0-9a-f]{64}$' then raise exception 'PITCH_INVALID';end if;
    if op='workspace_proposal_lookup' and not exists(select 1 from private.pitch_workspace_tasks
      where id=tid and project_id=pid and actor_id=p_actor and workflow='proposal') then
      return 'null'::jsonb;
    end if;
    result:=private.pitch_studio_access_before_proposal_jobs(p_actor,p_session,jsonb_build_object(
      'action','workspace_task_start','projectId',pid,'taskId',tid,'sourceProjectId',target,
      'expectedVersion',confirmation->'expectedVersion','command',jsonb_build_object('confirmation',confirmation)
    ));
    if (result->>'source_project_id')::uuid is distinct from target then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
    update private.pitch_workspace_tasks set workflow='proposal' where id=tid and workflow='workspace';
    select * into task from private.pitch_workspace_tasks where id=tid;
    if task.state='completed' and not private.pitch_project_visible(p_actor,p_session,target,'generate') then
      raise exception 'PITCH_DENIED' using errcode='42501';
    end if;
    return to_jsonb(task)-'command'-'token';
  end if;

  if not exists(select 1 from private.pitch_workspace_tasks
    where id=tid and project_id=pid and actor_id=p_actor and workflow='proposal') then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  if op='workspace_proposal_claim' then
    return private.pitch_studio_access_before_proposal_jobs(p_actor,p_session,p_input||'{"action":"workspace_task_claim"}'::jsonb);
  elsif op='workspace_proposal_fail' then
    return private.pitch_studio_access_before_proposal_jobs(p_actor,p_session,p_input||'{"action":"workspace_task_fail"}'::jsonb);
  end if;

  result:=private.pitch_studio_access_before_proposal_jobs(p_actor,p_session,p_input||'{"action":"workspace_task_check"}'::jsonb);
  if op='workspace_proposal_assemble' then return result;end if;

  -- The existing task check takes the parent and lease locks. The child
  -- project and the success receipt are committed in this same transaction.
  select * into project from public.pitch_projects where id=pid;
  select * into task from private.pitch_workspace_tasks where id=tid;
  generation:=p_input->'generation';
  if project.version is distinct from task.expected_version then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  if generation->>'action' is distinct from 'business_generate_commit'
    or (generation->>'projectId')::uuid is distinct from task.source_project_id
    or (generation->>'parentProjectId')::uuid is distinct from pid
    or (generation->>'expectedParentVersion')::integer is distinct from task.expected_version
    or generation->'scope' is distinct from jsonb_build_object(
      'organizationId',project.organization_id,'region',project.region,'city',project.city,'businessLine',project.business_line
    )
    or (generation?'reviewedPlanId' and generation->'reviewedPlanId' is distinct from task.command->'confirmation'->'planId')
    then raise exception 'PITCH_INVALID';end if;
  perform private.pitch_studio_access(p_actor,p_session,generation);
  update private.pitch_workspace_tasks set state='completed',stage='saved',updated_at=now()
    where id=tid returning * into task;
  insert into private.pitch_events(actor_id,session_id,action,target_id,after_value)
    values(p_actor,p_session,op,tid::text,jsonb_build_object('projectId',task.source_project_id,'state','completed'));
  return to_jsonb(task)-'command'-'token';
end $$;

revoke all on function private.pitch_studio_access_before_proposal_jobs(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
