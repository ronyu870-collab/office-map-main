-- User decision 2026-11-13: every AI user must be a current canonical admin.
-- Existing independent feature/data/export/audit grants remain necessary.
-- Do not seed accounts or change historical migrations.
begin;
create or replace function private.ai_query_authority(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.ai_query_control; a private.ai_query_grants; e private.ai_query_grants; ar text; er text;
  caps text[]; fs text[]; markets text[]; buildings uuid[]; all_markets boolean; all_entities boolean; revision text;
begin
  select * into c from private.ai_query_control where singleton for share;
  if not found or not c.enabled then return jsonb_build_object('allowed',false); end if;
  -- Serialize account/role/session/grant revocation with this transaction's reads.
  perform 1 from auth.users u join public.user_roles r on r.user_id=u.id
    where u.id in (p_actor,p_effective) order by u.id for share of u,r;
  select r.role into ar from public.user_roles r join auth.users u on u.id=r.user_id
    where u.id=p_actor and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp());
  select r.role into er from public.user_roles r join auth.users u on u.id=r.user_id
    where u.id=p_effective and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp());
  if ar is null or er is null or ar<>'admin' or er<>'admin' or p_actor is distinct from p_effective then return jsonb_build_object('allowed',false); end if;
  perform 1 from auth.sessions s where s.id=p_session and s.user_id=p_actor
    and (s.not_after is null or s.not_after>clock_timestamp()) for share;
  if not found then return jsonb_build_object('allowed',false); end if;
  perform 1 from private.ai_query_grants where user_id in (p_actor,p_effective) order by user_id for share;
  select * into a from private.ai_query_grants where user_id=p_actor and enabled and valid_until>clock_timestamp();
  select * into e from private.ai_query_grants where user_id=p_effective and enabled and valid_until>clock_timestamp();
  if a.user_id is null or e.user_id is null then return jsonb_build_object('allowed',false); end if;
  select coalesce(array_agg(v order by v),'{}') into caps from (select unnest(a.capabilities) v intersect select unnest(e.capabilities)) t;
  select coalesce(array_agg(v order by v),'{}') into fs from (select unnest(a.fields) v intersect select unnest(e.fields)) t;
  all_markets:=a.all_submarkets and e.all_submarkets;
  all_entities:=a.all_buildings and e.all_buildings;
  if a.all_submarkets then markets:=e.submarkets;
  elsif e.all_submarkets then markets:=a.submarkets;
  else select coalesce(array_agg(v order by v),'{}') into markets from (select unnest(a.submarkets) v intersect select unnest(e.submarkets)) t; end if;
  if a.all_buildings then buildings:=e.building_ids;
  elsif e.all_buildings then buildings:=a.building_ids;
  else select coalesce(array_agg(v order by v),'{}') into buildings from (select unnest(a.building_ids) v intersect select unnest(e.building_ids)) t; end if;
  if not ('query:catalog'=any(caps)) or (not all_markets and cardinality(markets)=0) or (not all_entities and cardinality(buildings)=0) then return jsonb_build_object('allowed',false); end if;
  revision:=encode(sha256(convert_to(jsonb_build_array('admin-only/1',c.revision,a.revision,e.revision,ar,er)::text,'UTF8')),'hex');
  return jsonb_build_object('allowed',true,'access_policy','admin-only/1','actor_id',p_actor,'effective_user_id',p_effective,'session_id',p_session,
    'policy_version',c.policy_version,'permission_revision',revision,'capabilities',caps,'fields',fs,
    'all_submarkets',all_markets,'submarkets',markets,'all_buildings',all_entities,'building_ids',buildings);
end $$;

create or replace function private.ai_audit_console_authority(p_actor uuid,p_effective uuid,p_session uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare revision uuid;
begin
  if p_actor is null or p_actor is distinct from p_effective then return null;end if;
  perform 1 from auth.users u join public.user_roles r on r.user_id=u.id where u.id=p_actor
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
    and r.role='admin' for share of u,r;
  if not found then return null;end if;
  perform 1 from auth.sessions s where s.id=p_session and s.user_id=p_actor
    and (s.not_after is null or s.not_after>clock_timestamp()) for share;
  if not found then return null;end if;
  select g.revision into revision from private.ai_audit_read_grants g
    where g.user_id=p_actor and g.valid_until>clock_timestamp() for share;
  return revision;
end $$;

create or replace function private.ai_audit_console_read(p_actor uuid,p_effective uuid,p_session uuid,p_access_id uuid,
  p_filter jsonb,p_content_digest text,p_cipher jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare rev uuid; action text; outcome text:='denied'; records jsonb:='[]'; record_ids uuid[]:='{}';
  s private.ai_query_audit_streams; stream jsonb; has_more boolean:=false; f timestamptz; t timestamptz;
  before_time timestamptz; before_id uuid; who uuid; target uuid; status_filter text; entry_filter text;
  n bigint; bytes bigint;
begin
  perform private.ai_audit_check_cipher(p_cipher);
  action:=case when p_filter->>'action' in ('list','intake','stream') then p_filter->>'action' else 'invalid' end;
  rev:=private.ai_audit_console_authority(p_actor,p_effective,p_session);
  if rev is not null and action<>'invalid' then
    outcome:='allowed';
    if action='list' then
      f:=(p_filter->>'from')::timestamptz;t:=(p_filter->>'to')::timestamptz;
      before_time:=(p_filter->>'beforeTime')::timestamptz;before_id:=(p_filter->>'beforeId')::uuid;
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
      ), page as materialized (
        select * from candidates c where c.occurred_at>=f and c.occurred_at<t
          and (who is null or c.actor_id=who) and (status_filter is null or c.related_state=status_filter)
          and (entry_filter is null or c.entry=entry_filter)
          and (before_time is null or (c.occurred_at,c.record_id)<(before_time,before_id))
        order by occurred_at desc,record_id desc limit 51
      ) select coalesce(jsonb_agg(to_jsonb(p) order by occurred_at desc,record_id desc),'[]'),coalesce(array_agg(record_id order by occurred_at desc,record_id desc),'{}'),count(*)>50
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
  return jsonb_build_object('allowed',true,'access_policy','admin-only/1','revision',rev,'records',records,'stream',stream,'has_more',has_more);
end $$;

create or replace function private.ai_audit_console_prepare(p_actor uuid,p_effective uuid,p_session uuid,p_access_id uuid,
  p_parent uuid,p_returned uuid[],p_response_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rev uuid; prior private.ai_audit_console_access; allowed boolean:=false;
begin
  rev:=private.ai_audit_console_authority(p_actor,p_effective,p_session);
  select * into prior from private.ai_audit_console_access where access_id=p_parent;
  allowed:=rev is not null and prior.grant_revision=rev and prior.outcome='allowed' and prior.action<>'prepare'
    and prior.actor_id=p_actor and prior.effective_user_id=p_effective and prior.session_id=p_session
    and p_returned is not null and cardinality(p_returned)<=50 and p_returned<@prior.record_ids;
  insert into private.ai_audit_console_access(access_id,parent_access_id,actor_id,effective_user_id,session_id,action,outcome,grant_revision,record_ids,response_digest)
    values(p_access_id,prior.access_id,p_actor,p_effective,p_session,'prepare',case when coalesce(allowed,false) then 'allowed' else 'denied' end,
      rev,case when coalesce(allowed,false) then p_returned else '{}'::uuid[] end,p_response_digest);
  return jsonb_build_object('allowed',coalesce(allowed,false),'access_policy','admin-only/1');
end $$;
commit;
