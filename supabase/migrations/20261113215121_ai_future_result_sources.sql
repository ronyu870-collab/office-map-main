-- Future result source reauthorization; no activation or account grants.
begin;
create or replace function private.ai_query_future_sources_allowed(
  p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_permission_revision text,p_sources jsonb
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; allowed boolean:=false; old_sub text; old_claims text; audit private.ai_query_audit_streams;
begin
  a:=private.ai_query_future_authority(p_actor,p_effective,p_session);
  select * into audit from private.ai_query_audit_streams s where s.request_id=p_request_id and s.actor_id=p_actor
    and s.effective_user_id=p_effective and s.identity_valid and s.state='succeeded' for share;
  if found and a->>'allowed'='true' and a->>'access_policy'='admin-only/1' and a->>'permission_revision'=p_permission_revision
    and private.ai_query_audit_verify(audit.request_id,audit.head_hash,audit.head_sequence)
    and jsonb_typeof(p_sources)='array' and jsonb_array_length(p_sources)<=200000 and octet_length(p_sources::text)<=16*1024*1024 then
    old_sub:=current_setting('request.jwt.claim.sub',true);old_claims:=current_setting('request.jwt.claims',true);
    perform set_config('request.jwt.claim.sub',p_effective::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',p_effective,'role','authenticated')::text,true);
    with refs as materialized (
      select * from jsonb_to_recordset(p_sources) as r(entity_id uuid,record_id text,source_table text,field text,year integer,quarter integer)
    ) select not exists (
      select 1 from refs r left join public.future_supplies f on f.id=r.entity_id left join public.buildings b on b.id=f.building_id
      where not coalesce(case when r.source_table='app_settings' then a->'capabilities' ? 'query:future-progress'
        and r.entity_id is null and r.field='value' and r.year is null and r.quarter is null
        and r.record_id in ('current_submission_year','current_submission_quarter') and exists(select 1 from public.app_settings s where s.key=r.record_id)
      else f.id is not null and f.is_entered_market=false and private.map_can_view_extended_inventory()
        and (f.building_id is null or b.id is not null and b.is_active and b.merged_into_id is null and b.project_type='future' and private.map_building_visible(b.id))
        and ((a->>'all_submarkets')::boolean or a->'submarkets' ? f.submarket)
        and ((a->>'all_future_supplies')::boolean or a->'future_supply_ids' ? f.id::text)
        and case r.source_table
          when 'future_supplies' then r.record_id=f.id::text and r.year is null and r.quarter is null
            and r.field in ('building_id','name','submarket','grade','launch_year','launch_quarter','total_area','location_lng','location_lat','status','completion_year','is_entered_market')
          when 'future_supply_assignments' then a->'capabilities' ? 'query:future-progress'
            and r.field in ('future_supply_id','user_id','user_name','record_year','record_quarter','created_at') and r.year between 1900 and 2200 and r.quarter between 1 and 4
            and exists(select 1 from public.future_supply_assignments x where x.id::text=r.record_id and x.future_supply_id=f.id and x.record_year=r.year and x.record_quarter=r.quarter)
          when 'future_supply_submissions' then a->'capabilities' ? 'query:future-progress'
            and (r.field in ('future_supply_id','user_id','user_name','record_year','record_quarter','created_at','updated_at')
              or a->'capabilities' ? 'query:future-quality' and r.field in ('total_area','vacant_area','vacancy_rate','asking_rent','management_fee','face_rent','rent_free_period','net_effective_rent'))
            and r.year between 1900 and 2200 and r.quarter between 1 and 4
            and exists(select 1 from public.future_supply_submissions x where x.id::text=r.record_id and x.future_supply_id=f.id and x.record_year=r.year and x.record_quarter=r.quarter)
          else false end
      end,false)
    ) into allowed;
    perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  end if;
  insert into private.ai_query_result_access(actor_id,effective_user_id,session_id,request_id,action,outcome,permission_revision)
    values(p_actor,p_effective,p_session,p_request_id,'sources',case when allowed then 'allowed' else 'denied' end,a->>'permission_revision');
  return jsonb_build_object('allowed',allowed,'permission_revision',a->>'permission_revision','source_policy','future-observation/1');
end $$;
create or replace function public.ai_query_future_sources_allowed(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_permission_revision text,p_sources jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.ai_query_future_sources_allowed(p_actor,p_effective,p_session,p_request_id,p_permission_revision,p_sources)
$$;
revoke all on function private.ai_query_future_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb),public.ai_query_future_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_future_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb),public.ai_query_future_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
