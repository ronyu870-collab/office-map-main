-- Current trusted directory labels only. Never backfill historical actor snapshots.
-- Reads remain within the admin + independent audit grant transaction and its access ledger.
begin;
create or replace function private.ai_audit_console_read(p_actor uuid,p_effective uuid,p_session uuid,p_access_id uuid,
  p_filter jsonb,p_content_digest text,p_cipher jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare rev uuid; action text; outcome text:='denied'; records jsonb:='[]'; record_ids uuid[]:='{}';
  s private.ai_query_audit_streams; stream jsonb; has_more boolean:=false; f timestamptz; t timestamptz;
  before_time timestamptz; before_id uuid; who uuid; target uuid; status_filter text; entry_filter text;
  n bigint; bytes bigint; actor_search text;
begin
  perform private.ai_audit_check_cipher(p_cipher);
  action:=case when p_filter->>'action' in ('list','intake','stream') then p_filter->>'action' else 'invalid' end;
  rev:=private.ai_audit_console_authority(p_actor,p_effective,p_session);
  if rev is not null and action<>'invalid' then
    outcome:='allowed';
    if action='list' then
      f:=(p_filter->>'from')::timestamptz;t:=(p_filter->>'to')::timestamptz;
      before_time:=(p_filter->>'beforeTime')::timestamptz;before_id:=(p_filter->>'beforeId')::uuid;
      actor_search:=nullif(btrim(p_filter->>'actorSearch'),'');
      if length(actor_search)>120 then raise exception using errcode='22023',message='invalid actor search';end if;
      who:=(p_filter->>'actorId')::uuid;status_filter:=p_filter->>'state';entry_filter:=p_filter->>'entry';
      if f is null or t is null or t<=f or t-f>interval '31 days' or t>clock_timestamp()+interval '1 minute'
        or (before_time is null)<>(before_id is null) then raise exception using errcode='22023',message='invalid audit range';end if;
      with candidates as (
        select i.event_id record_id,i.request_id,i.occurred_at,i.actor_id,coalesce(i.effective_user_id,q.effective_user_id,i.actor_id) effective_user_id,
          'intake'::text kind,coalesce(i.entry,'legacy_intake') entry,coalesce(q.state,'unstarted') related_state,
          i.cipher,i.content_digest payload_digest
          from private.ai_query_ingress_events i left join private.ai_query_audit_streams q using(request_id) where i.actor_id is not null
        union all
        select q.request_id,q.request_id,q.received_at,q.actor_id,q.effective_user_id,'stream','legacy_stream',q.state,null::jsonb,null::text
          from private.ai_query_audit_streams q where not exists(select 1 from private.ai_query_ingress_events i where i.request_id=q.request_id)
      ) , identified as (
        select c.*,nullif(concat_ws(' / ',nullif(btrim(r.chinese_name),''),
          case when btrim(r.full_name) is distinct from btrim(r.chinese_name) then nullif(btrim(r.full_name),'') end),'') actor_name,
          nullif(concat_ws(' / ',nullif(btrim(e.chinese_name),''),
          case when btrim(e.full_name) is distinct from btrim(e.chinese_name) then nullif(btrim(e.full_name),'') end),'') effective_name
        from candidates c
        left join auth.users u on u.id=c.actor_id and u.deleted_at is null
        left join public.user_roles r on r.user_id=u.id
        left join auth.users eu on eu.id=c.effective_user_id and eu.deleted_at is null
        left join public.user_roles e on e.user_id=eu.id
      ), page as materialized (
        select c.* from identified c where c.occurred_at>=f and c.occurred_at<t
          and (who is null or c.actor_id=who)
          and (actor_search is null or position(lower(actor_search) in lower(coalesce(c.actor_name,'')))>0) and (status_filter is null or c.related_state=status_filter)
          and (entry_filter is null or c.entry=entry_filter)
          and (before_time is null or (c.occurred_at,c.record_id)<(before_time,before_id))
        order by occurred_at desc,record_id desc limit 51
      ) select coalesce(jsonb_agg((to_jsonb(p)-'actor_name'-'effective_name')||jsonb_build_object('actor_name',left(p.actor_name,160),'actor_name_truncated',coalesce(length(p.actor_name)>160,false),'effective_name',left(p.effective_name,160),'effective_name_truncated',coalesce(length(p.effective_name)>160,false)) order by occurred_at desc,record_id desc),'[]'),coalesce(array_agg(record_id order by occurred_at desc,record_id desc),'{}'),count(*)>50
        into records,record_ids,has_more from page p;
      -- Legacy stream text is read only after complete chain verification.
      for s in select q.* from private.ai_query_audit_streams q where q.request_id=any(record_ids) loop
        if s.head_sequence between 1 and 2048 and private.ai_query_audit_verify(s.request_id,s.head_hash,s.head_sequence) then
          records:=(select jsonb_agg(case when x->>'kind'='stream' and x->>'request_id'=s.request_id::text then
            x||jsonb_build_object('cipher',e.cipher,'payload_digest',e.payload_digest,'event_id',e.event_id) else x end order by ord)
            from jsonb_array_elements(records) with ordinality a(x,ord)
            left join private.ai_query_audit_events e on e.request_id=s.request_id and e.sequence=1);
        end if;
      end loop;
      if has_more then records:=records-50;record_ids:=record_ids[1:50];end if;
    elsif action='intake' then
      target:=(p_filter->>'id')::uuid;
      select coalesce(jsonb_agg(to_jsonb(i)),'[]'),coalesce(array_agg(event_id),'{}') into records,record_ids
        from private.ai_query_ingress_events i where i.event_id=target and i.actor_id is not null;
    else
      target:=(p_filter->>'id')::uuid;
      select * into s from private.ai_query_audit_streams where request_id=target for share;
      if found then
        select count(*),coalesce(sum(octet_length(cipher::text)),0) into n,bytes
          from (select cipher from private.ai_query_audit_events where request_id=target order by sequence limit 2049) e;
        if n between 1 and 2048 and bytes<=64*1024*1024
          and s.state=(select kind from private.ai_query_audit_events where request_id=target and kind in ('received','running','succeeded','failed','denied','cancelled') order by sequence desc limit 1)
          and private.ai_query_audit_verify(target,s.head_hash,s.head_sequence) then
          stream:=to_jsonb(s);record_ids:=array[target];
          select jsonb_agg(to_jsonb(e) order by sequence) into records from private.ai_query_audit_events e where request_id=target;
        else outcome:='unavailable';end if;
      end if;
    end if;
  end if;
  insert into private.ai_audit_console_access(access_id,actor_id,effective_user_id,session_id,action,outcome,grant_revision,content_digest,cipher,record_ids)
    values(p_access_id,p_actor,p_effective,p_session,action,outcome,rev,p_content_digest,p_cipher,record_ids);
  if outcome<>'allowed' then return jsonb_build_object('allowed',false,'unavailable',outcome='unavailable');end if;
  return jsonb_build_object('allowed',true,'access_policy','admin-only/1','directory_policy','audit-actors/1','directory_as_of',statement_timestamp(),'revision',rev,'records',records,'stream',stream,'has_more',has_more);
end $$;

commit;
