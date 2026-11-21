begin;
-- Explicit module/field opt-in; no production grant or existing RLS is changed.
create table private.ai_business_research_grants (
 user_id uuid primary key, enabled boolean not null default false, valid_until timestamptz not null,
 modules text[] not null default '{}' check(modules <@ array['profile','submarket','supply','stacking'] and array_position(modules,null) is null),
 profile_fields text[] not null default '{}' check(profile_fields <@ array['district','submarket','grade','completionYear','leasableArea','address','brochureDistrict','completionDate','gfaTotal','gfaOffice','standardFloorArea','height','floors','floorsAbove','floorsBelow','parking','metro','leed','well','greenStandard','propertyManagement','delivery','elevators','telecom','hvac','availablePeriods'] and array_position(profile_fields,null) is null),
 allow_submissions boolean not null default false, allow_export boolean not null default false,
 all_submarkets boolean not null default false, submarkets text[] not null default '{}' check(array_position(submarkets,null) is null),
 all_buildings boolean not null default false, building_ids uuid[] not null default '{}' check(array_position(building_ids,null) is null),
 revision uuid not null default gen_random_uuid(),change_reference text not null check(length(change_reference) between 1 and 500)
);
alter table private.ai_business_research_grants enable row level security;
revoke all on private.ai_business_research_grants from public,anon,authenticated,service_role;
create trigger ai_business_research_changes before insert or update or delete on private.ai_business_research_grants
 for each row execute function private.ai_query_policy_change();

-- Fixed evidence envelope; never a general table/SQL/file reader.
create function private.ai_business_evidence(p_table text,p_id text,p_values jsonb,p_version jsonb,p_recorded text default null,p_asof text default null,p_period jsonb default null)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('table',p_table,'id',p_id,'values',p_values,'version',encode(sha256(convert_to(p_version::text,'UTF8')),'hex'),
  'recordedAt',p_recorded,'asOf',p_asof,'period',p_period)
$$;
revoke all on function private.ai_business_evidence(text,text,jsonb,jsonb,text,text,jsonb) from public,anon,authenticated,service_role;

create function private.ai_business_research_snapshot(p_actor uuid,p_effective uuid,p_session uuid,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare a jsonb;g private.ai_business_research_grants;tool text;module text;ids uuid[];markets text[];fields text[];rows jsonb;old_sub text;old_claims text;
begin
 a:=public.ai_query_authority(p_actor,p_effective,p_session);
 if a->>'allowed' is distinct from 'true' or p_actor is distinct from p_effective or not (a->'capabilities' ? 'query:catalog')
 then return jsonb_build_object('allowed',false);end if;
 select * into g from private.ai_business_research_grants where user_id=p_actor for share;
 if not found or not g.enabled or g.valid_until<=clock_timestamp() then return jsonb_build_object('allowed',false);end if;
 if p_plan=jsonb_build_object('tool','capabilities') then return jsonb_build_object('allowed',true,'modules',g.modules,'profileFields',array(select f from unnest(g.profile_fields) f where a->'capabilities' ? 'query:brochure' and (f not in ('height','floors','parking') or a->'fields' ? f) and (f<>'availablePeriods' or a->'capabilities' ? 'query:quarter')),'submissions',g.allow_submissions,'export',g.allow_export);end if;
 tool:=p_plan->>'tool';module:=case tool when 'query_building_dossier' then 'profile' when 'query_submarket_profile' then 'submarket' when 'query_future_supply' then 'supply' when 'query_stacking_plan' then 'stacking' end;
 if module is null or not(module=any(g.modules)) then return jsonb_build_object('allowed',false);end if;
 if jsonb_typeof(p_plan) is distinct from 'object' or p_plan-array['tool','buildingIds','submarkets','fields','source','period']<>'{}'::jsonb then raise exception 'INVALID_BUSINESS_PLAN';end if;
 ids:=array(select jsonb_array_elements_text(coalesce(p_plan->'buildingIds','[]'))::uuid);
 markets:=array(select jsonb_array_elements_text(coalesce(p_plan->'submarkets','[]')));
 fields:=array(select jsonb_array_elements_text(coalesce(p_plan->'fields','[]')));
 if (module in ('profile','stacking') and (cardinality(ids)<1 or cardinality(ids)>20))
 or (module in ('submarket','supply') and (cardinality(markets)<1 or cardinality(markets)>8))
 or cardinality(fields)>26 then raise exception 'INVALID_BUSINESS_SCOPE';end if;
 if not (g.all_submarkets or markets<@g.submarkets) or not ((a->>'all_submarkets')::boolean or to_jsonb(markets)<@(a->'submarkets'))
 or not(g.all_buildings or ids<@g.building_ids) or not((a->>'all_buildings')::boolean or to_jsonb(ids)<@(a->'building_ids'))
 then return jsonb_build_object('allowed',false);end if;
 -- A market brief or supply universe cannot be inferred from a single-building grant.
 if module in ('submarket','supply') and (not g.all_buildings or not (a->>'all_buildings')::boolean) then return jsonb_build_object('allowed',false);end if;
 if module='profile' and (not fields<@g.profile_fields or not(a->'capabilities' ? 'query:brochure')
 or ('height'=any(fields) and not(a->'fields' ? 'height')) or ('floors'=any(fields) and not(a->'fields' ? 'floors'))
 or ('parking'=any(fields) and not(a->'fields' ? 'parking'))
 or ('availablePeriods'=any(fields) and not(a->'capabilities' ? 'query:quarter'))) then return jsonb_build_object('allowed',false);end if;
 if module='supply' and (coalesce(p_plan->>'source','') not in ('catalog','submitted_quarter','latest_submitted')
 or ((p_plan->>'source'='submitted_quarter') is distinct from (p_plan ? 'period'))) then raise exception 'INVALID_SUPPLY_SOURCE';end if;
 if module='supply' and p_plan->>'source'<>'catalog' and (not g.allow_submissions or not(a->'capabilities' ? 'query:quarter')) then return jsonb_build_object('allowed',false);end if;
 if p_plan ? 'period' and (jsonb_typeof(p_plan->'period') is distinct from 'object' or (p_plan->'period')-array['year','quarter']<>'{}'::jsonb
 or coalesce((p_plan->'period'->>'year')::int,0) not between 1900 and 2200 or coalesce((p_plan->'period'->>'quarter')::int,0) not between 1 and 4) then raise exception 'INVALID_SUPPLY_PERIOD';end if;
 old_sub:=current_setting('request.jwt.claim.sub',true);old_claims:=current_setting('request.jwt.claims',true);
 perform set_config('request.jwt.claim.sub',p_effective::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',p_effective,'role','authenticated')::text,true);
 if module in ('profile','stacking') and exists(select 1 from unnest(ids) i where not exists(select 1 from public.buildings b
  where b.id=i and b.merged_into_id is null and private.map_building_visible(b.id)
  and (g.all_submarkets or b.submarket=any(g.submarkets)) and ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket)))
 then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 return jsonb_build_object('allowed',false);end if;
 if module='profile' then
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'buildingId',b.id,'data',
  jsonb_build_array(private.ai_business_evidence('buildings',b.id::text,
   (select jsonb_object_agg(key,value) from jsonb_each(jsonb_build_object('district',b.district::text,'submarket',b.submarket::text,'grade',b.grade::text,'completionYear',b.completion_year::text,'leasableArea',b.leasable_area::text)||jsonb_build_object('name',b.name)) where key='name' or key=any(fields)),
   to_jsonb(b)-array['contact_phone','owner','notes','former_names']))
  ||coalesce((select jsonb_agg(private.ai_business_evidence('building_brochure_data',d.id::text,
   coalesce((select jsonb_object_agg(key,value) from jsonb_each(jsonb_build_object('address',d.address::text,'brochureDistrict',d.district::text,'completionDate',d.completion_date::text,'gfaTotal',d.gfa_total::text,'gfaOffice',d.gfa_office::text,'standardFloorArea',d.standard_floor_area::text,'height',d.building_height::text,'floors',d.building_floors::text,'floorsAbove',d.floors_above::text,'floorsBelow',d.floors_below::text,'parking',d.parking_total::text,'metro',d.metro_access::text,'leed',d.leed_certification::text,'well',d.well_certification::text,'greenStandard',d.green_building_standard::text,'propertyManagement',d.property_management::text,'delivery',d.delivery_standard::text,'elevators',d.elevator_passenger::text,'telecom',d.telecom_provider::text,'hvac',d.hvac_system::text)) where key=any(fields)),'{}'),to_jsonb(d),d.updated_at::text) order by d.id)
   from public.building_brochure_data d where d.building_id=b.id and fields && array['address','brochureDistrict','completionDate','gfaTotal','gfaOffice','standardFloorArea','height','floors','floorsAbove','floorsBelow','parking','metro','leed','well','greenStandard','propertyManagement','delivery','elevators','telecom','hvac']),'[]')
  ||case when 'availablePeriods'=any(fields) then jsonb_build_array(private.ai_business_evidence('building_metrics',b.id::text,
   jsonb_build_object('availablePeriods',(select string_agg(q.label,'、' order by q.label) from (select distinct m.record_year::text||'Q'||m.record_quarter::text label from public.building_metrics m where m.building_id=b.id and m.is_draft is not true) q)),
   coalesce((select jsonb_agg(jsonb_build_array(m.id,m.record_year,m.record_quarter,m.is_draft) order by m.id) from public.building_metrics m where m.building_id=b.id and m.is_draft is not true),'[]'))) else '[]'::jsonb end
 ) order by b.id),'[]') into rows from public.buildings b where b.id=any(ids);
 elsif module='submarket' then
 select coalesce(jsonb_agg(jsonb_build_object('id',p.submarket,'name',p.submarket,'buildingId',null,'editorial',jsonb_build_object('headline',p.headline,'overview',p.overview,'industries',p.industries,'transport',p.transport,'demographics',p.demographics,'policies',p.policies,'insights',p.insights),'data',jsonb_build_array(
  private.ai_business_evidence('map_submarket_profiles',p.submarket,jsonb_build_object('name',p.submarket,'headline',p.headline,'overview',p.overview,
  'industries',p.industries,'transport',p.transport,'published',p.is_published::text),to_jsonb(p)-array['updated_by','published_by'],p.updated_at::text,p.published_at::text))) order by p.submarket),'[]')
 into rows from public.map_submarket_profiles p where p.submarket=any(markets);
 elsif module='supply' then
 select coalesce(jsonb_agg(body order by id),'[]') into rows from (
  select f.id,jsonb_build_object('id',f.id,'name',f.name,'buildingId',null,'data',jsonb_build_array(
   private.ai_business_evidence('future_supplies',f.id::text,jsonb_build_object('name',f.name,'submarket',f.submarket,'district',f.district,'grade',f.grade,
   'launchYear',f.launch_year,'launchQuarter',f.launch_quarter,'catalogArea',f.total_area::text,'status',f.status,'entered',f.is_entered_market::text,
   'linkedBuilding',case when f.building_id is not null and exists(select 1 from public.buildings b where b.id=f.building_id and b.merged_into_id is null and private.map_building_visible(b.id)
   and (g.all_submarkets or b.submarket=any(g.submarkets)) and ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket)) then f.building_id::text end),
   to_jsonb(f)-array['owner','contact_phone','assigned_to','notes'],f.created_at::text))
   ||case when p_plan->>'source'='catalog' then '[]'::jsonb else coalesce((select jsonb_agg(private.ai_business_evidence('future_supply_submissions',s.id::text,
    jsonb_build_object('submittedArea',s.total_area::text,'submissionPeriod',s.record_year::text||'Q'||s.record_quarter::text),
    jsonb_build_array(s.id,s.record_year,s.record_quarter,s.total_area,s.updated_at),s.updated_at::text,null,jsonb_build_object('year',s.record_year,'quarter',s.record_quarter)) order by s.id)
    from public.future_supply_submissions s where s.future_supply_id=f.id and
    (case when p_plan->>'source'='submitted_quarter' then s.record_year=(p_plan->'period'->>'year')::int and s.record_quarter=(p_plan->'period'->>'quarter')::int
     else (s.record_year,s.record_quarter)=(select x.record_year,x.record_quarter from public.future_supply_submissions x where x.future_supply_id=f.id order by x.record_year desc,x.record_quarter desc limit 1) end)),'[]') end) body
  from public.future_supplies f where f.submarket=any(markets) order by f.id limit 5001
 ) r;
 else
 if exists(select 1 from public.stacking_plan_towers t join public.stacking_plan_floors f on f.tower_id=t.id
  join public.stacking_plan_spaces s on s.floor_id=f.id join public.stacking_plan_sources ss on ss.id=s.source_id
  join public.stacking_plan_sources fs on fs.id=f.source_id where t.building_id=any(ids) and (ss.building_id<>t.building_id or fs.building_id<>t.building_id))
 then raise exception 'STACKING_IDENTITY_MISMATCH';end if;
 select coalesce(jsonb_agg(body order by id),'[]') into rows from (
 select s.id,jsonb_build_object('id',s.id,'name',b.name,'buildingId',b.id,'data',jsonb_build_array(
  private.ai_business_evidence('buildings',b.id::text,jsonb_build_object('building',b.name),to_jsonb(b)-array['contact_phone','owner','notes']),
  private.ai_business_evidence('stacking_plan_towers',t.id::text,jsonb_build_object('tower',t.display_name,'towerCode',t.code),to_jsonb(t)),
  private.ai_business_evidence('stacking_plan_floors',fl.id::text,jsonb_build_object('floor',fl.floor_code,'floorArea',fl.floor_area_sqm::text,'use',fl.use_type),to_jsonb(fl)),
  private.ai_business_evidence('stacking_plan_spaces',s.id::text,jsonb_build_object('unit',s.unit_code,'status',s.occupancy_status,'unitArea',s.area_sqm::text,'verification',s.verification_status),
   jsonb_build_array(s.id,s.unit_code,s.occupancy_status,s.area_sqm,s.verification_status,s.source_id,s.revision,s.updated_at),s.updated_at::text),
  private.ai_business_evidence('stacking_plan_sources',ss.id,jsonb_build_object('sourceDate',ss.source_as_of::text,'dateKind',ss.as_of_kind,'review',ss.review_state),
   jsonb_build_array(ss.id,ss.building_id,ss.source_as_of,ss.as_of_kind,ss.review_state),null,ss.source_as_of::text),
  private.ai_business_evidence('stacking_plan_sources',fs.id,jsonb_build_object('floorSourceDate',fs.source_as_of::text,'floorDateKind',fs.as_of_kind,'floorReview',fs.review_state),
   jsonb_build_array(fs.id,fs.building_id,fs.source_as_of,fs.as_of_kind,fs.review_state),null,fs.source_as_of::text))) body
 from public.buildings b join public.stacking_plan_towers t on t.building_id=b.id
 join public.stacking_plan_floors fl on fl.tower_id=t.id join public.stacking_plan_spaces s on s.floor_id=fl.id
 join public.stacking_plan_sources ss on ss.id=s.source_id and ss.building_id=b.id
 join public.stacking_plan_sources fs on fs.id=fl.source_id and fs.building_id=b.id
 where b.id=any(ids) order by s.id limit 5001) r;
 end if;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 if jsonb_array_length(rows)>5000 or exists(select 1 from jsonb_array_elements(rows) r where jsonb_array_length(r->'data')>1000) or (select count(*) from jsonb_array_elements(rows) r cross join lateral jsonb_array_elements(r->'data') d)>20000
 then return jsonb_build_object('allowed',true,'over_limit',true);end if;
 return jsonb_build_object('allowed',true,'version','business-research/1','permission_revision',
  encode(sha256(convert_to(jsonb_build_array(a->>'permission_revision',to_jsonb(g))::text,'UTF8')),'hex'),'export',g.allow_export,'records',rows);
end $$;
create function public.ai_business_research_snapshot(p_actor uuid,p_effective uuid,p_session uuid,p_plan jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.ai_business_research_snapshot(p_actor,p_effective,p_session,p_plan)$$;
revoke all on function private.ai_business_research_snapshot(uuid,uuid,uuid,jsonb),public.ai_business_research_snapshot(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.ai_business_research_snapshot(uuid,uuid,uuid,jsonb),public.ai_business_research_snapshot(uuid,uuid,uuid,jsonb) to service_role;
commit;
