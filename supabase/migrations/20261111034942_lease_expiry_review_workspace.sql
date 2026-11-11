begin;

-- Draft evidence only: no expiry confirmation, owner assignment, or source updates.
create table public.lease_expiry_reviews (
  source_id uuid primary key references public.lease_transactions_history(id) on delete restrict,
  revision integer not null check (revision > 0),
  status text not null check (status in ('pending','missing_info','source_conflict')),
  notes text not null check (length(notes) <= 4000),
  evidence_reference text not null check (length(evidence_reference) <= 1000),
  source_snapshot jsonb not null,
  source_fingerprint text not null,
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
create table public.lease_expiry_review_events (
  actor_id uuid not null,
  request_id uuid not null,
  source_id uuid not null references public.lease_expiry_reviews(source_id),
  request_body jsonb not null,
  previous_review jsonb,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
alter table public.lease_expiry_reviews enable row level security;
alter table public.lease_expiry_review_events enable row level security;
revoke all on public.lease_expiry_reviews, public.lease_expiry_review_events from public, anon, authenticated, service_role;

create or replace function private.lease_expiry_assert_admin(p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Lock role/account rows until this transaction ends: revocation serializes with saves.
  perform 1 from public.user_roles r join auth.users u on u.id=r.user_id
    where r.user_id=p_actor and r.role='admin' and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now()) for share of r,u;
  if not found then raise exception using errcode='42501', message='F6_ACCESS_DENIED'; end if;
end;
$$;

create or replace function private.lease_expiry_source(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',h.id,'company',h.company,'building',h.new_building,
    'period_start',v.transaction_period_start,'period_end',v.transaction_period_end,
    'period_source',h.period_source,'precision',v.transaction_time_precision,
    'lease_term_months',h.lease_term_months,'source_lease_term_raw',h.source_lease_term_raw,
    'source_file',h.source_file,'source_sheet',h.source_sheet,'source_row',h.source_row,
    'source_info_date',h.source_info_date,'quality_status',h.quality_status,
    'building_match_scope',v.building_match_scope
  ) from public.lease_transactions_history h
    join public.lease_transactions_read_v1 v on v.source_record_id=h.id and v.record_source='history'
    where h.id=p_id;
$$;

create or replace function public.lease_expiry_review_list(
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
    select h.id,h.company,h.new_building,v.transaction_period_start,
      case when h.lease_term_months between 1 and 120 and h.lease_term_months=trunc(h.lease_term_months)
        and v.transaction_time_precision in ('date','quarter')
        then (v.transaction_period_start+make_interval(months=>h.lease_term_months::int))::date end proxy_start,
      case when h.lease_term_months between 1 and 120 and h.lease_term_months=trunc(h.lease_term_months)
        and v.transaction_time_precision in ('date','quarter')
        then (v.transaction_period_end+make_interval(months=>h.lease_term_months::int))::date end proxy_end
    from public.lease_transactions_history h
    join public.lease_transactions_read_v1 v on v.record_source='history' and v.source_record_id=h.id
  ), filtered as (
    select p.* from periods p where
      ((p_scope='window' and p.proxy_start < (p_as_of+interval '6 months')::date and p.proxy_end>=p_as_of)
       or (p_scope='saved' and exists(select 1 from public.lease_expiry_reviews r where r.source_id=p.id)))
      and (p_query='' or position(lower(p_query) in lower(coalesce(p.company,'')||' '||coalesce(p.new_building,'')))>0)
  ), page as (
    select * from filtered order by proxy_start nulls last,id limit 25 offset (p_page-1)*25
  ), items as (
    select p.id,p.proxy_start,jsonb_build_object(
      'source',s.snapshot,'source_fingerprint',md5(s.snapshot::text),
      'proxy_start',p.proxy_start,'proxy_end',p.proxy_end,
      -- A name-based clue, never an automatic renewal decision or customer identity.
      'has_later_name_match',exists(select 1 from public.lease_transactions_read_v1 v
        where nullif(trim(p.company),'') is not null and nullif(trim(p.new_building),'') is not null
          and trim(v.company)=trim(p.company) and trim(v.new_building)=trim(p.new_building)
          and v.transaction_period_start>p.transaction_period_start),
      'review',to_jsonb(r)
    ) item from page p cross join lateral (select private.lease_expiry_source(p.id) snapshot) s
      left join public.lease_expiry_reviews r on r.source_id=p.id
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(item order by proxy_start nulls last,id) from items),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',25,
    'as_of',p_as_of,'window_end',(p_as_of+interval '6 months')::date) into result;
  return result;
end;
$$;

create or replace function public.lease_expiry_review_save(
 p_actor uuid,p_source_id uuid,p_expected_revision integer,p_source_fingerprint text,p_request_id uuid,
 p_status text,p_notes text,p_evidence_reference text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; prior jsonb; saved jsonb; body jsonb; event public.lease_expiry_review_events%rowtype;
begin
  perform private.lease_expiry_assert_admin(p_actor);
  if p_source_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0
    or p_status is null or p_status not in ('pending','missing_info','source_conflict')
    or p_notes is null or length(p_notes)>4000 or p_evidence_reference is null or length(p_evidence_reference)>1000
    or p_source_fingerprint is null or p_source_fingerprint !~ '^[0-9a-f]{32}$'
    or (p_status<>'pending' and length(trim(p_notes))=0) then
    raise exception using errcode='22023',message='F6_INVALID_INPUT';
  end if;
  body:=jsonb_build_object('source_id',p_source_id,'revision',p_expected_revision,
    'fingerprint',p_source_fingerprint,'status',p_status,'notes',p_notes,'evidence_reference',p_evidence_reference);
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request_id::text,0));
  select * into event from public.lease_expiry_review_events where actor_id=p_actor and request_id=p_request_id;
  if found then
    if event.request_body<>body then raise exception using errcode='P0001',message='F6_REQUEST_CONFLICT'; end if;
    return event.result;
  end if;
  -- The source row lock also serializes the first save before a draft row exists.
  perform 1 from public.lease_transactions_history where id=p_source_id for update;
  if not found then raise exception using errcode='P0002',message='F6_SOURCE_NOT_FOUND'; end if;
  snapshot:=private.lease_expiry_source(p_source_id);
  if snapshot is null or md5(snapshot::text)<>p_source_fingerprint then
    raise exception using errcode='P0001',message='F6_SOURCE_CHANGED';
  end if;
  select to_jsonb(r) into prior from public.lease_expiry_reviews r where source_id=p_source_id for update;
  if coalesce((prior->>'revision')::int,0)<>p_expected_revision then
    raise exception using errcode='P0001',message='F6_REVISION_CONFLICT';
  end if;
  insert into public.lease_expiry_reviews(source_id,revision,status,notes,evidence_reference,source_snapshot,source_fingerprint,updated_by)
    values(p_source_id,p_expected_revision+1,p_status,p_notes,p_evidence_reference,snapshot,p_source_fingerprint,p_actor)
    on conflict(source_id) do update set revision=excluded.revision,status=excluded.status,notes=excluded.notes,
      evidence_reference=excluded.evidence_reference,source_snapshot=excluded.source_snapshot,
      source_fingerprint=excluded.source_fingerprint,updated_by=excluded.updated_by,updated_at=now()
    returning to_jsonb(lease_expiry_reviews.*) into saved;
  -- Failure here rolls back the draft too; idempotent retries do not duplicate this event.
  insert into public.lease_expiry_review_events(actor_id,request_id,source_id,request_body,previous_review,result)
    values(p_actor,p_request_id,p_source_id,body,prior,saved);
  insert into public.audit_logs(user_id,action_type,details,request_source,module,target_table,target_id)
    values(p_actor::text,'LEASE_EXPIRY_REVIEW_SAVE',
      jsonb_build_object('request_id',p_request_id,'revision',p_expected_revision+1,'status',p_status),
      'server','intelligence','lease_expiry_reviews',p_source_id::text);
  -- Existing snapshot_audit_actor trigger preserves identity even after staff leave.
  return saved;
end;
$$;

revoke all on function private.lease_expiry_assert_admin(uuid), private.lease_expiry_source(uuid) from public,anon,authenticated,service_role;
revoke all on function public.lease_expiry_review_list(uuid,date,integer,text,text),
 public.lease_expiry_review_save(uuid,uuid,integer,text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.lease_expiry_review_list(uuid,date,integer,text,text),
 public.lease_expiry_review_save(uuid,uuid,integer,text,uuid,text,text,text) to service_role;
comment on table public.lease_expiry_reviews is 'F6 admin evidence drafts only. Never verified lease expiry or customer ownership.';
commit;
