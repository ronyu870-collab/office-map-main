begin;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_share_email;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  project_id uuid;
  address text;
  recipients uuid[];
begin
  if p_input->>'action'='workspace_share_create' and p_input?'recipientEmail' then
    project_id:=(p_input->>'projectId')::uuid;
    address:=lower(btrim(p_input->>'recipientEmail'));
    if p_input?'recipientId' or private.pitch_project_visible(p_actor,p_session,project_id,'generate') is not true
      or not exists(select 1 from public.pitch_projects p where p.id=project_id and p.created_by=p_actor)
    then raise exception 'PITCH_DENIED' using errcode='42501';end if;

    -- GoTrue stores normalized addresses. Use its email index and require one active,
    -- verified account even on deployments that permit a duplicate email address.
    select array_agg(u.id) into recipients from auth.users u
      where u.email=address and u.email_confirmed_at is not null
        and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp());
    if cardinality(recipients) is distinct from 1 or recipients[1]=p_actor then
      raise exception 'PITCH_DENIED' using errcode='42501';
    end if;
    p_input:=(p_input-'recipientEmail') || jsonb_build_object('recipientId',recipients[1]);
  end if;
  return private.pitch_studio_access_before_share_email(p_actor,p_session,p_input);
end $$;

revoke all on function private.pitch_studio_access_before_share_email(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;

commit;
