-- P1 metadata only: reuse the existing authority, row predicate and encrypted audit.
-- No business rows, grants, RLS policies or metric semantics are changed.
begin;

create function private.ai_query_available_periods(
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
      and m.is_draft is not true and m.record_year between 1900 and 2200 and m.record_quarter between 1 and 4
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

create function public.ai_query_available_periods(p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_fields text[],p_inventory text,p_submarkets text[],p_building_ids uuid[])
returns jsonb language sql security invoker set search_path='' as $$
  select private.ai_query_available_periods(p_actor,p_effective,p_session,p_permission_revision,p_fields,p_inventory,p_submarkets,p_building_ids)
$$;

-- Read only bounded interpretation events, including a prior clarification.
-- Ownership/current authority/chain are checked here, original session and conversation in the AEAD envelope by the server.
create function private.ai_query_context_read(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare a jsonb; s private.ai_query_audit_streams; result jsonb; outcome text:='denied';
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed'='true' then
    select * into s from private.ai_query_audit_streams where request_id=p_request_id
      and actor_id=p_actor and effective_user_id=p_effective for share;
    if found and s.head_sequence between 1 and 2048 then
      outcome:='unavailable';
      if s.state=(select kind from private.ai_query_audit_events where request_id=p_request_id
          and kind in ('received','running','succeeded','failed','denied','cancelled') order by sequence desc limit 1)
        and private.ai_query_audit_verify(p_request_id,s.head_hash,s.head_sequence) then
        select jsonb_build_object('allowed',true,'state',s.state,'permission_revision',a->>'permission_revision',
          'events',coalesce(jsonb_agg(to_jsonb(e) order by e.sequence),'[]'::jsonb)) into result
        from private.ai_query_audit_events e where e.request_id=p_request_id and e.kind in ('received','running','tool_finished','denied');
        if octet_length(result::text)<=512*1024 then outcome:='allowed'; else result:=null; end if;
      end if;
    end if;
  end if;
  insert into private.ai_query_result_access(actor_id,effective_user_id,session_id,request_id,action,outcome,permission_revision)
    values(p_actor,p_effective,p_session,p_request_id,'archive',outcome,a->>'permission_revision');
  return coalesce(result,jsonb_build_object('allowed',false));
end $$;
create function public.ai_query_context_read(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_query_context_read(p_actor,p_effective,p_session,p_request_id) $$;

-- Conservative cross-instance cap using already committed request receipts.
-- All query submissions count, so unrelated simple reads can only reduce the budget.
create function private.ai_query_model_budget(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare a jsonb; minute_count bigint; day_count bigint;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or not exists(select 1 from private.ai_query_audit_streams
    where request_id=p_request_id and actor_id=p_actor and effective_user_id=p_effective and state='running') then
    return jsonb_build_object('allowed',false);
  end if;
  select count(*) filter(where received_at>clock_timestamp()-interval '1 minute'),count(*) into minute_count,day_count
    from private.ai_query_audit_streams where actor_id=p_actor and received_at>clock_timestamp()-interval '24 hours';
  return jsonb_build_object('allowed',minute_count<=12 and day_count<=120,'policy','query-receipts-12-minute-120-day/1');
end $$;
create function public.ai_query_model_budget(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_query_model_budget(p_actor,p_effective,p_session,p_request_id) $$;

revoke all on function private.ai_query_available_periods(uuid,uuid,uuid,text,text[],text,text[],uuid[]),public.ai_query_available_periods(uuid,uuid,uuid,text,text[],text,text[],uuid[]),
  private.ai_query_context_read(uuid,uuid,uuid,uuid),public.ai_query_context_read(uuid,uuid,uuid,uuid),
  private.ai_query_model_budget(uuid,uuid,uuid,uuid),public.ai_query_model_budget(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_available_periods(uuid,uuid,uuid,text,text[],text,text[],uuid[]),public.ai_query_available_periods(uuid,uuid,uuid,text,text[],text,text[],uuid[]),
  private.ai_query_context_read(uuid,uuid,uuid,uuid),public.ai_query_context_read(uuid,uuid,uuid,uuid),
  private.ai_query_model_budget(uuid,uuid,uuid,uuid),public.ai_query_model_budget(uuid,uuid,uuid,uuid) to service_role;
commit;
