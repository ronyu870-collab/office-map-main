-- Current-admin lease results: source reauthorization and owner-only archive admission.
-- No enablement or real-person grants.
begin;
create or replace function private.ai_query_lease_sources_allowed(
  p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_permission_revision text,p_sources jsonb
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; allowed boolean:=false; audit private.ai_query_audit_streams;
begin
  a:=private.ai_query_lease_authority(p_actor,p_effective,p_session);
  select * into audit from private.ai_query_audit_streams s where s.request_id=p_request_id and s.actor_id=p_actor
    and s.effective_user_id=p_effective and s.identity_valid and s.state='succeeded' for share;
  if found and a->>'allowed'='true' and a->>'access_policy'='admin-only/1' and a->>'permission_revision'=p_permission_revision
    and private.ai_query_audit_verify(audit.request_id,audit.head_hash,audit.head_sequence)
    and jsonb_typeof(p_sources)='array' and jsonb_array_length(p_sources)<=200000 and octet_length(p_sources::text)<=16*1024*1024 then
    with refs as materialized (
      select * from jsonb_to_recordset(p_sources) as r(entity_id text,record_id text,source_table text,field text,year integer,quarter integer)
    ), current_records as materialized (
      select v.*,count(*) over(partition by read_id) identity_count from public.lease_transactions_read_v1 v
      where exists(select 1 from refs r where r.entity_id=v.read_id)
    ) select not exists (
      select 1 from refs r left join current_records v on v.read_id=r.entity_id
      where not coalesce(v.read_id is not null and v.identity_count=1 and a->'lease_sources' ? v.record_source
        and ((a->>'all_submarkets')::boolean or a->'submarkets' ? v.sub_market)
        and ((a->>'all_lease_records')::boolean or a->'lease_record_ids' ? v.read_id)
        and ((r.year is null and r.quarter is null) or r.year between 1900 and 2200 and r.quarter between 1 and 4
          and v.transaction_time_precision in ('date','quarter') and extract(year from v.transaction_period_start)=r.year and extract(quarter from v.transaction_period_start)=r.quarter)
        and case r.source_table
          when 'lease_transactions_read_v1' then r.record_id=v.read_id and (r.field in ('company','new_building','sub_market','building_id','building_match_scope','related_building_ids','transaction_date','transaction_year','transaction_quarter','transaction_time_precision','transaction_period_start','transaction_period_end','period_source','quality_status')
            or a->'lease_fields' ? r.field and r.field in ('area_sqm','face_rent','effective_rent','lease_term_months','industry','sub_industry','demand_type'))
          when 'lease_transactions' then v.record_source='live' and r.record_id=v.source_record_id::text
            and (r.field='is_face_rent_estimated' and a->'lease_fields' ? 'face_rent' or r.field='is_effective_rent_estimated' and a->'lease_fields' ? 'effective_rent')
          when 'lease_transactions_history' then v.record_source='history' and r.record_id=v.source_record_id::text
            and (r.field='source_lease_term_raw' and a->'lease_fields' ? 'lease_term_months'
              or r.field in ('source_file','source_sheet','source_row') and a->'lease_fields' ? 'source_evidence')
          else false end,false)
    ) into allowed;
  end if;
  insert into private.ai_query_result_access(actor_id,effective_user_id,session_id,request_id,action,outcome,permission_revision)
    values(p_actor,p_effective,p_session,p_request_id,'sources',case when allowed then 'allowed' else 'denied' end,a->>'permission_revision');
  return jsonb_build_object('allowed',allowed,'permission_revision',a->>'permission_revision','source_policy','lease-observation/1');
end $$;
create or replace function public.ai_query_lease_sources_allowed(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_permission_revision text,p_sources jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.ai_query_lease_sources_allowed(p_actor,p_effective,p_session,p_request_id,p_permission_revision,p_sources)
$$;
revoke all on function private.ai_query_lease_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb),public.ai_query_lease_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_lease_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb),public.ai_query_lease_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
create or replace function private.ai_query_result_read(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; s private.ai_query_audit_streams; n bigint; bytes bigint; outcome text:='denied'; result jsonb;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' then a:=private.ai_query_future_authority(p_actor,p_effective,p_session);end if;
  if a->>'allowed' is distinct from 'true' then a:=private.ai_query_lease_authority(p_actor,p_effective,p_session);end if;
  if a->>'allowed'='true' and p_action in ('status','archive') then
    select * into s from private.ai_query_audit_streams where request_id=p_request_id
      and actor_id=p_actor and effective_user_id=p_effective for share;
    if found then
      select count(*),coalesce(sum(octet_length(cipher::text)),0) into n,bytes
        from (select cipher from private.ai_query_audit_events where request_id=p_request_id order by sequence limit 2049) e;
      outcome:='unavailable';
      if n between 1 and 2048 and bytes<=64*1024*1024
        and s.state=(select kind from private.ai_query_audit_events where request_id=p_request_id
          and kind in ('received','running','succeeded','failed','denied','cancelled') order by sequence desc limit 1)
        and private.ai_query_audit_verify(p_request_id,s.head_hash,s.head_sequence) then
        outcome:='allowed';
        result:=jsonb_build_object('allowed',true,'state',s.state,'permission_revision',a->>'permission_revision',
          'head_sequence',s.head_sequence,'head_hash',s.head_hash,
          'events',case when p_action='archive' and s.state='succeeded' then
            (select jsonb_agg(to_jsonb(e) order by sequence) from private.ai_query_audit_events e where request_id=p_request_id)
            else '[]'::jsonb end);
      end if;
    end if;
  end if;
  insert into private.ai_query_result_access(actor_id,effective_user_id,session_id,request_id,action,outcome,permission_revision)
    values(p_actor,p_effective,p_session,p_request_id,case when p_action='status' then 'status' else 'archive' end,outcome,a->>'permission_revision');
  return coalesce(result,jsonb_build_object('allowed',false,'unavailable',outcome='unavailable'));
end $$;
commit;
