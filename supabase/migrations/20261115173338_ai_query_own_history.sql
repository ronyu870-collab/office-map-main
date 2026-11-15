-- Own work history indexes original encrypted audit streams. No query/result body
-- is duplicated; titles are application-encrypted. No grants or business rows change.
begin;
create table private.ai_query_history_threads (
  actor_id uuid not null, effective_user_id uuid not null, conversation_id uuid not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  last_request_id uuid not null references private.ai_query_audit_streams(request_id),
  title_event_id uuid, title_cipher jsonb, archived boolean not null default false,
  primary key(actor_id,effective_user_id,conversation_id),
  check(actor_id=effective_user_id), check((title_event_id is null)=(title_cipher is null))
);
create table private.ai_query_history_index (
  request_id uuid primary key references private.ai_query_audit_streams(request_id),
  actor_id uuid not null, effective_user_id uuid not null, conversation_id uuid,
  submitted_at timestamptz not null,
  unreadable boolean not null default false, indexed_at timestamptz not null default clock_timestamp(),
  check(actor_id=effective_user_id),
  foreign key(actor_id,effective_user_id,conversation_id)
    references private.ai_query_history_threads(actor_id,effective_user_id,conversation_id)
);
create table private.ai_query_history_access (
  id bigint generated always as identity primary key, actor_id uuid not null, effective_user_id uuid not null,
  session_id uuid not null, occurred_at timestamptz not null default clock_timestamp(), action text not null,
  conversation_id uuid, request_id uuid, outcome text not null, permission_revision text
);
create index ai_query_history_order on private.ai_query_history_threads(actor_id,effective_user_id,archived,updated_at desc,conversation_id desc);
create index ai_query_history_turn_order on private.ai_query_history_index(actor_id,effective_user_id,conversation_id,submitted_at desc,request_id desc);
create index ai_query_history_owner_candidates on private.ai_query_audit_streams(actor_id,effective_user_id,received_at desc,request_id desc);
alter table private.ai_query_history_threads enable row level security;
alter table private.ai_query_history_index enable row level security;
alter table private.ai_query_history_access enable row level security;
revoke all on private.ai_query_history_threads,private.ai_query_history_index,private.ai_query_history_access from public,anon,authenticated,service_role;
revoke all on sequence private.ai_query_history_access_id_seq from public,anon,authenticated,service_role;

create function private.ai_query_history(p_actor uuid,p_effective uuid,p_session uuid,p_revision text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare a jsonb; act text; cid uuid; rid uuid; s private.ai_query_audit_streams;
  result jsonb; records jsonb; more boolean:=false; outcome text:='denied';
  before_time timestamptz; before_id uuid; thread private.ai_query_history_threads; item jsonb; indexed jsonb;
begin
  a:=private.ai_query_authority(p_actor,p_effective,p_session);
  act:=p_input->>'action';
  if p_actor=p_effective and a->>'allowed'='true' and a->>'permission_revision'=p_revision
    and a->'capabilities' ? 'query:catalog' and jsonb_typeof(p_input)='object'
    and octet_length(p_input::text)<=8192 and act in ('record','ignore','index','candidates','list','turns','rename','archive','locate') then
    cid:=(p_input->>'conversationId')::uuid;rid:=(p_input->>'requestId')::uuid;
    before_time:=(p_input->>'beforeTime')::timestamptz;before_id:=(p_input->>'beforeId')::uuid;
    if (before_time is null)<>(before_id is null) then raise exception using errcode='22023',message='invalid history cursor'; end if;
    outcome:='allowed';
    if act='index' then
      if jsonb_typeof(p_input->'records')<>'array' or jsonb_array_length(p_input->'records')>25 then raise exception using errcode='22023',message='invalid history index'; end if;
      for item in select value from jsonb_array_elements(p_input->'records') loop
        indexed:=private.ai_query_history(p_actor,p_effective,p_session,p_revision,item||jsonb_build_object('action',case when item->>'conversationId' is null then 'ignore' else 'record' end));
        if indexed->>'allowed' is distinct from 'true' then raise exception using errcode='42501',message='history index denied'; end if;
      end loop;
    elsif act in ('record','ignore') then
      select * into s from private.ai_query_audit_streams where request_id=rid and actor_id=p_actor and effective_user_id=p_effective for share;
      if not found or not s.identity_valid then outcome:='denied';
      elsif act='record' and cid is null then outcome:='denied';
      elsif exists(select 1 from private.ai_query_history_index i where i.request_id=rid and not i.unreadable and i.conversation_id is distinct from cid) then outcome:='denied';
      else
        if act='record' then
          insert into private.ai_query_history_threads(actor_id,effective_user_id,conversation_id,created_at,updated_at,last_request_id)
            values(p_actor,p_effective,cid,s.received_at,s.received_at,rid)
          on conflict(actor_id,effective_user_id,conversation_id) do update set
            created_at=least(ai_query_history_threads.created_at,excluded.created_at),
            updated_at=greatest(ai_query_history_threads.updated_at,excluded.updated_at),
            last_request_id=case when (select received_at from private.ai_query_audit_streams where request_id=ai_query_history_threads.last_request_id)<=excluded.updated_at
              then excluded.last_request_id else ai_query_history_threads.last_request_id end;
        end if;
        insert into private.ai_query_history_index(request_id,actor_id,effective_user_id,conversation_id,submitted_at,unreadable,indexed_at)
          values(rid,p_actor,p_effective,case when act='record' then cid else null end,s.received_at,
            act='ignore' and coalesce((p_input->>'unreadable')::boolean,false),clock_timestamp())
          on conflict(request_id) do update set conversation_id=excluded.conversation_id,unreadable=excluded.unreadable,indexed_at=excluded.indexed_at
          where ai_query_history_index.unreadable;
      end if;
    elsif act='locate' then
      select conversation_id into cid from private.ai_query_history_index where request_id=rid and actor_id=p_actor and effective_user_id=p_effective and conversation_id is not null;
      if not found then outcome:='denied'; else result:=jsonb_build_object('conversationId',cid); end if;
    elsif act='candidates' then
      with candidates as materialized (
        select q.* from private.ai_query_audit_streams q where q.actor_id=p_actor and q.effective_user_id=p_effective
          and q.identity_valid and not exists(select 1 from private.ai_query_history_index i where i.request_id=q.request_id
            and (not i.unreadable or i.indexed_at>clock_timestamp()-interval '15 minutes'))
          order by q.received_at desc,q.request_id desc limit 26
      ), page as (select * from candidates order by received_at desc,request_id desc limit 25)
      select coalesce(jsonb_agg(jsonb_build_object('requestId',q.request_id,'submittedAt',q.received_at,'state',q.state,
        'event',case when private.ai_query_audit_verify(q.request_id,q.head_hash,q.head_sequence) then
          (select to_jsonb(e) from private.ai_query_audit_events e where e.request_id=q.request_id and e.sequence=1 and e.kind='received') else null end)
        order by q.received_at desc,q.request_id desc),'[]'::jsonb), (select count(*)>25 from candidates) into records,more from page q;
      result:=jsonb_build_object('records',records,'hasMore',more);
    elsif act='list' then
      with candidates as materialized (
        select t.* from private.ai_query_history_threads t where t.actor_id=p_actor and t.effective_user_id=p_effective
          and t.archived=coalesce((p_input->>'archived')::boolean,false)
          and (before_time is null or (t.updated_at,t.conversation_id)<(before_time,before_id))
          order by t.updated_at desc,t.conversation_id desc limit 16
      ), page as(select * from candidates order by updated_at desc,conversation_id desc limit 15)
      select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc,t.conversation_id desc),'[]'::jsonb),
        (select count(*)>15 from candidates) into records,more from page t;
      result:=jsonb_build_object('records',records,'hasMore',more,'unreadable',
        (select count(*) from private.ai_query_history_index where actor_id=p_actor and effective_user_id=p_effective and unreadable));
    else
      select * into thread from private.ai_query_history_threads where actor_id=p_actor and effective_user_id=p_effective and conversation_id=cid for update;
      if not found then outcome:='denied';
      elsif act='turns' then
        if rid is not null and not exists(select 1 from private.ai_query_history_index where request_id=rid and actor_id=p_actor and effective_user_id=p_effective and conversation_id=cid) then outcome:='denied';
        else
          with candidates as materialized (
            select i.request_id,i.submitted_at,q.state from private.ai_query_history_index i join private.ai_query_audit_streams q using(request_id)
              where i.actor_id=p_actor and i.effective_user_id=p_effective and i.conversation_id=cid
              and (before_time is null or (i.submitted_at,i.request_id)<(before_time,before_id))
              order by i.submitted_at desc,i.request_id desc limit 11
          ), page as (select * from candidates order by submitted_at desc,request_id desc limit 10)
          select coalesce(jsonb_agg(to_jsonb(q) order by q.submitted_at desc,q.request_id desc),'[]'::jsonb),
            (select count(*)>10 from candidates) into records,more from page q;
          result:=jsonb_build_object('thread',to_jsonb(thread),'records',records,'hasMore',more,'selected',
            (select jsonb_build_object('request_id',i.request_id,'submitted_at',i.submitted_at) from private.ai_query_history_index i
              where i.request_id=coalesce(rid,(records->0->>'request_id')::uuid) and i.actor_id=p_actor and i.effective_user_id=p_effective and i.conversation_id=cid));
        end if;
      elsif act='rename' then
        perform private.ai_audit_check_cipher(p_input->'titleCipher');
        update private.ai_query_history_threads set title_event_id=(p_input->>'titleEventId')::uuid,title_cipher=p_input->'titleCipher'
          where actor_id=p_actor and effective_user_id=p_effective and conversation_id=cid;
      elsif act='archive' then
        if jsonb_typeof(p_input->'archived') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid archive state'; end if;
        update private.ai_query_history_threads set archived=(p_input->>'archived')::boolean
          where actor_id=p_actor and effective_user_id=p_effective and conversation_id=cid;
      end if;
    end if;
  end if;
  insert into private.ai_query_history_access(actor_id,effective_user_id,session_id,action,conversation_id,request_id,outcome,permission_revision)
    values(p_actor,p_effective,p_session,coalesce(act,'invalid'),cid,rid,outcome,a->>'permission_revision');
  if outcome<>'allowed' then return jsonb_build_object('allowed',false); end if;
  return jsonb_build_object('allowed',true,'permissionRevision',p_revision)||coalesce(result,'{}'::jsonb);
end $$;
create function public.ai_query_history(p_actor uuid,p_effective uuid,p_session uuid,p_revision text,p_input jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_query_history(p_actor,p_effective,p_session,p_revision,p_input) $$;
revoke all on function private.ai_query_history(uuid,uuid,uuid,text,jsonb),public.ai_query_history(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_history(uuid,uuid,uuid,text,jsonb),public.ai_query_history(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
