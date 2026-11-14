-- Isolated-source lease reads. No enablement, defaults or real-person grants.
begin;
alter table private.ai_query_grants
  add column all_lease_records boolean not null default false,
  add column lease_record_ids text[] not null default '{}',
  add column lease_sources text[] not null default '{}',
  add column lease_fields text[] not null default '{}',
  add constraint ai_query_grants_lease_scope_check check (
    array_position(lease_record_ids,null) is null and array_position(lease_sources,null) is null
    and array_position(lease_fields,null) is null and lease_sources <@ array['live','history']
    and lease_fields <@ array['area_sqm','face_rent','effective_rent','lease_term_months','industry','sub_industry','demand_type','source_evidence']);
alter table private.ai_query_grants drop constraint ai_query_grants_capabilities_check;
alter table private.ai_query_grants add constraint ai_query_grants_capabilities_check check(capabilities <@ array[
  'query:catalog','query:brochure','query:quarter','export:internal','query:submission-progress','query:submission-quality',
  'query:future-catalog','query:future-progress','query:future-quality','query:leases']);

create or replace function private.ai_query_lease_authority(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb; g private.ai_query_grants;
begin
  a:=private.ai_query_principal(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or not(a->'capabilities' ? 'query:leases')
    or (not(a->>'all_submarkets')::boolean and jsonb_array_length(a->'submarkets')=0)
    then return jsonb_build_object('allowed',false);end if;
  -- The principal already locks and requires the current admin's own grant row.
  select * into g from private.ai_query_grants where user_id=p_actor;
  if cardinality(g.lease_sources)=0 or (not g.all_lease_records and cardinality(g.lease_record_ids)=0)
    then return jsonb_build_object('allowed',false);end if;
  return (a-'all_buildings'-'building_ids'-'all_future_supplies'-'future_supply_ids') || jsonb_build_object(
    'lease_policy','lease-observation/1','all_lease_records',g.all_lease_records,'lease_record_ids',g.lease_record_ids,
    'lease_sources',g.lease_sources,'lease_fields',g.lease_fields);
end $$;
create or replace function public.ai_query_lease_authority(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_query_lease_authority(p_actor,p_effective,p_session) $$;
revoke all on function private.ai_query_lease_authority(uuid,uuid,uuid),public.ai_query_lease_authority(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_lease_authority(uuid,uuid,uuid),public.ai_query_lease_authority(uuid,uuid,uuid) to service_role;

create or replace function private.ai_query_lease_snapshot_read(
  p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_request_id uuid,
  p_sources text[],p_fields text[],p_submarkets text[],p_record_ids text[],p_company text,p_building_id uuid,p_building_scope text
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; result jsonb; audit private.ai_query_audit_streams;
begin
  a:=private.ai_query_lease_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or a->>'access_policy' is distinct from 'admin-only/1'
    or a->>'permission_revision' is distinct from p_permission_revision then raise exception using errcode='42501',message='QUERY_DENIED';end if;
  select * into audit from private.ai_query_audit_streams where request_id=p_request_id and actor_id=p_actor
    and effective_user_id=p_effective and identity_valid and state='running' for share;
  if not found or not private.ai_query_audit_verify(audit.request_id,audit.head_hash,audit.head_sequence)
    then raise exception using errcode='42501',message='QUERY_AUDIT_REQUIRED';end if;
  if p_sources is null or cardinality(p_sources) not between 1 and 2 or array_position(p_sources,null) is not null
    or not(p_sources <@ array['live','history'])
    or p_fields is null or cardinality(p_fields)>8 or array_position(p_fields,null) is not null
    or not(p_fields <@ array['area_sqm','face_rent','effective_rent','lease_term_months','industry','sub_industry','demand_type','source_evidence'])
    or p_submarkets is not null and (cardinality(p_submarkets) not between 1 and 30 or array_position(p_submarkets,null) is not null)
    or exists(select 1 from unnest(p_submarkets) v where length(btrim(v)) not between 1 and 80)
    or p_record_ids is not null and (cardinality(p_record_ids) not between 1 and 500 or array_position(p_record_ids,null) is not null)
    or exists(select 1 from unnest(p_record_ids) v where length(v) not between 6 and 512 or v !~ '^(live|history):.' or v ~ '[[:cntrl:]]')
    or p_company is not null and (length(btrim(p_company)) not between 1 and 200 or p_company ~ '[[:cntrl:]]')
    or (p_building_id is null)<>(p_building_scope is null)
    or p_building_scope is not null and p_building_scope not in ('tower','project','related')
    then raise exception using errcode='22023',message='INVALID_LEASE_QUERY';end if;
  if not(to_jsonb(p_sources)<@(a->'lease_sources')) or not(to_jsonb(p_fields)<@(a->'lease_fields'))
    or p_submarkets is not null and not(a->>'all_submarkets')::boolean and not(to_jsonb(p_submarkets)<@(a->'submarkets'))
    or p_record_ids is not null and not(a->>'all_lease_records')::boolean and not(to_jsonb(p_record_ids)<@(a->'lease_record_ids'))
    then raise exception using errcode='42501',message='QUERY_DENIED';end if;
  -- Reuse the governed view, preserving exact/reference/project/unmapped and
  -- record-level overrides. Never unnest related IDs into duplicate deal rows.
  with records as materialized (
    select jsonb_build_object(
      'id',v.read_id,'source',v.record_source,'sourceRecordId',v.source_record_id,'sourceUid',v.source_uid,
      'company',v.company,'buildingName',v.new_building,'submarket',v.sub_market,'buildingId',v.building_id,
      'buildingScope',v.building_match_scope,'relatedBuildingIds',v.related_building_ids,
      'date',v.transaction_date,'year',v.transaction_year,'quarter',v.transaction_quarter,
      'precision',v.transaction_time_precision,'periodStart',v.transaction_period_start,'periodEnd',v.transaction_period_end,
      'periodSource',v.period_source,'quality',v.quality_status,'createdAt',v.created_at,
      'values',
        case when 'area_sqm'=any(p_fields) then jsonb_build_object('area_sqm',v.area_sqm::text) else '{}'::jsonb end ||
        case when 'face_rent'=any(p_fields) then jsonb_build_object('face_rent',v.face_rent::text) else '{}'::jsonb end ||
        case when 'effective_rent'=any(p_fields) then jsonb_build_object('effective_rent',v.effective_rent::text) else '{}'::jsonb end ||
        case when 'lease_term_months'=any(p_fields) then jsonb_build_object('lease_term_months',v.lease_term_months::text) else '{}'::jsonb end ||
        case when 'industry'=any(p_fields) then jsonb_build_object('industry',v.industry) else '{}'::jsonb end ||
        case when 'sub_industry'=any(p_fields) then jsonb_build_object('sub_industry',v.sub_industry) else '{}'::jsonb end ||
        case when 'demand_type'=any(p_fields) then jsonb_build_object('demand_type',v.demand_type) else '{}'::jsonb end,
      'estimates',
        case when 'face_rent'=any(p_fields) then jsonb_build_object('face_rent',case when v.record_source='live' then l.is_face_rent_estimated::text else null::text end) else '{}'::jsonb end ||
        case when 'effective_rent'=any(p_fields) then jsonb_build_object('effective_rent',case when v.record_source='live' then l.is_effective_rent_estimated::text else null::text end) else '{}'::jsonb end,
      'termRaw',case when 'lease_term_months'=any(p_fields) and v.record_source='history' then h.source_lease_term_raw else null end,
      'evidence',case when 'source_evidence'=any(p_fields) and v.record_source='history' then
        jsonb_build_object('file',h.source_file,'sheet',h.source_sheet,'row',h.source_row) else null end
    ) body
    from public.lease_transactions_read_v1 v
    left join public.lease_transactions l on v.record_source='live' and l.id=v.source_record_id
    left join public.lease_transactions_history h on v.record_source='history' and h.id=v.source_record_id
    where v.record_source=any(p_sources)
      and ((a->>'all_submarkets')::boolean or a->'submarkets' ? v.sub_market)
      and ((a->>'all_lease_records')::boolean or a->'lease_record_ids' ? v.read_id)
      and (p_submarkets is null or v.sub_market=any(p_submarkets))
      and (p_record_ids is null or v.read_id=any(p_record_ids))
      and (p_company is null or lower(btrim(v.company))=lower(btrim(p_company)))
      and (p_building_id is null or case p_building_scope
        when 'tower' then v.building_id=p_building_id and v.building_match_scope in ('exact','reference')
        when 'project' then v.building_match_scope='project' and p_building_id=any(v.related_building_ids)
        when 'related' then p_building_id=any(v.related_building_ids) else false end)
  ), counts as (select count(*) n,count(distinct body->>'id') unique_ids,
      count(distinct (body->>'source',body->>'sourceRecordId')) unique_sources from records)
  select jsonb_build_object('policy','lease-observation/1','snapshotId',gen_random_uuid(),'requestId',p_request_id,
    'databaseSnapshot',pg_current_snapshot()::text,'readAt',clock_timestamp(),'complete',n<=20000,
    'expected',n,'uniqueIds',unique_ids,'uniqueSources',unique_sources,
    'sources',to_jsonb(p_sources),'fields',to_jsonb(p_fields),
    'records',case when n<=20000 then coalesce((select jsonb_agg(body||jsonb_build_object('version',encode(sha256(convert_to(body::text,'UTF8')),'hex')) order by body->>'id') from records),'[]') else '[]'::jsonb end
  ) into result from counts;
  if (result->>'expected')::bigint<>(result->>'uniqueIds')::bigint or (result->>'expected')::bigint<>(result->>'uniqueSources')::bigint
    then raise exception using errcode='22023',message='DUPLICATE_LEASE_IDENTITY';end if;
  if (result->>'complete')::boolean is not true or octet_length(result::text)>16*1024*1024
    then raise exception using errcode='54000',message='QUERY_SCOPE_REQUIRES_BACKGROUND_JOB';end if;
  return result;
end $$;
create or replace function public.ai_query_lease_snapshot_read(
  p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_request_id uuid,
  p_sources text[],p_fields text[],p_submarkets text[],p_record_ids text[],p_company text,p_building_id uuid,p_building_scope text
) returns jsonb language sql security invoker set search_path='' as $$
  select private.ai_query_lease_snapshot_read(p_actor,p_effective,p_session,p_permission_revision,p_request_id,
    p_sources,p_fields,p_submarkets,p_record_ids,p_company,p_building_id,p_building_scope)
$$;
revoke all on function private.ai_query_lease_snapshot_read(uuid,uuid,uuid,text,uuid,text[],text[],text[],text[],text,uuid,text),
  public.ai_query_lease_snapshot_read(uuid,uuid,uuid,text,uuid,text[],text[],text[],text[],text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_lease_snapshot_read(uuid,uuid,uuid,text,uuid,text[],text[],text[],text[],text,uuid,text),
  public.ai_query_lease_snapshot_read(uuid,uuid,uuid,text,uuid,text[],text[],text[],text[],text,uuid,text) to service_role;
commit;
