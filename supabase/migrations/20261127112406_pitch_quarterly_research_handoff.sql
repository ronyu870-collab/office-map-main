begin;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_quarterly_research;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; ids uuid[]; snapshot jsonb; old_sub text; old_claims text;
begin
  if p_input->>'action' is distinct from 'business_quarterly_research_snapshot' then
    return private.pitch_studio_access_before_quarterly_research(p_actor,p_session,p_input);
  end if;

  a:=private.ai_query_authority(p_actor,p_actor,p_session);
  if a->>'allowed' is distinct from 'true' or a->>'permission_revision' is distinct from p_input->>'permissionRevision'
    or not (a->'capabilities' ? 'export:internal') or not (a->'capabilities' ? 'query:quarter') then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  if jsonb_typeof(p_input->'period') is distinct from 'object' then
    raise exception 'PITCH_INVALID' using errcode='22023';
  end if;

  -- Use the existing row predicate under the caller's identity and pin the
  -- selected catalogue rows until the standard formal-quarter reader finishes.
  old_sub:=current_setting('request.jwt.claim.sub',true);
  old_claims:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
  select coalesce(array_agg(eligible.id order by eligible.id),'{}'::uuid[]) into ids
  from (
    select b.id from public.buildings b
    where b.city='北京' and b.grade='A' and b.is_active and b.tracking_scope='tracked'
      and b.merged_into_id is null and private.map_building_visible(b.id)
      and ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket)
      and ((a->>'all_buildings')::boolean or a->'building_ids' ? b.id::text)
    order by b.id limit 501 for share of b
  ) eligible;
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true);

  if cardinality(ids)>500 then
    return jsonb_build_object('limit',true);
  end if;
  if cardinality(ids)>0 then
    snapshot:=private.ai_query_snapshot_read(p_actor,p_actor,p_session,a->>'permission_revision',
      array['netEffectiveRent','totalArea','vacantArea'],jsonb_build_array(p_input->'period'),'tracked',null,ids);
  end if;
  return jsonb_build_object('buildingIds',ids,'snapshot',snapshot);
end $$;

revoke all on function private.pitch_studio_access_before_quarterly_research(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
