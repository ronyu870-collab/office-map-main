begin;
alter table public.pitch_exports add column delivery_revision text;
alter table public.pitch_exports add column file_export_id uuid references public.pitch_exports(id);
alter table public.pitch_exports add check(file_export_id is null or (file_export_id<>id and state='ready'));
create index pitch_exports_reusable_package on public.pitch_exports(project_id,created_by,format,audience,delivery_revision,created_at desc)
  where state='ready' and file_export_id is null and delivery_revision is not null;

create function private.pitch_reuse_completed_package(p_actor uuid,p_session uuid,eid uuid,worker_token uuid default null) returns boolean
language plpgsql set search_path='' as $$
declare
  target public.pitch_exports;
  source public.pitch_exports;
begin
  select * into target from public.pitch_exports e
    where e.id=eid and e.created_by=p_actor and e.state='pending' and e.delivery_revision is not null;
  if not found then return false;end if;
  select * into source from public.pitch_exports e
    where e.id<>target.id and e.project_id=target.project_id and e.created_by=target.created_by
      and e.state='ready' and e.file_export_id is null
      and e.format=target.format and e.audience=target.audience and e.delivery_revision=target.delivery_revision
      and e.filename is not distinct from target.filename
      and e.slide_versions=target.slide_versions and e.authorization_snapshot=target.authorization_snapshot
    order by e.created_at desc,e.id limit 1 for share;
  if not found then return false;end if;
  if worker_token is not null then
    -- Preserve the worker's normal failure path if the document or authority
    -- changed while the receipt was queued.
    begin
      perform private.pitch_studio_access(p_actor,p_session,jsonb_build_object(
        'action','export_verify','projectId',target.project_id,'exportId',eid,
        'audience',target.audience,'workerToken',worker_token));
    exception when insufficient_privilege or unique_violation then
      return false;
    end;
  end if;

  update public.pitch_exports set file_export_id=source.id,state='ready',sha256=source.sha256,size_bytes=source.size_bytes
    where id=target.id;
  update public.pitch_jobs set state='succeeded',progress=100,updated_at=clock_timestamp() where id=target.job_id;
  insert into private.pitch_events(actor_id,session_id,action,target_id,after_value)
    values(p_actor,p_session,'export_reuse',target.id::text,jsonb_build_object('packageId',source.id));
  return true;
end $$;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_export_reuse;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  op text:=p_input->>'action';
  result jsonb;
  revision text;
  eid uuid;
  source public.pitch_exports;
begin
  result:=private.pitch_studio_access_before_export_reuse(p_actor,p_session,p_input);
  if op='export_prepare' and p_input->>'pipeline'='delivery/1'
    and result->>'state'='pending' and not (result?'replayed') then
    revision:=p_input->>'deliveryRevision';
    if revision is null then return result;end if;
    if revision !~ '^[a-zA-Z0-9._/-]{1,120}$' then raise exception 'PITCH_INVALID';end if;
    eid:=(result->>'exportId')::uuid;
    update public.pitch_exports set delivery_revision=revision where id=eid;
    if private.pitch_reuse_completed_package(p_actor,p_session,eid) then
      return result||'{"state":"ready","reused":true}'::jsonb;
    end if;
  elsif op='export_claim' and result->>'claimed'='true' then
    if private.pitch_reuse_completed_package(p_actor,p_session,(p_input->>'exportId')::uuid,(p_input->>'workerToken')::uuid) then
      return '{"claimed":false,"reused":true}'::jsonb;
    end if;
  elsif op='export_download' and result->>'file_export_id' is not null then
    select * into source from public.pitch_exports e
      where e.id=(result->>'file_export_id')::uuid and e.project_id=(result->>'project_id')::uuid
        and e.created_by=p_actor and e.state='ready' and e.file_export_id is null
        and e.format=result->>'format' and e.audience=result->>'audience' and e.sha256=result->>'sha256'
        and e.size_bytes=(result->>'size_bytes')::bigint and e.delivery_revision=result->>'delivery_revision'
        and e.slide_versions=result->'slide_versions' and e.authorization_snapshot=result->'authorization_snapshot';
    if not found then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    return result||jsonb_build_object('storage_path',source.storage_path);
  end if;
  return result;
end $$;

revoke all on function private.pitch_reuse_completed_package(uuid,uuid,uuid,uuid),
  private.pitch_studio_access_before_export_reuse(uuid,uuid,jsonb),private.pitch_studio_access(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
