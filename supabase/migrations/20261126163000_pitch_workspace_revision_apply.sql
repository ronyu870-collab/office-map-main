-- One trusted server operation for adopting reviewed text into an owned slide.
begin;
alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_v6;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare task private.pitch_ai_tasks;
  project_id_ uuid; slide_id_ uuid; previous public.pitch_project_slides;
  save jsonb; picked jsonb;
begin
  if p_input->>'action' is distinct from 'workspace_ai_revision_apply' then
    return private.pitch_studio_access_v6(p_actor,p_session,p_input);
  end if;
  project_id_:=(p_input->>'projectId')::uuid; slide_id_:=(p_input->>'slideId')::uuid;
  perform 1 from public.pitch_projects where id=project_id_ and created_by=p_actor for update;
  if not found then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  select * into task from private.pitch_ai_tasks where id=(p_input->>'taskId')::uuid and actor_id=p_actor for share;
  if task.id is null or task.state<>'completed' or task.request->>'task'<>'revise-text' or task.policy_revision is null then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  perform 1 from private.pitch_ai_config where id for share;
  perform 1 from private.pitch_ai_policies where asset_id=task.asset_id and asset_version=task.asset_version and mode='approved_provider' for share;
  if not found then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  perform 1 from public.pitch_content_assets a join public.pitch_asset_versions v
    on v.asset_id=a.id and v.version=task.asset_version
    where a.id=task.asset_id and not a.allow_client_export and not v.allow_client_export
      and a.disclosure='internal' and v.disclosure='internal' for share of a, v;
  if not found then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if not private.pitch_ai_authorized(p_actor,p_session,task.id) or
    not private.pitch_project_visible(p_actor,p_session,project_id_,'generate') then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  select * into previous from public.pitch_project_slides where project_id=project_id_ and id=slide_id_;
  save:=p_input->'save';
  select value into picked from jsonb_array_elements(save->'slides') where value->>'id'=slide_id_::text;
  if previous.id is null or previous.asset_id is distinct from task.asset_id or previous.asset_version is distinct from task.asset_version
    or picked is null or (picked->>'assetId')::uuid is distinct from task.asset_id
    or (picked->>'assetVersion')::integer is distinct from task.asset_version
    or picked->'content'->>'disclosure' is distinct from 'internal' then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  return private.pitch_studio_access_v6(p_actor,p_session,save||jsonb_build_object('action','workspace_save',
    'projectId',project_id_,'expectedVersion',p_input->'expectedVersion'));
end $$;
revoke all on function private.pitch_studio_access_v6(uuid,uuid,jsonb),private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
