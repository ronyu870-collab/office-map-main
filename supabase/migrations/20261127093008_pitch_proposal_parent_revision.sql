begin;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_proposal_parent_revision;

create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  child_id uuid;
  parent_id uuid;
  parent_version integer;
begin
  if p_input->>'action'='business_generate_commit' and p_input?'expectedParentVersion' then
    child_id:=(p_input->>'projectId')::uuid;
    parent_id:=(p_input->>'parentProjectId')::uuid;
    if child_id is null or parent_id is null or child_id=parent_id
      or (p_input->>'expectedParentVersion') is null or (p_input->>'expectedParentVersion') !~ '^[1-9][0-9]{0,9}$' then
      raise exception 'PITCH_INVALID' using errcode='22023';
    end if;

    -- Preserve the existing commit order and let its receipt check handle exact retries.
    perform pg_advisory_xact_lock(hashtextextended(child_id::text,0));
    if not exists(select 1 from public.pitch_business_generations where project_id=child_id) then
      if not private.pitch_project_visible(p_actor,p_session,parent_id,'generate') then
        raise exception 'PITCH_DENIED' using errcode='42501';
      end if;
      select version into parent_version from public.pitch_projects where id=parent_id for share;
      if parent_version is distinct from (p_input->>'expectedParentVersion')::bigint then
        raise exception 'PITCH_CONFLICT' using errcode='23505';
      end if;
    end if;
  end if;
  return private.pitch_studio_access_before_proposal_parent_revision(p_actor,p_session,p_input);
end $$;

revoke all on function private.pitch_studio_access_before_proposal_parent_revision(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;

commit;
