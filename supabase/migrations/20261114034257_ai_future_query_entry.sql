-- Owner-only archive admission for either independent resource domain; no grants/activation.
begin;
create or replace function private.ai_query_result_read(p_actor uuid,p_effective uuid,p_session uuid,p_request_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; s private.ai_query_audit_streams; n bigint; bytes bigint; outcome text:='denied'; result jsonb;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' then a:=private.ai_query_future_authority(p_actor,p_effective,p_session);end if;
  if a->>'allowed'='true' and p_action in ('status','archive') then
    select * into s from private.ai_query_audit_streams where request_id=p_request_id
      and actor_id=p_actor and effective_user_id=p_effective for share;
    if found then
      select count(*),coalesce(sum(octet_length(cipher::text)),0) into n,bytes
        from (select cipher from private.ai_query_audit_events where request_id=p_request_id order by sequence limit 2049) e;
      outcome:='unavailable';
      if n between 1 and 2048 and bytes<=64*1024*1024
        and s.state=(select kind from private.ai_query_audit_events where request_id=p_request_id
          and kind in ('received','running','succeeded','failed','denied','cancelled') order by sequence desc limit 1)
        and private.ai_query_audit_verify(p_request_id,s.head_hash,s.head_sequence) then
        outcome:='allowed';
        result:=jsonb_build_object('allowed',true,'state',s.state,'permission_revision',a->>'permission_revision',
          'head_sequence',s.head_sequence,'head_hash',s.head_hash,
          'events',case when p_action='archive' and s.state='succeeded' then
            (select jsonb_agg(to_jsonb(e) order by sequence) from private.ai_query_audit_events e where request_id=p_request_id)
            else '[]'::jsonb end);
      end if;
    end if;
  end if;
  insert into private.ai_query_result_access(actor_id,effective_user_id,session_id,request_id,action,outcome,permission_revision)
    values(p_actor,p_effective,p_session,p_request_id,case when p_action='status' then 'status' else 'archive' end,outcome,a->>'permission_revision');
  return coalesce(result,jsonb_build_object('allowed',false,'unavailable',outcome='unavailable'));
end $$;
commit;
