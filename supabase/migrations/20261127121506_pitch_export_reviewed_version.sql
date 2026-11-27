begin;

alter table public.pitch_exports add column requested_project_version integer
  check (requested_project_version > 0);

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_export_revision;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt jsonb; expected integer; admitted integer; project_version integer; pid uuid; eid uuid;
begin
  if p_input->>'action' is distinct from 'export_prepare'
    or p_input->>'pipeline' is distinct from 'delivery/1' or not p_input?'expectedVersion' then
    return private.pitch_studio_access_before_export_revision(p_actor,p_session,p_input);
  end if;
  if jsonb_typeof(p_input->'expectedVersion') is distinct from 'number'
    or p_input->>'expectedVersion' !~ '^[1-9][0-9]{0,9}$'
    or (p_input->>'expectedVersion')::bigint > 2147483647 then
    raise exception 'PITCH_INVALID' using errcode='22023';
  end if;
  expected:=(p_input->>'expectedVersion')::integer;
  pid:=(p_input->>'projectId')::uuid;
  eid:=(p_input->>'exportId')::uuid;

  -- Use the same lock order as package admission and keep the project pinned
  -- until the existing delivery function has interpreted the selected indexes.
  if not exists(select 1 from public.pitch_projects p where p.id=pid and p.created_by=p_actor) then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(pid::text,12));
  select p.version into project_version from public.pitch_projects p where p.id=pid and p.created_by=p_actor
    and private.pitch_access(p_actor,p_session,p.organization_id,p.region,p.city,p.business_line,'generate')
    and not exists(select 1 from public.pitch_workspace_states w where w.project_id=pid and w.deleted_at is not null)
    for share;
  if not found then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(eid::text,6));
  select requested_project_version into admitted from public.pitch_exports where id=eid and project_id=pid and created_by=p_actor;
  if not found then admitted:=project_version;end if;
  if admitted is distinct from expected then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;

  receipt:=private.pitch_studio_access_before_export_revision(p_actor,p_session,p_input-'expectedVersion');
  if receipt->>'replayed' is distinct from 'true' and receipt->>'exportId'=eid::text then
    update public.pitch_exports set requested_project_version=expected
      where id=eid and project_id=pid and created_by=p_actor;
  end if;
  return receipt;
end $$;

revoke all on function private.pitch_studio_access_before_export_revision(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
