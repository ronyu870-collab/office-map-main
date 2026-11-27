begin;

-- Only an image paired with its exact server-generated source receipt uses
-- upstream replay. Original files and business facts stay in their own stores.
create function private.pitch_visual_image_bound(p_content jsonb,p_id uuid,p_version integer)
returns boolean language sql immutable set search_path='' as $$
  select exists(
    select 1 from jsonb_array_elements(p_content->'blocks') image
    cross join lateral jsonb_array_elements(p_content->'sources') src
    where image->>'kind'='image' and image->>'mediaAssetId'=p_id::text
      and image->>'mediaVersion'=p_version::text and image->'sourceIds' ? (src->>'id')
      and src->>'kind'='record' and src->>'sha256'=src->'visual'->>'contentHash'
      and src->>'version'=src->'visual'->>'versionHash'
      and src->'visual'->>'id'=p_id::text and src->'visual'->>'version'=p_version::text
      and case src->'visual'->>'kind'
        when 'photo' then p_content->>'disclosure'='internal' and src->'visual'->'origin'->>'type'='building-photo'
        when 'map' then p_content->>'disclosure'='internal' and src->'visual'->'origin'->>'type' in ('building-locations','market-locations')
        when 'stacking-plan' then p_content->>'disclosure'='restricted' and src->'visual'->'origin'->>'type'='stacking-snapshot'
        else false end
  )
$$;

-- Existing library images and team media still use the original media table.
create or replace function private.pitch_content_media(p_content jsonb)
returns table(id uuid,version integer) language sql immutable set search_path='' as $$
  select (b->>'mediaAssetId')::uuid,(b->>'mediaVersion')::integer
  from jsonb_array_elements(p_content->'blocks') b where b->>'kind'='image'
    and not private.pitch_visual_image_bound(p_content,(b->>'mediaAssetId')::uuid,(b->>'mediaVersion')::integer)
  union
  select (m->>'mediaAssetId')::uuid,(m->>'mediaVersion')::integer
  from jsonb_array_elements(p_content->'blocks') b
  cross join lateral jsonb_array_elements(case when b->>'kind'='team' then b->'members' else '[]'::jsonb end) m
  where m ? 'mediaAssetId'
$$;
revoke all on function private.pitch_visual_image_bound(jsonb,uuid,integer),private.pitch_content_media(jsonb)
  from public,anon,authenticated,service_role;

-- Newer delivery checks scene images as well as content images. Omit only
-- items with an exact image receipt. Their archived pins are separately rechecked.
do $$
begin
  if to_regprocedure('private.pitch_delivery_dependencies(public.pitch_project_slides,boolean)') is not null then
    execute $definition$
      create or replace function private.pitch_delivery_dependencies(s public.pitch_project_slides, manual boolean)
      returns jsonb language sql stable set search_path='' as $body$
        select jsonb_build_object(
          'assetId',s.asset_id,'assetVersion',s.asset_version,'manual',manual,
          'disclosure',s.content->>'disclosure','testData',s.content->'isTestData',
          'stackingAppendix',coalesce(
            s.content->>'disclosure'='restricted'
            and jsonb_array_length(s.content->'sources')=1
            and s.content->'sources'->0->'visual'->>'kind'='stacking-plan'
            and s.content->'sources'->0->'visual'->'origin'->>'type'='stacking-snapshot'
            and (select count(*) from jsonb_array_elements(s.content->'blocks') b where b->>'kind'='image')=1
            and not exists(select 1 from jsonb_array_elements(s.content->'blocks') b where b->>'kind' not in ('image','paragraph'))
            and private.pitch_visual_image_bound(s.content,
              (s.content->'sources'->0->'visual'->>'id')::uuid,(s.content->'sources'->0->'visual'->>'version')::integer),
            false),
          'media',coalesce((select jsonb_agg(to_jsonb(m) order by m.id,m.version) from (
            select id,version from private.pitch_content_media(s.content)
            union
            select (e->>'mediaAssetId')::uuid,(e->>'mediaVersion')::integer
            from jsonb_array_elements(s.scene->'elements') e where e->>'kind'='image'
              and not private.pitch_visual_image_bound(s.content,(e->>'mediaAssetId')::uuid,(e->>'mediaVersion')::integer)
          ) m),'[]'::jsonb)
        )
      $body$
    $definition$;
  end if;
  if to_regprocedure('private.pitch_delivery_blockers(uuid,uuid,text,jsonb)') is not null then
    alter function private.pitch_delivery_blockers(uuid,uuid,text,jsonb) rename to pitch_delivery_blockers_before_visuals;
    execute $definition$
      create function private.pitch_delivery_blockers(p_actor uuid,p_session uuid,audience text,dependencies jsonb)
      returns text[] language plpgsql security definer set search_path='' as $body$
      declare reasons text[]; administrator boolean;
      begin
        reasons:=private.pitch_delivery_blockers_before_visuals(p_actor,p_session,audience,dependencies);
        if audience='internal' and dependencies->>'stackingAppendix'='true'
          and to_regprocedure('private.ai_admin_session_authority(uuid,uuid)') is not null then
          execute 'select private.ai_admin_session_authority($1,$2)' into administrator using p_actor,p_session;
          if administrator is true then reasons:=array_remove(reasons,'restricted'); end if;
        end if;
        return reasons;
      end $body$
    $definition$;
    revoke all on function private.pitch_delivery_blockers(uuid,uuid,text,jsonb),
      private.pitch_delivery_blockers_before_visuals(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
  end if;
end $$;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_visual_capabilities;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; authority jsonb; administrator boolean; history jsonb; available jsonb;
begin
  result:=private.pitch_studio_access_before_visual_capabilities(p_actor,p_session,p_input);
  if p_input->>'action' is distinct from 'workspace_capabilities'
    or result->>'buildingSearch' is distinct from 'true'
    or to_regprocedure('private.ai_query_authority(uuid,uuid,uuid)') is null then return result; end if;
  execute 'select private.ai_query_authority($1,$1,$2)' into authority using p_actor,p_session;
  if authority->>'allowed' is distinct from 'true' or not coalesce(authority->'capabilities' ? 'export:internal',false) then return result; end if;
  available:=result->'allowedDynamic' || '["competition-map"]'::jsonb;
  if to_regprocedure('private.ai_admin_session_authority(uuid,uuid)') is not null
    and to_regprocedure('private.ai_business_research_snapshot(uuid,uuid,uuid,jsonb)') is not null then
    execute 'select private.ai_admin_session_authority($1,$2)' into administrator using p_actor,p_session;
    if administrator is true then
      execute 'select private.ai_business_research_snapshot($1,$1,$2,$3)' into history
        using p_actor,p_session,'{"tool":"capabilities"}'::jsonb;
      if history->>'allowed'='true' and history->>'export'='true' and history->'modules' ? 'stacking' then
        available:=available || '["stacking-plan"]'::jsonb;
      end if;
    end if;
  end if;
  return jsonb_set(result,'{allowedDynamic}',available);
end $$;
revoke all on function private.pitch_studio_access(uuid,uuid,jsonb),
  private.pitch_studio_access_before_visual_capabilities(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;

commit;
