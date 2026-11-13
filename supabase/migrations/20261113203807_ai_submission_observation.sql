-- Read-only Q13 foundation. No accounts granted, no feature enabled.
begin;
alter table private.ai_query_grants drop constraint ai_query_grants_capabilities_check;
alter table private.ai_query_grants add constraint ai_query_grants_capabilities_check
  check (capabilities <@ array['query:catalog','query:brochure','query:quarter','export:internal','query:submission-progress','query:submission-quality']);

create or replace function private.ai_query_submission_snapshot_read(
  p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_request_id uuid,
  p_year integer,p_quarter integer,p_quality boolean,p_submarkets text[],p_building_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; result jsonb; old_sub text; old_claims text; audit private.ai_query_audit_streams;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or a->>'access_policy' is distinct from 'admin-only/1'
    or a->>'permission_revision' is distinct from p_permission_revision
    or not (a->'capabilities' ? 'query:submission-progress')
    or (p_quality and not (a->'capabilities' ? 'query:submission-quality')) then
    raise exception using errcode='42501',message='QUERY_DENIED'; end if;
  select * into audit from private.ai_query_audit_streams where request_id=p_request_id
    and actor_id=p_actor and effective_user_id=p_effective and identity_valid and state='running' for share;
  if not found or not private.ai_query_audit_verify(audit.request_id,audit.head_hash,audit.head_sequence) then
    raise exception using errcode='42501',message='QUERY_AUDIT_REQUIRED'; end if;
  if p_quality is null or (p_year is null)<>(p_quarter is null)
    or (p_year is not null and (p_year not between 1900 and 2200 or p_quarter not between 1 and 4))
    or p_submarkets is not null and (cardinality(p_submarkets) not between 1 and 30 or array_position(p_submarkets,null) is not null)
    or p_building_ids is not null and (cardinality(p_building_ids) not between 1 and 500 or array_position(p_building_ids,null) is not null)
    or exists(select 1 from unnest(p_submarkets) v where length(btrim(v)) not between 1 and 80) then
    raise exception using errcode='22023',message='INVALID_SUBMISSION_QUERY'; end if;
  if (p_submarkets is not null and not (a->>'all_submarkets')::boolean and not (to_jsonb(p_submarkets)<@(a->'submarkets')))
    or (p_building_ids is not null and not (a->>'all_buildings')::boolean and not (to_jsonb(p_building_ids)<@(a->'building_ids'))) then
    raise exception using errcode='42501',message='QUERY_DENIED'; end if;
  old_sub:=current_setting('request.jwt.claim.sub',true);old_claims:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub',p_effective::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_effective,'role','authenticated')::text,true);
  -- All period settings, inventory, assignments and submissions use ONE statement snapshot.
  with settings as materialized (
    select key,value,updated_at from public.app_settings where key in ('current_submission_year','current_submission_quarter')
  ), configured as (
    select case when max(value) filter(where key='current_submission_year') ~ '^[0-9]{4}$'
      then (max(value) filter(where key='current_submission_year'))::integer end y,
      case when max(value) filter(where key='current_submission_quarter') ~ '^[1-4]$'
      then (max(value) filter(where key='current_submission_quarter'))::integer end q from settings
  ), period as (
    select coalesce(p_year,case when y between 1900 and 2200 then y end) y,coalesce(p_quarter,q) q,
      case when y between 1900 and 2200 and q between 1 and 4 then jsonb_build_object('year',y,'quarter',q) else null end configured from configured
  ), inventory as materialized (
    select b.id,b.name,b.submarket,b.grade from public.buildings b
    where b.is_active and b.tracking_scope='tracked' and b.project_type='stock' and b.merged_into_id is null
      and private.map_building_visible(b.id)
      and ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket)
      and ((a->>'all_buildings')::boolean or a->'building_ids' ? b.id::text)
      and (p_submarkets is null or b.submarket=any(p_submarkets)) and (p_building_ids is null or b.id=any(p_building_ids))
  ), assignments as materialized (
    select t.id,t.building_id,t.user_id,t.user_name,t.created_at from public.building_assignments t join inventory b on b.id=t.building_id
  ), submissions as materialized (
    select t.id,t.building_id,t.user_id,t.user_name,t.record_year,t.record_quarter,t.created_at,t.updated_at,
      case when p_quality then jsonb_build_object('total_area',t.total_area::text,'vacant_area',t.vacant_area::text,
        'vacancy_rate',t.vacancy_rate::text,'asking_rent',t.asking_rent::text,'management_fee',t.management_fee::text,
        'face_rent',t.face_rent::text,'rent_free_period',t.rent_free_period::text,'net_effective_rent',t.net_effective_rent::text)
        else '{}'::jsonb end vals
    from public.quarterly_submissions t join inventory b on b.id=t.building_id cross join period p
    where t.record_year=p.y and t.record_quarter=p.q
  ), counts as (
    select (select count(*) from inventory) nb,(select count(*) from assignments) na,(select count(*) from submissions) ns
  ) select jsonb_build_object('policy','quarterly-submission-observation/1','snapshotId',gen_random_uuid(),
    'databaseSnapshot',pg_current_snapshot()::text,'readAt',clock_timestamp(),'requestId',p_request_id,
    'period',jsonb_build_object('year',p.y,'quarter',p.q),'configuredPeriod',p.configured,
    'periodBasis',case when p_year is null then 'configured' else 'explicit' end,'quality',p_quality,
    'inventory','current_active_tracked_stock','assignmentsTime','current',
    'complete',c.nb<=20000 and c.na<=100000 and c.ns<=100000,
    'expected',jsonb_build_object('buildings',c.nb,'assignments',c.na,'submissions',c.ns),
    'settings',coalesce((select jsonb_agg(jsonb_build_object('key',key,'value',value,'updatedAt',updated_at,
      'version',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) order by key) from settings t),'[]'),
    'buildings',case when c.nb<=20000 then coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object(
      'version',encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex')) order by b.id) from inventory b),'[]') else '[]'::jsonb end,
    'assignments',case when c.na<=100000 then coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'buildingId',t.building_id,'userId',t.user_id,
      'userName',t.user_name,'createdAt',t.created_at,'version',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) order by t.id) from assignments t),'[]') else '[]'::jsonb end,
    'submissions',case when c.ns<=100000 then coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'buildingId',t.building_id,'userId',t.user_id,'userName',t.user_name,
      'year',t.record_year,'quarter',t.record_quarter,'createdAt',t.created_at,'updatedAt',t.updated_at,'values',t.vals,
      'version',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) order by t.id) from submissions t),'[]') else '[]'::jsonb end
    ) into result from period p cross join counts c;
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  if result->'period'->>'year' is null or result->'period'->>'quarter' is null then
    raise exception using errcode='22023',message='SUBMISSION_PERIOD_UNAVAILABLE'; end if;
  if (result->>'complete')::boolean is not true or octet_length(result::text)>16*1024*1024 then
    raise exception using errcode='54000',message='QUERY_SCOPE_REQUIRES_BACKGROUND_JOB'; end if;
  return result;
end $$;
create or replace function public.ai_query_submission_snapshot_read(
  p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_request_id uuid,
  p_year integer,p_quarter integer,p_quality boolean,p_submarkets text[],p_building_ids uuid[]
) returns jsonb language sql security invoker set search_path='' as $$
  select private.ai_query_submission_snapshot_read(p_actor,p_effective,p_session,p_permission_revision,p_request_id,p_year,p_quarter,p_quality,p_submarkets,p_building_ids)
$$;
revoke all on function private.ai_query_submission_snapshot_read(uuid,uuid,uuid,text,uuid,integer,integer,boolean,text[],uuid[]),
  public.ai_query_submission_snapshot_read(uuid,uuid,uuid,text,uuid,integer,integer,boolean,text[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_submission_snapshot_read(uuid,uuid,uuid,text,uuid,integer,integer,boolean,text[],uuid[]),
  public.ai_query_submission_snapshot_read(uuid,uuid,uuid,text,uuid,integer,integer,boolean,text[],uuid[]) to service_role;
commit;
