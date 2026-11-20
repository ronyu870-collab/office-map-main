-- Colliers AI 5.0 P0. Read-only AI source correction; no business-data writes or RLS changes.
begin;

create or replace function private.ai_query_snapshot_read(
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
        from public.building_metrics m where m.building_id=b.id and m.is_draft is not true and m.is_locked is true
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


create or replace function private.ai_query_available_periods(
  p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,
  p_fields text[],p_inventory text,p_submarkets text[],p_building_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare a jsonb; result jsonb; old_sub text; old_claims text;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or a->>'permission_revision' is distinct from p_permission_revision
    or not (a->'capabilities' ? 'query:quarter') then
    raise exception using errcode='42501',message='QUERY_DENIED';
  end if;
  if p_fields is null or cardinality(p_fields) not between 1 and 3 or array_position(p_fields,null) is not null
    or not (p_fields <@ array['totalArea','vacantArea','netEffectiveRent'])
    or p_inventory is null or p_inventory not in ('tracked','all_authorized')
    or coalesce(cardinality(p_submarkets),0)>30 or coalesce(cardinality(p_building_ids),0)>500
    or array_position(p_submarkets,null) is not null or array_position(p_building_ids,null) is not null then
    raise exception using errcode='22023',message='INVALID_QUERY_SCOPE';
  end if;
  if not (to_jsonb(p_fields)<@(a->'fields'))
    or (p_submarkets is not null and not (a->>'all_submarkets')::boolean and not (to_jsonb(p_submarkets)<@(a->'submarkets')))
    or (p_building_ids is not null and not (a->>'all_buildings')::boolean and not (to_jsonb(p_building_ids)<@(a->'building_ids'))) then
    raise exception using errcode='42501',message='QUERY_DENIED';
  end if;
  old_sub:=current_setting('request.jwt.claim.sub',true);old_claims:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub',p_effective::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_effective,'role','authenticated')::text,true);
  with periods as materialized (
    select distinct m.record_year as year,m.record_quarter as quarter
    from public.buildings b join public.building_metrics m on m.building_id=b.id
    where b.merged_into_id is null and private.map_building_visible(b.id)
      and (p_inventory='all_authorized' or (b.is_active and b.tracking_scope='tracked'))
      and ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket)
      and ((a->>'all_buildings')::boolean or a->'building_ids' ? b.id::text)
      and (p_submarkets is null or b.submarket=any(p_submarkets))
      and (p_building_ids is null or b.id=any(p_building_ids))
      and m.is_draft is not true and m.is_locked is true and m.record_year between 1900 and 2200 and m.record_quarter between 1 and 4
      and (not ('totalArea'=any(p_fields)) or (m.total_area>0 and m.total_area<'Infinity'::float8))
      and (not ('netEffectiveRent'=any(p_fields)) or (m.net_effective_rent>0 and m.net_effective_rent<'Infinity'::float8))
      and (not ('vacantArea'=any(p_fields)) or (m.vacant_area>=0 and m.vacant_area<'Infinity'::float8
        and (not ('totalArea'=any(p_fields)) or m.vacant_area<=m.total_area)))
  ), bounded as (select * from periods order by year desc,quarter desc limit 40)
  select jsonb_build_object('version','authorized-periods/1','permission_revision',p_permission_revision,
    'read_at',clock_timestamp(),'inventory_time','current_catalog','fields',p_fields,
    'truncated',(select count(*)>40 from periods),
    'periods',coalesce((select jsonb_agg(jsonb_build_object('year',year,'quarter',quarter) order by year,quarter) from bounded),'[]'::jsonb)) into result;
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  return result;
end $$;



-- Distinct, scope-limited counts only. Unreviewed submissions are never used as metric facts.
create function private.ai_query_quarterly_coverage(
  p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,
  p_fields text[],p_year integer,p_quarter integer,p_inventory text,p_submarkets text[],p_building_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare a jsonb; result jsonb; old_sub text; old_claims text;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true'
    or a->>'permission_revision' is distinct from p_permission_revision
    or not (a->'capabilities' ? 'query:quarter') then
    raise exception using errcode='42501',message='QUERY_DENIED';
  end if;
  if p_year not between 1900 and 2200 or p_quarter not between 1 and 4
    or p_fields is null or cardinality(p_fields) not between 1 and 3
    or array_position(p_fields,null) is not null
    or not (p_fields <@ array['totalArea','vacantArea','netEffectiveRent'])
    or p_inventory is null or p_inventory not in ('tracked','all_authorized')
    or coalesce(cardinality(p_submarkets),0)>30 or coalesce(cardinality(p_building_ids),0)>500
    or array_position(p_submarkets,null) is not null
    or array_position(p_building_ids,null) is not null then
    raise exception using errcode='22023',message='INVALID_QUERY_SCOPE';
  end if;
  if not (to_jsonb(p_fields)<@(a->'fields'))
    or (p_submarkets is not null and not (a->>'all_submarkets')::boolean
      and not (to_jsonb(p_submarkets)<@(a->'submarkets')))
    or (p_building_ids is not null and not (a->>'all_buildings')::boolean
      and not (to_jsonb(p_building_ids)<@(a->'building_ids'))) then
    raise exception using errcode='42501',message='QUERY_DENIED';
  end if;
  old_sub:=current_setting('request.jwt.claim.sub',true);
  old_claims:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub',p_effective::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_effective,'role','authenticated')::text,true);

  with inventory as materialized (
    select b.id from public.buildings b
    where b.merged_into_id is null and private.map_building_visible(b.id)
      and (p_inventory='all_authorized' or (b.is_active and b.tracking_scope='tracked'))
      and ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket)
      and ((a->>'all_buildings')::boolean or a->'building_ids' ? b.id::text)
      and (p_submarkets is null or b.submarket=any(p_submarkets))
      and (p_building_ids is null or b.id=any(p_building_ids))
  ), metrics as materialized (
    select m.building_id,m.total_area,m.vacant_area,m.net_effective_rent,m.is_locked,m.is_draft,
      m.locked_at,m.locked_by,
      (m.is_locked is true and m.is_draft is not true) as formal,
      (m.total_area>0 and m.total_area<'Infinity'::float8) as area_valid,
      (m.net_effective_rent>0 and m.net_effective_rent<'Infinity'::float8) as rent_valid,
      (m.vacant_area>=0 and m.vacant_area<'Infinity'::float8
        and m.total_area>0 and m.total_area<'Infinity'::float8 and m.vacant_area<=m.total_area) as vacant_valid
    from public.building_metrics m join inventory i on i.id=m.building_id
    where m.record_year=p_year and m.record_quarter=p_quarter
  ), submissions as materialized (
    select s.id,s.building_id,s.total_area,s.vacant_area,s.net_effective_rent,s.created_at,
      row_number() over(partition by s.building_id
        order by s.created_at desc nulls last,s.updated_at desc nulls last,s.id desc) as rn
    from public.quarterly_submissions s join inventory i on i.id=s.building_id
    where s.record_year=p_year and s.record_quarter=p_quarter
  ), measured as (
    select count(*) as metric_rows,
      count(distinct building_id) filter(where formal) as formal_buildings,
      count(distinct building_id) filter(where formal
        and (not ('totalArea'=any(p_fields)) or area_valid)
        and (not ('netEffectiveRent'=any(p_fields)) or rent_valid)
        and (not ('vacantArea'=any(p_fields)) or vacant_valid)) as formal_valid_buildings,
      count(*) filter(where is_draft is true) as draft_rows,
      count(*) filter(where is_locked is not true and is_draft is not true) as unlocked_rows,
      count(*) filter(where formal and (locked_at is null or locked_by is null)) as incomplete_lock_evidence,
      count(*) filter(where is_locked is true and is_draft is true) as locked_draft_conflicts,
      count(*) - count(distinct building_id) as duplicate_metric_rows
    from metrics
  ), submitted as (
    select count(*) as submission_rows,count(distinct building_id) as submission_buildings,
      count(*) filter(where rn=1) as latest_rows,
      count(*) filter(where rn>1) as superseded_rows,
      case when 'totalArea'=any(p_fields) or 'vacantArea'=any(p_fields)
        then count(*) filter(where rn=1 and total_area=0) else null end as zero_area_latest,
      case when 'netEffectiveRent'=any(p_fields)
        then count(*) filter(where rn=1 and net_effective_rent is null) else null end as missing_rent_latest,
      count(*) filter(where rn=1
        and (not ('totalArea'=any(p_fields)) or total_area>0)
        and (not ('netEffectiveRent'=any(p_fields)) or net_effective_rent>0)
        and (not ('vacantArea'=any(p_fields)) or (vacant_area>=0 and total_area>0 and vacant_area<=total_area)))
        as latest_field_complete,
      count(*) filter(where created_at < (make_date(p_year,1,1)+(p_quarter-1)*interval '3 months') at time zone 'Asia/Shanghai'
        or created_at >= (make_date(p_year,1,1)+p_quarter*interval '3 months') at time zone 'Asia/Shanghai')
        as submitted_outside_calendar_quarter
    from submissions
  ), overlapping as (
    select count(distinct s.building_id) as overlapping_buildings,
      count(distinct s.building_id) filter(where
        (('totalArea'=any(p_fields) or 'vacantArea'=any(p_fields)) and s.total_area is not null
          and m.total_area is not null and s.total_area is distinct from m.total_area)
        or ('vacantArea'=any(p_fields) and s.vacant_area is not null
          and m.vacant_area is not null and s.vacant_area is distinct from m.vacant_area)
        or ('netEffectiveRent'=any(p_fields) and s.net_effective_rent is not null and m.net_effective_rent is not null
          and s.net_effective_rent is distinct from m.net_effective_rent)) as conflicting_values
    from submissions s join metrics m on m.building_id=s.building_id and m.formal
    where s.rn=1
  )
  select jsonb_build_object(
    'version','quarterly-source-coverage/1','permission_revision',p_permission_revision,
    'year',p_year,'quarter',p_quarter,'fields',p_fields,'read_at',clock_timestamp(),
    'database_snapshot',pg_current_snapshot()::text,
    'catalog_buildings',(select count(*) from inventory),
    'formal',jsonb_build_object(
      'source','building_metrics','rows',m.metric_rows,'buildings',m.formal_buildings,
      'valid_buildings',m.formal_valid_buildings,'unlocked_rows',m.unlocked_rows,
      'draft_rows',m.draft_rows,'incomplete_lock_evidence',m.incomplete_lock_evidence,
      'locked_draft_conflicts',m.locked_draft_conflicts,'duplicate_metric_rows',m.duplicate_metric_rows),
    'submitted',jsonb_build_object(
      'source','quarterly_submissions','rows',s.submission_rows,'buildings',s.submission_buildings,
      'latest_rows',s.latest_rows,'superseded_rows',s.superseded_rows,
      'latest_field_complete',s.latest_field_complete,'zero_area_latest',s.zero_area_latest,
      'missing_rent_latest',s.missing_rent_latest,
      'submitted_outside_calendar_quarter',s.submitted_outside_calendar_quarter),
    'overlap',jsonb_build_object('buildings',o.overlapping_buildings,'conflicting_values',o.conflicting_values)
  ) into result from measured m cross join submitted s cross join overlapping o;

  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  return result;
end $$;

create function public.ai_query_quarterly_coverage(
  p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,
  p_fields text[],p_year integer,p_quarter integer,p_inventory text,p_submarkets text[],p_building_ids uuid[]
) returns jsonb language sql security invoker set search_path='' as $$
  select private.ai_query_quarterly_coverage(p_actor,p_effective,p_session,p_permission_revision,
    p_fields,p_year,p_quarter,p_inventory,p_submarkets,p_building_ids)
$$;
revoke all on function
  private.ai_query_quarterly_coverage(uuid,uuid,uuid,text,text[],integer,integer,text,text[],uuid[]),
  public.ai_query_quarterly_coverage(uuid,uuid,uuid,text,text[],integer,integer,text,text[],uuid[])
  from public,anon,authenticated,service_role;
grant execute on function
  private.ai_query_quarterly_coverage(uuid,uuid,uuid,text,text[],integer,integer,text,text[],uuid[]),
  public.ai_query_quarterly_coverage(uuid,uuid,uuid,text,text[],integer,integer,text,text[],uuid[])
  to service_role;

commit;
