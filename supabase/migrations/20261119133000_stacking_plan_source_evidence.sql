-- Stacking Plan P0: private, traceable original-file evidence.
-- The source's original business date and per-space verification state are NOT changed.
-- Storage bucket provisioning is done through the Storage API (not DML against storage schema).
begin;

alter table public.stacking_plan_sources
  add column if not exists evidence_storage_path text,
  add column if not exists evidence_filename text,
  add column if not exists evidence_mime text,
  add column if not exists evidence_size_bytes integer,
  add column if not exists evidence_sha256 text,
  add column if not exists evidence_uploaded_at timestamptz,
  add column if not exists evidence_uploaded_by uuid;

create table if not exists public.stacking_plan_source_events (
  id bigint generated always as identity primary key,
  source_id text not null references public.stacking_plan_sources(id) on delete restrict,
  actor_id uuid not null,
  action text not null check (action in ('attach_original')),
  before_record jsonb not null,
  after_record jsonb not null,
  recorded_at timestamptz not null default now()
);

alter table public.stacking_plan_source_events enable row level security;
revoke all on public.stacking_plan_source_events from public, anon, authenticated;
grant all on public.stacking_plan_source_events to service_role;
revoke all on sequence public.stacking_plan_source_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.stacking_plan_source_events_id_seq to service_role;

-- SECURITY DEFINER is scoped to the unexposed private schema; the public wrapper is invoker-only.
create or replace function private.stacking_plan_attach_source_original(
  p_building_id uuid,
  p_source_id text,
  p_actor uuid,
  p_path text,
  p_name text,
  p_mime text,
  p_size integer,
  p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  old_row public.stacking_plan_sources%rowtype;
  new_row public.stacking_plan_sources%rowtype;
begin
  if not exists(
    select 1 from public.user_roles r join auth.users a on a.id=r.user_id
    where r.user_id=p_actor and r.role='admin'
  ) then
    raise exception 'ADMIN_DENIED' using errcode='42501';
  end if;
  if p_size is null or p_size < 1 or p_size > 4194304
    or length(coalesce(p_name,'')) not between 1 and 200
    or p_mime not in (
      'image/png','image/jpeg','image/webp','application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or left(coalesce(p_path,''),length(p_building_id::text || '/' || p_source_id || '/'))
      <> (p_building_id::text || '/' || p_source_id || '/')
  then
    raise exception 'INVALID_EVIDENCE' using errcode='22023';
  end if;

  select * into old_row from public.stacking_plan_sources
    where id=p_source_id and building_id=p_building_id for update;
  if not found then
    raise exception 'SOURCE_NOT_FOUND' using errcode='P0002';
  end if;
  if old_row.evidence_sha256 is not distinct from p_sha256
     and old_row.evidence_storage_path is not distinct from p_path then
    return to_jsonb(old_row); -- replay-safe, no duplicate audit
  end if;
  update public.stacking_plan_sources set
    evidence_storage_path=p_path,
    evidence_filename=p_name,
    evidence_mime=p_mime,
    evidence_size_bytes=p_size,
    evidence_sha256=p_sha256,
    evidence_uploaded_at=now(),
    evidence_uploaded_by=p_actor
  where id=p_source_id returning * into new_row;
  insert into public.stacking_plan_source_events(source_id,actor_id,action,before_record,after_record)
  values (p_source_id,p_actor,'attach_original',to_jsonb(old_row),to_jsonb(new_row));
  return to_jsonb(new_row);
end $fn$;

revoke all on function private.stacking_plan_attach_source_original(uuid,text,uuid,text,text,text,integer,text)
  from public,anon,authenticated;
grant execute on function private.stacking_plan_attach_source_original(uuid,text,uuid,text,text,text,integer,text)
  to service_role;

create or replace function public.stacking_plan_source_attach(
  p_building_id uuid,
  p_source_id text,
  p_actor uuid,
  p_path text,
  p_name text,
  p_mime text,
  p_size integer,
  p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $sql$
  select private.stacking_plan_attach_source_original(
    p_building_id,p_source_id,p_actor,p_path,p_name,p_mime,p_size,p_sha256
  )
$sql$;
revoke all on function public.stacking_plan_source_attach(uuid,text,uuid,text,text,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.stacking_plan_source_attach(uuid,text,uuid,text,text,integer,text)
  to service_role;
commit;
