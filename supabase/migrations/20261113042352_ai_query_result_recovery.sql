begin;
create table private.ai_query_result_access (
  event_id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null, effective_user_id uuid not null, session_id uuid not null, request_id uuid not null,
  action text not null check(action in ('status','archive','sources')),
  outcome text not null check(outcome in ('allowed','denied','unavailable')),
  permission_revision text
);
alter table private.ai_query_result_access enable row level security;
revoke all on private.ai_query_result_access from public,anon,authenticated,service_role;

-- Own-result recovery is distinct from the independent system-wide audit grant.
-- Refusals return envelopes so the access event commits, with no existence hint.
create function private.ai_query_result_read(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; s private.ai_query_audit_streams; n bigint; bytes bigint; outcome text:='denied'; result jsonb;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
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

-- Inputs come only from the authenticated/decrypted stored result, never from a
-- client-supplied list. Numeric values/versions are NOT fetched or recomputed.
create function private.ai_query_result_sources_allowed(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_permission_revision text,p_sources jsonb)
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
          when 'buildings' then r.record_id=b.id::text and r.field='name' and r.year is null and r.quarter is null
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
  return jsonb_build_object('allowed',allowed,'permission_revision',a->>'permission_revision');
end $$;

create function public.ai_query_result_read(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_action text)
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_query_result_read(p_actor,p_effective,p_session,p_request_id,p_action) $$;
create function public.ai_query_result_sources_allowed(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_permission_revision text,p_sources jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_query_result_sources_allowed(p_actor,p_effective,p_session,p_request_id,p_permission_revision,p_sources) $$;
revoke all on function private.ai_query_result_read(uuid,uuid,uuid,uuid,text),public.ai_query_result_read(uuid,uuid,uuid,uuid,text),
  private.ai_query_result_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb),public.ai_query_result_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_result_read(uuid,uuid,uuid,uuid,text),public.ai_query_result_read(uuid,uuid,uuid,uuid,text),
  private.ai_query_result_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb),public.ai_query_result_sources_allowed(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
