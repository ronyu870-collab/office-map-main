-- Current-catalog grouping facts are already read by the protected snapshot RPC.
-- Extend only their source recheck whitelist; current admin, grants, ownership,
-- visibility and all existing numeric checks stay in the same function.
begin;
create or replace function private.ai_query_result_sources_allowed(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_permission_revision text,p_sources jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; allowed boolean:=false; old_sub text; old_claims text;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed'='true' and a->>'permission_revision'=p_permission_revision
    and exists(select 1 from private.ai_query_audit_streams where request_id=p_request_id and actor_id=p_actor and effective_user_id=p_effective and state='succeeded')
    and jsonb_typeof(p_sources)='array' and jsonb_array_length(p_sources)<=200000 and octet_length(p_sources::text)<=16*1024*1024 then
    old_sub:=current_setting('request.jwt.claim.sub',true);old_claims:=current_setting('request.jwt.claims',true);
    perform set_config('request.jwt.claim.sub',p_effective::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',p_effective,'role','authenticated')::text,true);
    with refs as materialized (
      select * from jsonb_to_recordset(p_sources) as r(entity_id uuid,record_id text,source_table text,field text,year integer,quarter integer)
    ) select not exists (
      select 1 from refs r left join public.buildings b on b.id=r.entity_id
      where b.id is null or b.merged_into_id is not null or private.map_building_visible(b.id) is not true
        or ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket) is not true
        or ((a->>'all_buildings')::boolean or a->'building_ids' ? b.id::text) is not true
        or not coalesce(case r.source_table
          when 'buildings' then r.record_id=b.id::text and r.field in ('name','submarket','grade') and r.year is null and r.quarter is null
          when 'building_brochure_data' then a->'capabilities' ? 'query:brochure' and r.year is null and r.quarter is null
            and a->'fields' ? (case r.field when 'building_height' then 'height' when 'building_floors' then 'floors' when 'parking_total' then 'parking' end)
            and exists(select 1 from public.building_brochure_data d where d.id::text=r.record_id and d.building_id=b.id)
          when 'building_metrics' then a->'capabilities' ? 'query:quarter'
            and a->'fields' ? (case r.field when 'total_area' then 'totalArea' when 'vacant_area' then 'vacantArea' when 'net_effective_rent' then 'netEffectiveRent' end)
            and exists(select 1 from public.building_metrics m where m.id::text=r.record_id and m.building_id=b.id and m.record_year=r.year and m.record_quarter=r.quarter and m.is_draft is not true)
          else false end,false)
    ) into allowed;
    perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
    perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  end if;
  insert into private.ai_query_result_access(actor_id,effective_user_id,session_id,request_id,action,outcome,permission_revision)
    values(p_actor,p_effective,p_session,p_request_id,'sources',case when allowed then 'allowed' else 'denied' end,a->>'permission_revision');
  return jsonb_build_object('allowed',allowed,'permission_revision',a->>'permission_revision','source_policy','catalog-dimensions/1');
end $$;
commit;
