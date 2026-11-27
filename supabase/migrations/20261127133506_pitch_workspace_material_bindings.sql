begin;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_material_bindings;

create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare bindings jsonb; metadata jsonb; pid uuid;
begin
  -- This reader checks the owner, live permissions and expected project version
  -- under the same lock before any source metadata can be returned.
  bindings:=private.pitch_studio_access_before_material_bindings(p_actor,p_session,p_input);
  if p_input->>'action' is distinct from 'workspace_document_bindings'
    or p_input->'includeMaterialReceipts' is distinct from 'true'::jsonb then return bindings;end if;

  pid:=(p_input->>'projectId')::uuid;
  with slides as (
    select s.id,s.position,s.content,s.asset_id,s.asset_version
    from public.pitch_project_slides s where s.project_id=pid
  ), documents as (
    select s.id slide_id,src->>'id' source_id,d.id document_id,p.id page_id,
      d.version,d.sha256,d.data_as_of,d.revision,
      jsonb_build_object('organizationId',d.organization_id,'region',d.region,'city',d.city,'businessLine',d.business_line) scope,
      jsonb_build_object('visibility',d.visibility,'clientExportConfigured',d.allow_client_export,'isTestData',d.is_test_data) policy
    from slides s
    cross join lateral jsonb_array_elements(s.content->'sources') sources(src)
    join public.pitch_source_documents d on d.id=(src->>'documentId')::uuid
    left join public.pitch_source_pages p on p.id=(src->>'pageId')::uuid and p.document_id=d.id and not p.hidden
    where src->>'kind'='document' and src->>'version'=d.version::text and src->>'sha256'=d.sha256
      and (not src?'pageId' or p.id is not null)
      and d.upload_state='ready' and d.state<>'archived'
      and (d.valid_from is null or d.valid_from<=current_date) and (d.valid_until is null or d.valid_until>=current_date)
      and private.pitch_document_visible(p_actor,p_session,d.id)
  ), media as (
    select s.id slide_id,m.id,m.version,m.sha256,m.data_as_of,p.id page_id,d.id document_id,d.version document_version,
      d.sha256 document_sha256,d.revision,
      jsonb_build_object('organizationId',m.organization_id,'region',m.region,'city',m.city,'businessLine',m.business_line) scope,
      jsonb_build_object('visibility',d.visibility,'clientExportConfigured',d.allow_client_export,'isTestData',d.is_test_data) policy
    from slides s
    cross join lateral private.pitch_content_media(s.content) ref
    join public.pitch_media_assets m on (m.id,m.version)=(ref.id,ref.version)
    join public.pitch_source_pages p on p.id=m.source_page_id
    join public.pitch_source_documents d on d.id=p.document_id
    where d.upload_state='ready' and d.state<>'archived'
      and (d.valid_from is null or d.valid_from<=current_date) and (d.valid_until is null or d.valid_until>=current_date)
      and private.pitch_media_visible(p_actor,p_session,m.id,m.version)
  ), visuals as (
    select s.id slide_id,src->>'id' source_id,pin->>'kind' kind,pin->>'id' id,pin->'version' version,
      pin->>'versionHash' version_hash,pin->>'contentHash' content_hash,pin->'buildingIds' building_ids,
      pin->'origin' query,src->>'dataAsOf' source_date,approval.binding
    from slides s
    cross join lateral jsonb_array_elements(s.content->'sources') sources(src)
    cross join lateral (select src->'visual' pin) receipt
    left join lateral (
      select snapshot->'binding' binding
      from public.pitch_content_assets a join public.pitch_business_generations g on g.project_id=a.generated_project_id
      cross join lateral jsonb_array_elements(g.snapshots) saved(snapshot)
      where pin->>'kind'='stacking-plan' and a.id=s.asset_id and snapshot->>'id'='historical-stacking-appendix'
        and snapshot->>'entityId'=pin->'origin'->>'buildingId'
        and snapshot->'binding'->>'dataVersion'=pin->>'versionHash'
      limit 1
    ) approval on true
    where src->>'kind'='record' and src->>'version'=pin->>'versionHash' and src->>'sha256'=pin->>'contentHash'
      and case pin->>'kind'
        when 'photo' then pin->'origin'->>'type'='building-photo' and s.content->>'disclosure'='internal'
        when 'map' then pin->'origin'->>'type' in ('building-locations','market-locations') and s.content->>'disclosure'='internal'
        when 'stacking-plan' then pin->'origin'->>'type'='stacking-snapshot' and s.content->>'disclosure'='restricted'
        else false end
      and exists(select 1 from jsonb_array_elements(s.content->'blocks') b
        where b->'sourceIds' ? (src->>'id') and ((b->>'kind'='image' and b->>'mediaAssetId'=pin->>'id'
          and b->>'mediaVersion'=pin->>'version') or (pin->>'kind'='map' and b->>'kind'='map'
          and b->>'mapId'=pin->>'id' and b->>'snapshotVersion'=pin->>'versionHash')))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind','material_receipt','slideId',s.id,
    'asset',jsonb_build_object('id',v.asset_id,'version',v.version,'sha256',v.sha256,'dataAsOf',v.content->>'dataAsOf',
      'scope',jsonb_build_object('organizationId',a.organization_id,'region',a.region,'city',a.city,'businessLine',a.business_line),
      'policy',jsonb_build_object('visibility',v.visibility,'disclosure',v.disclosure,'internalGeneration',v.allow_internal_generation,
        'clientExport',v.allow_client_export,'externalAi',v.allow_external_ai,'isTestData',v.is_test_data)),
    'documents',coalesce((select jsonb_agg(to_jsonb(d)-'slide_id' order by d.source_id)
      from documents d where d.slide_id=s.id),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(to_jsonb(m)-'slide_id' order by m.id,m.version)
      from media m where m.slide_id=s.id),'[]'::jsonb),
    'visuals',coalesce((select jsonb_agg(to_jsonb(n)-'slide_id' order by n.source_id)
      from visuals n where n.slide_id=s.id),'[]'::jsonb)
  ) order by s.position),'[]'::jsonb) into metadata
  from slides s
  join public.pitch_asset_versions v on (v.asset_id,v.version)=(s.asset_id,s.asset_version)
  join public.pitch_content_assets a on a.id=v.asset_id
  where private.pitch_version_visible(p_actor,p_session,v.asset_id,v.version,'generate');

  return bindings||metadata;
end $$;

revoke all on function private.pitch_studio_access_before_material_bindings(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
