begin;

create index pitch_exports_active_package
  on public.pitch_exports(project_id,created_by,format,audience,delivery_revision)
  where state='pending' and delivery_revision is not null;

create function private.pitch_equivalent_package_jobs(target public.pitch_exports, job_state text)
returns table(export_id uuid,job_id uuid)
language sql set search_path='' as $$
  select e.id,e.job_id from public.pitch_exports e join public.pitch_jobs j on j.id=e.job_id
  where e.id<>target.id and e.project_id=target.project_id and e.created_by=target.created_by
    and e.state='pending' and e.delivery_revision is not null
    and e.delivery_revision=target.delivery_revision and e.format=target.format and e.audience=target.audience
    and e.filename is not distinct from target.filename
    and e.slide_versions=target.slide_versions and e.authorization_snapshot=target.authorization_snapshot
    and j.state=job_state and j.lease_until>clock_timestamp();
$$;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_package_claim;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  op text:=p_input->>'action';
  target public.pitch_exports;
  receipt jsonb;
begin
  if op='export_prepare' and p_input->>'pipeline'='delivery/1' and p_input->>'deliveryRevision' is not null
    and exists(select 1 from public.pitch_projects p where p.id=(p_input->>'projectId')::uuid and p.created_by=p_actor) then
    -- A new receipt either joins an in-flight package before completion or
    -- sees the ready package during its existing reuse check.
    perform pg_advisory_xact_lock(hashtextextended(((p_input->>'projectId')::uuid)::text,12));
  end if;
  if op is null or op not in ('export_claim','export_status','export_complete') then
    return private.pitch_studio_access_before_package_claim(p_actor,p_session,p_input);
  end if;

  if op in ('export_claim','export_complete') then
    select * into target from public.pitch_exports
    where id=(p_input->>'exportId')::uuid and project_id=(p_input->>'projectId')::uuid
      and created_by=p_actor and state='pending' and delivery_revision is not null;
    if not found then
      return private.pitch_studio_access_before_package_claim(p_actor,p_session,p_input);
    end if;
    -- Serialize claims and completion before taking receipt locks. Rendering and upload happen
    -- after the transaction and continue to use the existing worker lease.
    perform pg_advisory_xact_lock(hashtextextended(target.project_id::text,12));
    if op='export_claim' then
      receipt:=private.pitch_studio_access_before_package_claim(
        p_actor,p_session,p_input||'{"action":"export_status"}'::jsonb);
      if receipt->>'stage' is distinct from 'queued'
        or exists(select 1 from private.pitch_equivalent_package_jobs(target,'running')) then
        return '{"claimed":false}';
      end if;
    end if;
  end if;

  receipt:=private.pitch_studio_access_before_package_claim(p_actor,p_session,p_input);
  if op='export_status' and receipt->>'stage'='queued' then
    select * into target from public.pitch_exports
    where id=(p_input->>'exportId')::uuid and project_id=(p_input->>'projectId')::uuid
      and created_by=p_actor and state='pending' and delivery_revision is not null;
    if found and exists(select 1 from private.pitch_equivalent_package_jobs(target,'running')) then
      return receipt||'{"stage":"waiting_for_package"}'::jsonb;
    end if;
  elsif op='export_complete' and receipt->>'state'='ready' then
    -- Completion has just revalidated this exact version and authorization
    -- snapshot. Resolve waiting receipts even if their clients disconnected.
    with followers as (
      update public.pitch_exports e
      set file_export_id=target.id,state='ready',sha256=p_input->>'sha256',size_bytes=(p_input->>'size')::bigint
      from private.pitch_equivalent_package_jobs(target,'queued') f
      where e.id=f.export_id and e.state='pending'
      returning e.id,e.job_id
    ), finished as (
      update public.pitch_jobs j set state='succeeded',progress=100,updated_at=clock_timestamp()
      from followers f where j.id=f.job_id
      returning j.id
    )
    insert into private.pitch_events(actor_id,session_id,action,target_id,after_value)
      select p_actor,p_session,'export_reuse',f.id::text,jsonb_build_object('packageId',target.id)
      from followers f join finished j on j.id=f.job_id;
  end if;
  return receipt;
end $$;

revoke all on function private.pitch_equivalent_package_jobs(public.pitch_exports,text),
  private.pitch_studio_access_before_package_claim(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
