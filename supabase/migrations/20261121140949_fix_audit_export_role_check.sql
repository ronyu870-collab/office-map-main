begin;
set local lock_timeout='5s';
set local statement_timeout='45s';

-- Avoid SQL CURRENT_ROLE: it names the database role, not the actor profile.
create or replace function public.audit_complete_operation(p_id uuid,p_state text,p_details jsonb default '{}') returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.audit_operation_receipts; v_actor_role text;
begin
  if p_state is null or p_state not in ('success','failed') then raise exception 'invalid outcome' using errcode='22023'; end if;
  if p_details is not null and jsonb_typeof(p_details)<>'object' then raise exception 'invalid details' using errcode='22023';end if;
  select * into r from public.audit_operation_receipts where id=p_id for update;
  if not found then raise exception 'unknown operation' using errcode='22023'; end if;
  if r.state<>'pending' then
    if r.state<>p_state then raise exception 'outcome conflict' using errcode='22023'; end if;
    return true;
  end if;
  if p_state='success' and r.action_type in ('AUDIT_EXPORT','EXPORT_LEASE_TRANSACTIONS','EXPORT_DATA','EXPORT_BACKUP') then
    select role into v_actor_role from public.user_roles where user_id::text=r.actor_id for share;
    if v_actor_role is distinct from 'admin' then raise exception 'export permission revoked' using errcode='42501';end if;
  end if;
  insert into public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,target_name,old_values,new_values,event_id,details)
  values(r.actor_id,r.action_type,'server',r.module,r.target_table,coalesce(p_details->>'target_id',r.target_id),p_details->>'target_name',p_details->'old_values',p_details->'new_values',r.id::text,
    r.details || (coalesce(p_details,'{}'::jsonb)-'old_values'-'new_values'-'target_name') || jsonb_strip_nulls(jsonb_build_object('business_outcome',p_details->>'outcome')) || jsonb_build_object('outcome',p_state,'operation_id',r.id,'schema_version',3,'evidence','server_confirmed'));
  update public.audit_operation_receipts set state=p_state,completed_at=now(),details=r.details||coalesce(p_details,'{}'::jsonb) where id=p_id;
  return true;
end $$;
revoke all on function public.audit_complete_operation(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.audit_complete_operation(uuid,text,jsonb) to service_role;

commit;
