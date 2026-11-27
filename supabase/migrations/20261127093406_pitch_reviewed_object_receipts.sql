begin;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_object_receipts;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid uuid; captures jsonb; receipts jsonb;
begin
  if p_input->>'action' is distinct from 'workspace_document_bindings' then
    return private.pitch_studio_access_before_object_receipts(p_actor,p_session,p_input);
  end if;

  -- The existing reader locks the project version and checks ownership and
  -- current generation permissions before any of its archived evidence is read.
  captures:=private.pitch_studio_access_before_object_receipts(p_actor,p_session,p_input);
  pid:=(p_input->>'projectId')::uuid;
  with used as (
    select distinct asset_id,asset_version
    from public.pitch_project_slides where project_id=pid
  ), bound as (
    select distinct on (a.id,v.version,source->>'id',snapshot->>'id',result->>'resultId')
      a.id asset_id,v.version asset_version,g.project_id generation_id,
      source->>'id' source_id,snapshot->>'id' receipt_id,snapshot->>'entityId' entity_id,
      snapshot->'binding' binding,result->>'resultId' result_id,
      jsonb_build_object('operation',result->>'operation','parameters',result->'parameters',
        'scopeFingerprint',result->>'scopeFingerprint','registryVersion',result->>'registryVersion',
        'fields',coalesce(result->'fields',(select coalesce(jsonb_agg(column_value->>'key' order by ord),'[]')
          from jsonb_array_elements(result->'table'->'columns') with ordinality columns(column_value,ord)))) query
    from used s
    join public.pitch_asset_versions v on (v.asset_id,v.version)=(s.asset_id,s.asset_version)
    join public.pitch_content_assets a on a.id=v.asset_id
    join public.pitch_business_generations g on g.project_id=a.generated_project_id
    cross join lateral jsonb_array_elements(v.content->'sources') src(source)
    cross join lateral jsonb_array_elements(g.snapshots) sn(snapshot)
    cross join lateral jsonb_array_elements(snapshot->'results') res(result)
    where g.parameters?'reviewedPlanId'
      and snapshot?'id' and snapshot?'entityId' and snapshot->'binding'->>'disclosure'='internal'
      and jsonb_typeof(result->'parameters')='object'
      and source->>'kind'='record'
      and (
        (source->>'id'=result->>'resultId' and source->>'recordId'=result->>'resultId'
          and source->>'version'=snapshot->'binding'->>'dataVersion'
          and source->>'locator'=(snapshot->>'id')||' · '||(result->>'resultId'))
        or (snapshot->>'id'='submarket-research' and exists (
          select 1 from jsonb_array_elements(result->'sourceKeys') stored(row_key)
          where row_key->>'table'='map_submarket_profiles'
            and source->>'recordId'=row_key->>'recordId'
            and source->>'version'=row_key->>'recordVersion'
            and source->>'locator'='map_submarket_profiles/'||(row_key->>'recordId')||'/'||(row_key->>'field')
        ))
      )
      and private.pitch_version_visible(p_actor,p_session,v.asset_id,v.version,'generate')
    order by a.id,v.version,source->>'id',snapshot->>'id',result->>'resultId'
  )
  select coalesce(jsonb_agg(to_jsonb(bound)||'{"kind":"query_receipt"}'::jsonb
    order by asset_id,asset_version,source_id,receipt_id,result_id),'[]') into receipts from bound;
  return captures||receipts;
end $$;

revoke all on function private.pitch_studio_access_before_object_receipts(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
