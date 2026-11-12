begin;

-- Upgrade existing history drafts in place; source UUID alone is not a cross-table identity.
alter table public.lease_expiry_review_events drop constraint lease_expiry_review_events_source_id_fkey;
alter table public.lease_expiry_reviews drop constraint lease_expiry_reviews_source_id_fkey;
alter table public.lease_expiry_reviews drop constraint lease_expiry_reviews_pkey;
alter table public.lease_expiry_reviews
  add column source_kind text not null default 'history' check (source_kind in ('history','live')),
  add column history_source_id uuid generated always as (case when source_kind='history' then source_id end) stored,
  add column live_source_id uuid,
  add constraint lease_expiry_live_ref_check check (live_source_id is null or (source_kind='live' and live_source_id=source_id)),
  add primary key(source_kind,source_id),
  add constraint lease_expiry_history_source_fk foreign key(history_source_id) references public.lease_transactions_history(id) on delete restrict,
  add constraint lease_expiry_live_source_fk foreign key(live_source_id) references public.lease_transactions(id) on delete set null;
alter table public.lease_expiry_review_events
  add column source_kind text not null default 'history' check (source_kind in ('history','live')),
  add constraint lease_expiry_events_source_fk foreign key(source_kind,source_id) references public.lease_expiry_reviews(source_kind,source_id);
create index lease_expiry_events_source_idx on public.lease_expiry_review_events(source_kind,source_id);
create index lease_expiry_history_source_idx on public.lease_expiry_reviews(history_source_id) where history_source_id is not null;
create index lease_expiry_live_source_idx on public.lease_expiry_reviews(live_source_id) where live_source_id is not null;

create function private.lease_expiry_source_v2(p_kind text,p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',v.source_record_id,'company',v.company,'building',v.new_building,
    'period_start',v.transaction_period_start,'period_end',v.transaction_period_end,
    'period_source',v.period_source,'precision',v.transaction_time_precision,
    'lease_term_months',v.lease_term_months,'source_lease_term_raw',h.source_lease_term_raw,
    'source_file',h.source_file,'source_sheet',h.source_sheet,'source_row',h.source_row,
    'source_info_date',h.source_info_date,'quality_status',v.quality_status,
    'building_match_scope',v.building_match_scope
  ) from public.lease_transactions_read_v1 v
    left join public.lease_transactions_history h on v.record_source='history' and h.id=v.source_record_id
    where v.record_source=p_kind and v.source_record_id=p_id;
$$;

create or replace function private.lease_expiry_list_v2(
  p_actor uuid, p_as_of date, p_page integer default 1, p_query text default '', p_scope text default 'window'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.lease_expiry_assert_admin(p_actor);
  if p_as_of is null or p_as_of not between date '2000-01-01' and date '2100-12-31'
    or p_page is null or p_page not between 1 and 10000 or p_query is null or length(p_query)>100
    or p_scope is null or p_scope not in ('window','saved') then
    raise exception using errcode='22023',message='F6_INVALID_INPUT';
  end if;
  with periods as (
    select v.source_record_id id,v.record_source source_kind,true source_available,v.company,v.new_building,v.transaction_period_start,
      case when v.lease_term_months between 1 and 120 and v.lease_term_months=trunc(v.lease_term_months)
        and v.transaction_time_precision in ('date','quarter')
        then (v.transaction_period_start+make_interval(months=>v.lease_term_months::int))::date end proxy_start,
      case when v.lease_term_months between 1 and 120 and v.lease_term_months=trunc(v.lease_term_months)
        and v.transaction_time_precision in ('date','quarter')
        then (v.transaction_period_end+make_interval(months=>v.lease_term_months::int))::date end proxy_end
    from public.lease_transactions_read_v1 v where v.record_source in ('history','live')
    union all
    -- A deleted operational deal leaves a read-only note snapshot, never a live opportunity.
    select r.source_id,r.source_kind,false,r.source_snapshot->>'company',r.source_snapshot->>'building',
      null::date,null::date,null::date from public.lease_expiry_reviews r
      where p_scope='saved' and r.source_kind='live' and r.live_source_id is null
  ), filtered as (
    select p.* from periods p where
      ((p_scope='window' and p.proxy_start < (p_as_of+interval '6 months')::date and p.proxy_end>=p_as_of)
       or (p_scope='saved' and exists(select 1 from public.lease_expiry_reviews r where r.source_id=p.id and r.source_kind=p.source_kind
         and (p.source_kind='history' or (r.live_source_id is not null)=p.source_available))))
      and (p_query='' or position(lower(p_query) in lower(coalesce(p.company,'')||' '||coalesce(p.new_building,'')))>0)
  ), page as (
    select * from filtered order by proxy_start nulls last,source_kind,id limit 25 offset (p_page-1)*25
  ), items as (
    select p.id,p.source_kind,p.proxy_start,jsonb_build_object(
      'source_kind',p.source_kind,'source_available',p.source_available,
      'source',s.snapshot,'source_fingerprint',md5(s.snapshot::text),
      'proxy_start',p.proxy_start,'proxy_end',p.proxy_end,
      -- A name-based clue, never an automatic renewal decision or customer identity.
      'has_later_name_match',exists(select 1 from public.lease_transactions_read_v1 v
        where nullif(trim(p.company),'') is not null and nullif(trim(p.new_building),'') is not null
          and trim(v.company)=trim(p.company) and trim(v.new_building)=trim(p.new_building)
          and v.transaction_period_start>p.transaction_period_start),
      'review',to_jsonb(r)-'history_source_id'-'live_source_id'
    ) item from page p
      left join public.lease_expiry_reviews r on r.source_id=p.id and r.source_kind=p.source_kind
        and (p.source_kind='history' or (r.live_source_id is not null)=p.source_available)
      cross join lateral (select case when p.source_available then private.lease_expiry_source_v2(p.source_kind,p.id) else r.source_snapshot end snapshot) s
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(item order by proxy_start nulls last,source_kind,id) from items),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',25,
    'as_of',p_as_of,'window_end',(p_as_of+interval '6 months')::date) into result;
  return result;
end;
$$;

create or replace function private.lease_expiry_save_v2(
 p_actor uuid,p_source_id uuid,p_expected_revision integer,p_source_fingerprint text,p_request_id uuid,
 p_status text,p_notes text,p_evidence_reference text,p_source_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; prior jsonb; saved jsonb; body jsonb; event public.lease_expiry_review_events%rowtype;
begin
  perform private.lease_expiry_assert_admin(p_actor);
  if p_source_kind is null or p_source_kind not in ('history','live') or p_source_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0
    or p_status is null or p_status not in ('pending','missing_info','source_conflict')
    or p_notes is null or length(p_notes)>4000 or p_evidence_reference is null or length(p_evidence_reference)>1000
    or p_source_fingerprint is null or p_source_fingerprint !~ '^[0-9a-f]{32}$'
    or (p_status<>'pending' and length(trim(p_notes))=0) then
    raise exception using errcode='22023',message='F6_INVALID_INPUT';
  end if;
  body:=jsonb_build_object('source_id',p_source_id,'revision',p_expected_revision,
    'fingerprint',p_source_fingerprint,'status',p_status,'notes',p_notes,'evidence_reference',p_evidence_reference);
  -- Keep the historical body shape for retries issued before this upgrade.
  if p_source_kind='live' then body:=body||jsonb_build_object('source_kind','live'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request_id::text,0));
  select * into event from public.lease_expiry_review_events where actor_id=p_actor and request_id=p_request_id;
  if found then
    if event.request_body<>body then raise exception using errcode='P0001',message='F6_REQUEST_CONFLICT'; end if;
    return event.result||jsonb_build_object('source_kind',p_source_kind);
  end if;
  -- The source row lock also serializes the first save before a draft row exists.
  if p_source_kind='history' then
    perform 1 from public.lease_transactions_history where id=p_source_id for update;
  else
    perform 1 from public.lease_transactions where id=p_source_id for update;
  end if;
  if not found then raise exception using errcode='P0002',message='F6_SOURCE_NOT_FOUND'; end if;
  snapshot:=private.lease_expiry_source_v2(p_source_kind,p_source_id);
  if snapshot is null or md5(snapshot::text)<>p_source_fingerprint then
    raise exception using errcode='P0001',message='F6_SOURCE_CHANGED';
  end if;
  select to_jsonb(r)-'history_source_id'-'live_source_id' into prior from public.lease_expiry_reviews r where source_id=p_source_id and source_kind=p_source_kind for update;
  if p_source_kind='live' and exists(select 1 from public.lease_expiry_reviews where source_kind='live' and source_id=p_source_id and live_source_id is null) then
    raise exception using errcode='P0002',message='F6_SOURCE_NOT_FOUND';
  end if;
  if coalesce((prior->>'revision')::int,0)<>p_expected_revision then
    raise exception using errcode='P0001',message='F6_REVISION_CONFLICT';
  end if;
  insert into public.lease_expiry_reviews(source_kind,source_id,live_source_id,revision,status,notes,evidence_reference,source_snapshot,source_fingerprint,updated_by)
    values(p_source_kind,p_source_id,case when p_source_kind='live' then p_source_id end,p_expected_revision+1,p_status,p_notes,p_evidence_reference,snapshot,p_source_fingerprint,p_actor)
    on conflict(source_kind,source_id) do update set revision=excluded.revision,status=excluded.status,notes=excluded.notes,
      evidence_reference=excluded.evidence_reference,source_snapshot=excluded.source_snapshot,
      source_fingerprint=excluded.source_fingerprint,updated_by=excluded.updated_by,updated_at=now()
    returning to_jsonb(lease_expiry_reviews.*)-'history_source_id'-'live_source_id' into saved;
  -- Failure here rolls back the draft too; idempotent retries do not duplicate this event.
  insert into public.lease_expiry_review_events(actor_id,request_id,source_kind,source_id,request_body,previous_review,result)
    values(p_actor,p_request_id,p_source_kind,p_source_id,body,prior,saved);
  insert into public.audit_logs(user_id,action_type,details,request_source,module,target_table,target_id)
    values(p_actor::text,'LEASE_EXPIRY_REVIEW_SAVE',
      jsonb_build_object('request_id',p_request_id,'revision',p_expected_revision+1,'status',p_status,'source_kind',p_source_kind),
      'server','intelligence','lease_expiry_reviews',case when p_source_kind='history' then p_source_id::text else 'live:'||p_source_id::text end);
  -- Existing snapshot_audit_actor trigger preserves identity even after staff leave.
  return saved;
end;
$$;

-- Public API wrappers are invokers. Only the trusted server role can enter private routines.
create or replace function public.lease_expiry_review_list(
 p_actor uuid,p_as_of date,p_page integer default 1,p_query text default '',p_scope text default 'window'
) returns jsonb language sql security invoker set search_path='' as $$
 select private.lease_expiry_list_v2(p_actor,p_as_of,p_page,p_query,p_scope);
$$;
drop function public.lease_expiry_review_save(uuid,uuid,integer,text,uuid,text,text,text);
create function public.lease_expiry_review_save(
 p_actor uuid,p_source_id uuid,p_expected_revision integer,p_source_fingerprint text,p_request_id uuid,
 p_status text,p_notes text,p_evidence_reference text,p_source_kind text default 'history'
) returns jsonb language sql security invoker set search_path='' as $$
 select private.lease_expiry_save_v2(p_actor,p_source_id,p_expected_revision,p_source_fingerprint,p_request_id,p_status,p_notes,p_evidence_reference,p_source_kind);
$$;
revoke all on function private.lease_expiry_source_v2(text,uuid),
 private.lease_expiry_list_v2(uuid,date,integer,text,text),
 private.lease_expiry_save_v2(uuid,uuid,integer,text,uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.lease_expiry_review_list(uuid,date,integer,text,text),
 public.lease_expiry_review_save(uuid,uuid,integer,text,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.lease_expiry_list_v2(uuid,date,integer,text,text),
 private.lease_expiry_save_v2(uuid,uuid,integer,text,uuid,text,text,text,text),
 public.lease_expiry_review_list(uuid,date,integer,text,text),
 public.lease_expiry_review_save(uuid,uuid,integer,text,uuid,text,text,text,text) to service_role;
-- Table RLS and lack of direct grants remain in force.
notify pgrst,'reload schema';
commit;
