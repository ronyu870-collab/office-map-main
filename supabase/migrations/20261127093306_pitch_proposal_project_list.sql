begin;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_proposal_list;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_input->>'action' is distinct from 'workspace_list' then
    return private.pitch_studio_access_before_proposal_list(p_actor,p_session,p_input);
  end if;
  perform private.pitch_studio_access_before_proposal_list(p_actor,p_session,'{"action":"catalog"}');
  if not private.pitch_access(p_actor,p_session,null,null,null,null,'read') then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(item)) from (
    select p.id,p.title,p.version,p.state,p.updated_at,p.is_test_data,w.deleted_at,
      (select count(*) from public.pitch_project_slides s where s.project_id=p.id) page_count
    from public.pitch_projects p
    left join public.pitch_workspace_states w on w.project_id=p.id
    where p.created_by=p_actor and private.pitch_access(p_actor,p_session,p.organization_id,p.region,p.city,p.business_line,'read')
      -- Ordinary workspace workers generate a private intermediate source.
      -- A completed proposal uses the same receipt field for its final project.
      and not exists(select 1 from private.pitch_workspace_tasks t where t.source_project_id=p.id
        and (t.workflow<>'proposal' or t.state<>'completed' or not private.pitch_project_visible(p_actor,p_session,p.id)))
      and (case p_input->>'filter' when 'deleted' then w.deleted_at is not null
        when 'archived' then p.state='archived' and w.deleted_at is null
        else p.state<>'archived' and w.deleted_at is null end)
      and (coalesce(p_input->>'q','')='' or strpos(lower(p.title),lower(p_input->>'q'))>0)
    order by p.updated_at desc,p.id limit 31 offset least(10000,coalesce((p_input->>'offset')::integer,0))
  ) item),'[]'::jsonb);
end $$;

revoke all on function private.pitch_studio_access_before_proposal_list(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
