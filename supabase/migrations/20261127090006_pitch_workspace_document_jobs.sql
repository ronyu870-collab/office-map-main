-- Preserve idempotent workspace task receipts across project revisions.
begin;
alter table private.pitch_workspace_tasks add column stage text
  check (stage in ('preparing', 'assembling', 'saved'));

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_document_jobs;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  op text := p_input->>'action';
  pid uuid;
  tid uuid;
  task private.pitch_workspace_tasks;
  receipt jsonb;
  destination public.pitch_projects;
begin
  if op not in ('workspace_handoff_start','workspace_task_start','workspace_task_claim','workspace_task_retry','workspace_task_check','workspace_task_complete') then
    return private.pitch_studio_access_before_document_jobs(p_actor,p_session,p_input);
  end if;
  pid := (p_input->>'projectId')::uuid;
  tid := (p_input->>'taskId')::uuid;

  if op='workspace_handoff_start' then
    if p_input?'create' then
      perform pg_advisory_xact_lock(hashtextextended(pid::text,7));
      select * into destination from public.pitch_projects where id=pid for update;
      if not found then
        perform private.pitch_studio_access_before_document_jobs(p_actor,p_session,p_input->'create'||
          jsonb_build_object('action','workspace_create','projectId',pid));
      elsif destination.created_by<>p_actor or not exists(
        select 1 from private.pitch_workspace_tasks t where t.id=tid and t.project_id=pid and t.actor_id=p_actor
          and t.command=p_input->'command'
      ) then
        raise exception 'PITCH_CONFLICT' using errcode='23505';
      end if;
    end if;
    return private.pitch_studio_access(p_actor,p_session,(p_input-'create')||'{"action":"workspace_task_start"}'::jsonb);
  end if;

  if op in ('workspace_task_start','workspace_task_retry') then
    -- Keep the same project-first lock order as claim, cancel and completion.
    perform 1 from public.pitch_projects where id=pid and created_by=p_actor for update;
    if not found or not private.pitch_project_visible(p_actor,p_session,pid,'generate') then
      raise exception 'PITCH_DENIED' using errcode='42501';
    end if;
    select * into task from private.pitch_workspace_tasks
      where id=tid and project_id=pid and actor_id=p_actor for update;
    if found and (op='workspace_task_start' or task.state in ('queued','processing','completed')) then
      if op='workspace_task_start' and
        (task.expected_version is distinct from (p_input->>'expectedVersion')::integer
         or task.command is distinct from p_input->'command') then
        raise exception 'PITCH_CONFLICT' using errcode='23505';
      end if;
      receipt := private.pitch_studio_access_before_document_jobs(p_actor,p_session,p_input||'{"action":"workspace_task_status"}'::jsonb);
      if op='workspace_task_start' or receipt->>'state'<>'failed' then return receipt; end if;
    end if;
  end if;

  receipt := private.pitch_studio_access_before_document_jobs(p_actor,p_session,p_input);
  if op='workspace_task_claim' and receipt->>'claimed'='true' then
    update private.pitch_workspace_tasks set stage='preparing' where id=tid;
    select * into task from private.pitch_workspace_tasks where id=tid;
    return jsonb_build_object('claimed',true,'task',to_jsonb(task),'sourceReady',exists(
      select 1 from public.pitch_projects where id=task.source_project_id and created_by=p_actor
    ));
  elsif op in ('workspace_task_retry','workspace_task_check','workspace_task_complete') then
    update private.pitch_workspace_tasks
      set stage=case op when 'workspace_task_check' then 'assembling' when 'workspace_task_complete' then 'saved' end
      where id=tid
      returning * into task;
    return to_jsonb(task)-'command'-'token';
  end if;
  return receipt;
end $$;
revoke all on function private.pitch_studio_access_before_document_jobs(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
