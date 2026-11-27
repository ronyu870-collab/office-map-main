begin;

alter function private.pitch_delivery_dependencies(public.pitch_project_slides,boolean)
  rename to pitch_delivery_dependencies_before_stacking_annotation;

create function private.pitch_delivery_dependencies(s public.pitch_project_slides, manual boolean)
returns jsonb language plpgsql stable set search_path='' as $$
declare dependencies jsonb; source_rows jsonb; candidate public.pitch_project_slides:=s;
begin
  dependencies:=private.pitch_delivery_dependencies_before_stacking_annotation(s,manual);
  if manual is distinct from true or dependencies->>'disclosure' is distinct from 'restricted'
    or dependencies->>'stackingAppendix' is distinct from 'false' then
    return dependencies;
  end if;

  -- The workspace records a title or note as an authoring source in the header.
  -- Evidence blocks must still cite only their pinned historical source.
  select coalesce(jsonb_agg(src order by ordinal),'[]'::jsonb) into source_rows
  from jsonb_array_elements(s.content->'sources') with ordinality sources(src,ordinal)
  where not coalesce(src->>'kind'='record' and not src?'visual'
    and src->>'recordId'='workspace:'||s.project_id::text
    and src->>'label'='用户输入 · 未经业务数据核验'
    and src->>'locator'='页面正文编辑'
    and not exists(select 1 from jsonb_array_elements(s.content->'blocks') b where b->'sourceIds' ? (src->>'id')),false);

  if jsonb_array_length(source_rows)<>1
    or source_rows is not distinct from s.content->'sources' then return dependencies;end if;
  candidate.content:=jsonb_set(s.content,'{sources}',source_rows);
  if private.pitch_delivery_dependencies_before_stacking_annotation(candidate,manual)->>'stackingAppendix'='true' then
    return jsonb_set(dependencies,'{stackingAppendix}','true'::jsonb);
  end if;
  return dependencies;
end $$;

revoke all on function private.pitch_delivery_dependencies_before_stacking_annotation(public.pitch_project_slides,boolean),
  private.pitch_delivery_dependencies(public.pitch_project_slides,boolean) from public,anon,authenticated,service_role;
commit;
