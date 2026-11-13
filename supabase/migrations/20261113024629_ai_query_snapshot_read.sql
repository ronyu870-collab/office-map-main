begin;
create function private.ai_query_snapshot_read(
  p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,
  p_fields text[],p_periods jsonb,p_inventory text,p_submarkets text[],p_building_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; result jsonb; old_sub text; old_claims text;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or a->>'permission_revision' is distinct from p_permission_revision
    then raise exception using errcode='42501',message='QUERY_DENIED'; end if;
  if p_fields is null or cardinality(p_fields)>6 or array_position(p_fields,null) is not null
    or not (p_fields <@ array['height','floors','parking','totalArea','vacantArea','netEffectiveRent'])
    or p_inventory is null or p_inventory not in ('tracked','all_authorized')
    or coalesce(cardinality(p_submarkets),0)>30 or coalesce(cardinality(p_building_ids),0)>500
    or array_position(p_submarkets,null) is not null or array_position(p_building_ids,null) is not null
    or jsonb_typeof(p_periods) is distinct from 'array' or jsonb_array_length(p_periods)>40
    then raise exception using errcode='22023',message='INVALID_QUERY_SCOPE'; end if;
  if not (to_jsonb(p_fields) <@ (a->'fields'))
    or (p_fields && array['height','floors','parking'] and not (a->'capabilities' ? 'query:brochure'))
    or (p_fields && array['totalArea','vacantArea','netEffectiveRent'] and not (a->'capabilities' ? 'query:quarter'))
    or (p_submarkets is not null and not (a->>'all_submarkets')::boolean and not (to_jsonb(p_submarkets)<@(a->'submarkets')))
    or (p_building_ids is not null and not (a->>'all_buildings')::boolean and not (to_jsonb(p_building_ids)<@(a->'building_ids')))
    then raise exception using errcode='42501',message='QUERY_DENIED'; end if;
  if exists(select 1 from jsonb_array_elements(p_periods) x where jsonb_typeof(x)<>'object' or x-array['year','quarter']<>'{}'::jsonb)
    or exists(select 1 from jsonb_to_recordset(p_periods) as p(year integer,quarter integer) where year is null or year not between 1900 and 2200 or quarter is null or quarter not between 1 and 4)
    or (select count(*)<>count(distinct (year,quarter)) from jsonb_to_recordset(p_periods) as p(year integer,quarter integer))
    or (p_fields && array['totalArea','vacantArea','netEffectiveRent'] and jsonb_array_length(p_periods)=0)
    then raise exception using errcode='22023',message='INVALID_QUERY_PERIOD'; end if;
  -- Invoke the same protected row predicate used by map RLS under the verified
  -- effective identity. Restore claims before returning; callers are service-only.
  old_sub:=current_setting('request.jwt.claim.sub',true);old_claims:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub',p_effective::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_effective,'role','authenticated')::text,true);
  with inventory as materialized (
    select b.id,b.name,b.submarket,b.grade,b.is_active,b.tracking_scope
    from public.buildings b
    where b.merged_into_id is null and private.map_building_visible(b.id)
      and (p_inventory='all_authorized' or (b.is_active and b.tracking_scope='tracked'))
      and ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket)
      and ((a->>'all_buildings')::boolean or a->'building_ids' ? b.id::text)
      and (p_submarkets is null or b.submarket=any(p_submarkets))
      and (p_building_ids is null or b.id=any(p_building_ids))
  ), total as (select count(*) n from inventory), records as (
    select jsonb_build_object('id',b.id,'name',b.name,'submarket',b.submarket,'grade',b.grade,'is_active',b.is_active,'tracking_scope',b.tracking_scope,
      'version',encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex'),
      'metrics',coalesce((
        select jsonb_agg(jsonb_build_object('id',m.id::text,'year',m.record_year,'quarter',m.record_quarter,'recorded_at',m.updated_at,
          'version',encode(sha256(convert_to(jsonb_build_array(m.id,m.record_year,m.record_quarter,m.updated_at,
            (select jsonb_object_agg(f,case f when 'totalArea' then m.total_area::text when 'vacantArea' then m.vacant_area::text when 'netEffectiveRent' then m.net_effective_rent::text end) from unnest(p_fields) f where f in ('totalArea','vacantArea','netEffectiveRent')))::text,'UTF8')),'hex'),
          'values',(select jsonb_object_agg(f,case f when 'totalArea' then m.total_area::text when 'vacantArea' then m.vacant_area::text when 'netEffectiveRent' then m.net_effective_rent::text end)
            from unnest(p_fields) f where f in ('totalArea','vacantArea','netEffectiveRent'))) order by m.record_year,m.record_quarter,m.id)
        from public.building_metrics m where m.building_id=b.id and m.is_draft is not true
          and p_fields && array['totalArea','vacantArea','netEffectiveRent']
          and exists(select 1 from jsonb_to_recordset(p_periods) as p(year integer,quarter integer) where p.year=m.record_year and p.quarter=m.record_quarter)
      ),'[]'::jsonb),
      'brochures',coalesce((
        select jsonb_agg(jsonb_build_object('id',d.id::text,'recorded_at',d.updated_at,
          'version',encode(sha256(convert_to(jsonb_build_array(d.id,d.updated_at,
            (select jsonb_object_agg(f,case f when 'height' then d.building_height::text when 'floors' then d.building_floors::text when 'parking' then d.parking_total::text end) from unnest(p_fields) f where f in ('height','floors','parking')))::text,'UTF8')),'hex'),
          'values',(select jsonb_object_agg(f,case f when 'height' then d.building_height::text when 'floors' then d.building_floors::text when 'parking' then d.parking_total::text end)
            from unnest(p_fields) f where f in ('height','floors','parking'))) order by d.id)
        from public.building_brochure_data d where d.building_id=b.id and p_fields && array['height','floors','parking']
      ),'[]'::jsonb)) body
    from inventory b cross join total where total.n<=20000
  ) select jsonb_build_object('snapshot_id',gen_random_uuid(),'database_snapshot',pg_current_snapshot()::text,'read_at',clock_timestamp(),
    'expected_count',total.n,'complete',total.n<=20000,'periods',p_periods,'fields',p_fields,
    'inventory_time','current_catalog','brochure_selection','all_unresolved_record_candidates',
    'rows',coalesce((select jsonb_agg(body order by body->>'id') from records),'[]'::jsonb)) into result from total;
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  if (result->>'complete')::boolean is not true then raise exception using errcode='54000',message='QUERY_SCOPE_REQUIRES_BACKGROUND_JOB'; end if;
  return result;
end $$;

create function public.ai_query_snapshot_read(p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_fields text[],p_periods jsonb,p_inventory text,p_submarkets text[],p_building_ids uuid[])
returns jsonb language sql security invoker set search_path='' as $$
  select private.ai_query_snapshot_read(p_actor,p_effective,p_session,p_permission_revision,p_fields,p_periods,p_inventory,p_submarkets,p_building_ids)
$$;
revoke all on function private.ai_query_snapshot_read(uuid,uuid,uuid,text,text[],jsonb,text,text[],uuid[]),public.ai_query_snapshot_read(uuid,uuid,uuid,text,text[],jsonb,text,text[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_snapshot_read(uuid,uuid,uuid,text,text[],jsonb,text,text[],uuid[]),public.ai_query_snapshot_read(uuid,uuid,uuid,text,text[],jsonb,text,text[],uuid[]) to service_role;
commit;
