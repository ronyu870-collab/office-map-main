begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
-- Additive; no historical evidence is rewritten or removed.
create index if not exists audit_logs_occurred_id_idx on public.audit_logs (occurred_at desc,id desc);

alter table public.audit_logs add column actor_role text;
comment on column public.audit_logs.actor_role is 'Trusted directory role at ingestion; null for historical events and unresolved actors. Not a reconstructed event-time role.';
create or replace function private.snapshot_audit_actor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  person_name text;
begin
  new.actor_kind := 'unknown';
  new.actor_name := null;
  new.actor_role := null;
  select coalesce(nullif(btrim(u.chinese_name),''),nullif(btrim(u.full_name),''),nullif(btrim(u.email),''))
     ,u.role into person_name,new.actor_role from public.user_roles u
    where u.user_id::text=new.user_id or lower(u.email)=lower(new.user_id)
    order by (u.user_id::text=new.user_id) desc limit 1;
  if found then
    new.actor_kind := 'user';
    new.actor_name := person_name;
  elsif new.user_id='codex' then
    new.actor_kind := 'tool';
    new.actor_name := 'Codex（工具执行）';
  elsif new.user_id='system' then
    new.actor_kind := 'system';
    new.actor_name := '系统任务';
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_audit_actor() from public,anon,authenticated;

-- Durable intent is required BEFORE cross-service high-risk effects. Pending is evidence
-- of an uncertain outcome, never a success. Terminal receipt + audit row commit atomically.
create table public.audit_operation_receipts (
  id uuid primary key,
  actor_id text not null,
  action_type text not null,
  target_table text,
  target_id text,
  module text,
  details jsonb not null default '{}',
  state text not null default 'pending' check (state in ('pending','success','failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.audit_operation_receipts enable row level security;
revoke all on public.audit_operation_receipts from public,anon,authenticated;
grant select on public.audit_operation_receipts to authenticated;
grant select,insert,update on public.audit_operation_receipts to service_role;
create policy "admins read durable audit operations" on public.audit_operation_receipts for select to authenticated using ((select private.is_admin()));
create index audit_operation_pending_idx on public.audit_operation_receipts(created_at) where state='pending';

create function public.audit_complete_operation(p_id uuid,p_state text,p_details jsonb default '{}') returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.audit_operation_receipts; current_role text;
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
    select role into current_role from public.user_roles where user_id::text=r.actor_id for share;
    if current_role is distinct from 'admin' then raise exception 'export permission revoked' using errcode='42501';end if;
  end if;
  insert into public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,target_name,old_values,new_values,event_id,details)
  values(r.actor_id,r.action_type,'server',r.module,r.target_table,coalesce(p_details->>'target_id',r.target_id),p_details->>'target_name',p_details->'old_values',p_details->'new_values',r.id::text,
    r.details || (coalesce(p_details,'{}'::jsonb)-'old_values'-'new_values'-'target_name') || jsonb_strip_nulls(jsonb_build_object('business_outcome',p_details->>'outcome')) || jsonb_build_object('outcome',p_state,'operation_id',r.id,'schema_version',3,'evidence','server_confirmed'));
  update public.audit_operation_receipts set state=p_state,completed_at=now(),details=r.details||coalesce(p_details,'{}'::jsonb) where id=p_id;
  return true;
end $$;
revoke all on function public.audit_complete_operation(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.audit_complete_operation(uuid,text,jsonb) to service_role;

-- Auth trigger remains authoritative. This optional application context fallback is
-- conditional even across serverless instances, without process-local caches.
create function public.audit_touch_session(p_snapshot jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  insert into public.auth_session_audit_context as c
    (auth_session_id,user_id,last_seen_at,application_ip_address,application_user_agent,client_device_id,
     ip_country,ip_region,ip_city,browser_name,browser_version,os_name,os_version,device_type)
  values ((p_snapshot->>'auth_session_id')::uuid,(p_snapshot->>'user_id')::uuid,now(),
    p_snapshot->>'application_ip_address',p_snapshot->>'application_user_agent',p_snapshot->>'client_device_id',
    p_snapshot->>'ip_country',p_snapshot->>'ip_region',p_snapshot->>'ip_city',p_snapshot->>'browser_name',
    p_snapshot->>'browser_version',p_snapshot->>'os_name',p_snapshot->>'os_version',p_snapshot->>'device_type')
  on conflict(auth_session_id) do update set
    last_seen_at=excluded.last_seen_at,
    application_ip_address=coalesce(excluded.application_ip_address,c.application_ip_address),
    application_user_agent=coalesce(excluded.application_user_agent,c.application_user_agent),
    client_device_id=coalesce(excluded.client_device_id,c.client_device_id),
    ip_country=coalesce(excluded.ip_country,c.ip_country),ip_region=coalesce(excluded.ip_region,c.ip_region),
    ip_city=coalesce(excluded.ip_city,c.ip_city),browser_name=coalesce(excluded.browser_name,c.browser_name),
    browser_version=coalesce(excluded.browser_version,c.browser_version),os_name=coalesce(excluded.os_name,c.os_name),
    os_version=coalesce(excluded.os_version,c.os_version),device_type=coalesce(excluded.device_type,c.device_type)
  where c.user_id=excluded.user_id and (c.last_seen_at<now()-interval '15 minutes' or
    row(c.application_ip_address,c.application_user_agent,c.client_device_id,c.ip_country,c.ip_region,c.ip_city,c.browser_name,c.browser_version,c.os_name,c.os_version,c.device_type)
    is distinct from row(coalesce(excluded.application_ip_address,c.application_ip_address),coalesce(excluded.application_user_agent,c.application_user_agent),coalesce(excluded.client_device_id,c.client_device_id),coalesce(excluded.ip_country,c.ip_country),coalesce(excluded.ip_region,c.ip_region),coalesce(excluded.ip_city,c.ip_city),coalesce(excluded.browser_name,c.browser_name),coalesce(excluded.browser_version,c.browser_version),coalesce(excluded.os_name,c.os_name),coalesce(excluded.os_version,c.os_version),coalesce(excluded.device_type,c.device_type)));
end $$;
revoke all on function public.audit_touch_session(jsonb) from public,anon,authenticated;
grant execute on function public.audit_touch_session(jsonb) to service_role;

-- Policy is configuration only. No automatic deletion job is installed. A-class
-- security evidence always requires separate approval, backup and scoped review.
create table public.audit_retention_policy (
 id boolean primary key default true check(id), ordinary_days integer not null default 90 check(ordinary_days between 30 and 3650),
 automatic_cleanup boolean not null default false check(not automatic_cleanup), updated_at timestamptz not null default now()
);
insert into public.audit_retention_policy(id) values(true);
alter table public.audit_retention_policy enable row level security;
revoke all on public.audit_retention_policy from public,anon,authenticated;
grant select on public.audit_retention_policy to authenticated;
create policy "admins read retention policy" on public.audit_retention_policy for select to authenticated using((select private.is_admin()));

-- At most one sample per UTC day, and only when an administrator opens health.
-- No cron, ordinary-page polling, or exact row counts.
create table public.audit_storage_observations(day date primary key,bytes bigint not null,estimated_rows bigint not null,observed_at timestamptz not null default now());
alter table public.audit_storage_observations enable row level security;
revoke all on public.audit_storage_observations from public,anon,authenticated;

create function public.admin_audit_health() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; auth_summary jsonb;
begin
 if (select auth.uid()) is null or not (select private.is_admin()) then raise exception 'forbidden' using errcode='42501'; end if;
 insert into public.audit_storage_observations(day,bytes,estimated_rows)
 select (now() at time zone 'UTC')::date,pg_total_relation_size('public.audit_logs'),greatest(0,reltuples::bigint) from pg_class where oid='public.audit_logs'::regclass
 on conflict(day) do nothing;
 if to_regclass('auth.audit_log_entries') is not null then
   execute $query$with sample as (
    select payload::jsonb from auth.audit_log_entries where created_at>=now()-interval '15 minutes' order by created_at desc limit 1000
   ) select jsonb_build_object('window','latest_1000_within_15m','inspected',count(*),'failed_logins',count(*) filter(where
     lower(coalesce(payload->>'action',payload->>'action_type','')) like '%login%' and
     (lower(coalesce(payload->>'result',payload#>>'{traits,result}',payload->>'status',payload#>>'{traits,status}','')) in ('failed','failure','error','denied')
      or coalesce(payload->>'error',payload#>>'{traits,error}',payload#>>'{traits,reason}') is not null))) from sample$query$ into auth_summary;
 end if;
 with recent as materialized (
   select action_type,error_message,actor_kind,request_source,occurred_at,created_at,target_table,target_id,details
   from public.audit_logs where occurred_at>=now()-interval '24 hours' order by occurred_at desc,id desc limit 1000
 ), summary as (
   select count(*) as inspected,count(*) filter(where error_message is not null or details->>'outcome'='failed') as failures,
    count(*) filter(where actor_kind='unknown') as unknown_actors,
    count(*) filter(where action_type='ACCESS_DENIED') as denied,
    count(*) filter(where action_type in ('DB_DELETE','DATA_DELETE','DELETE_PROJECT','OSS_BATCH_DELETE','OSS_DELETE','BUILDING_DELETE','LEASE_TRANSACTION_DELETE','METRICS_DELETE')) as deletes,
    count(*) filter(where (action_type like 'EXPORT%' or action_type in ('AUDIT_EXPORT','OSS_FILE_DOWNLOAD'))) as exports,
    max(created_at) as last_write,percentile_cont(0.95) within group(order by greatest(0,extract(epoch from(created_at-occurred_at))*1000)) as lag_p95_ms
   from recent
 )
 select jsonb_build_object('window','latest_1000_within_24h','summary',to_jsonb(summary),
   'auth',auth_summary,
   'repeated_operations',(select count(*) from (select action_type,target_table,target_id,details->>'operation_id' from recent where request_source<>'frontend' and details->>'operation_id' is not null group by 1,2,3,4 having count(*)>1) duplicates),
   'permission_changes',(select count(*) from recent where action_type in ('USER_PERMISSION_CHANGE','AUDIT_ACCESS_CHANGE')),
   'pending_sample',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from (select id,actor_id,action_type,target_table,target_id,created_at from public.audit_operation_receipts where state='pending' and created_at<now()-interval '5 minutes' order by created_at limit 20) p),
   'pending_operations',(select count(*) from public.audit_operation_receipts where state='pending' and created_at<now()-interval '5 minutes'),
   'storage_history',(select coalesce(jsonb_agg(to_jsonb(h) order by day),'[]'::jsonb) from (select day,bytes,estimated_rows,observed_at from public.audit_storage_observations order by day desc limit 30)h),
   'storage_bytes',pg_total_relation_size('public.audit_logs'),
   'estimated_rows',(select greatest(0,reltuples::bigint) from pg_class where oid='public.audit_logs'::regclass),
   'retention',(select to_jsonb(p) from public.audit_retention_policy p where id)) into result from summary;
 return result;
end $$;
revoke all on function public.admin_audit_health() from public,anon;
grant execute on function public.admin_audit_health() to authenticated;

-- Narrow, explicitly enumerated high-risk paths. No audit on ordinary SELECT,
-- map movement, draft autosave, or sorting; the existing lease UPDATE trigger stays.
create function private.audit_critical_business_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; before_diff jsonb='{}';after_diff jsonb='{}';k text;
 action text;object_id text;object_name text;actor text;
begin
 before_row=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 after_row=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 foreach k in array tg_argv[0]::text[] loop
   if coalesce(before_row->k,'null'::jsonb) is distinct from coalesce(after_row->k,'null'::jsonb) then
     before_diff=before_diff||jsonb_build_object(k,before_row->k);
     after_diff=after_diff||jsonb_build_object(k,after_row->k);
   end if;
 end loop;
 if tg_op='UPDATE' and after_diff='{}'::jsonb then return new; end if;
 actor=coalesce((select auth.uid())::text,'unknown');
 object_id=coalesce(after_row->>'id',before_row->>'id',after_row->>'user_id',before_row->>'user_id',after_row->>'key',before_row->>'key',after_row->>'building_id',before_row->>'building_id');
 object_name=coalesce(after_row->>'name',before_row->>'name',after_row->>'new_building',before_row->>'new_building');
 action=case tg_table_name when 'user_roles' then 'USER_PERMISSION_CHANGE' when 'app_settings' then 'CONFIG_CHANGE' when 'building_metrics' then 'METRICS_'||tg_op
   when 'lease_transactions' then 'LEASE_TRANSACTION_'||tg_op when 'buildings' then 'BUILDING_'||tg_op when 'quarterly_submissions' then 'QUARTERLY_RECORD_'||tg_op when 'future_supply_submissions' then 'QUARTERLY_RECORD_'||tg_op else 'ADMIN_FIELD_CHANGE' end;
 insert into public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,target_name,old_values,new_values,details,event_id)
 values(actor,action,'database_trigger',case when tg_table_name='lease_transactions' then 'lease-submission' else 'admin' end,
   tg_table_name,object_id,object_name,before_diff,after_diff,
   jsonb_strip_nulls(jsonb_build_object('schema_version',3,'outcome','success','evidence','transaction_committed','operation_id',txid_current()::text,'building_id',coalesce(after_row->>'building_id',before_row->>'building_id'),'record_year',coalesce(after_row->'record_year',before_row->'record_year'),'record_quarter',coalesce(after_row->'record_quarter',before_row->'record_quarter'),'change_count',(select count(*) from jsonb_object_keys(after_diff)))),
   gen_random_uuid()::text);
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.audit_critical_business_change() from public,anon,authenticated;

create trigger audit_critical_buildings after insert or delete or update of name,is_active,tracking_scope,leasable_area,grade,submarket on public.buildings
for each row execute function private.audit_critical_business_change('{name,is_active,tracking_scope,leasable_area,grade,submarket}');
create trigger audit_critical_user_permissions after insert or delete or update of role on public.user_roles
for each row execute function private.audit_critical_business_change('{role}');
create trigger audit_critical_lease_lifecycle after insert or delete on public.lease_transactions
for each row execute function private.audit_critical_business_change('{company,new_building,area_sqm,face_rent,effective_rent,submitter_id,transaction_year,transaction_quarter}');

create function public.admin_set_audit_retention(p_days integer) returns void
language plpgsql security definer set search_path='' as $$
declare previous integer;
begin
 if (select auth.uid()) is null or not (select private.is_admin()) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_days not between 30 and 3650 or p_days is null then raise exception 'invalid retention' using errcode='22023'; end if;
 select ordinary_days into previous from public.audit_retention_policy where id for update;
 if previous=p_days then return;end if;
 update public.audit_retention_policy set ordinary_days=p_days,updated_at=now() where id;
 insert into public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,old_values,new_values,details,event_id)
 values((select auth.uid())::text,'CONFIG_CHANGE','database_trigger','admin','audit_retention_policy','true',
 jsonb_build_object('ordinary_days',previous),jsonb_build_object('ordinary_days',p_days),
 jsonb_build_object('schema_version',3,'outcome','success','automatic_cleanup',false),gen_random_uuid()::text);
end $$;
revoke all on function public.admin_set_audit_retention(integer) from public,anon;
grant execute on function public.admin_set_audit_retention(integer) to authenticated;

-- Administrative import/history repair and assignment paths bypass the formal
-- submit RPC. Cover these selected critical columns at the existing transaction.
-- Drafts, autosave, read tables and all other business tables stay untouched.
create trigger audit_quarterly_records after insert or update or delete on public.quarterly_submissions
for each row execute function private.audit_critical_business_change('{building_id,user_id,record_year,record_quarter,total_area,vacant_area,vacancy_rate,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,owner,property_management}');
create trigger audit_future_quarterly_records after insert or update or delete on public.future_supply_submissions
for each row execute function private.audit_critical_business_change('{future_supply_id,user_id,record_year,record_quarter,total_area,vacant_area,vacancy_rate,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,owner,property_management}');
create trigger audit_current_building_values after insert or update or delete on public.building_current_data
for each row execute function private.audit_critical_business_change('{building_id,leasable_area,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,vacant_area,vacancy_rate}');
create trigger audit_building_display_values after insert or update or delete on public.building_display_overrides
for each row execute function private.audit_critical_business_change('{building_id,field_name,display_label,display_value}');
create trigger audit_building_assignment_permissions after insert or update or delete on public.building_assignments
for each row execute function private.audit_critical_business_change('{building_id,user_id}');
create trigger audit_future_assignment_permissions after insert or update or delete on public.future_supply_assignments
for each row execute function private.audit_critical_business_change('{future_supply_id,user_id}');
create trigger audit_future_supply_values after insert or update or delete on public.future_supplies
for each row execute function private.audit_critical_business_change('{name,submarket,grade,total_area,leasable_area,delivery_year,delivery_quarter,is_active,status}');
-- Only the deletion itself is critical for non-business editorial records.
create trigger audit_notice_deletion after delete on public.notices
for each row execute function private.audit_critical_business_change('{id}');
create trigger audit_changelog_deletion after delete on public.changelog
for each row execute function private.audit_critical_business_change('{id,code,title}');

-- Existing quarterly receipts/provenance remain independent; these cover actual
-- committed metric changes (including grid edits) rather than draft keystrokes.
create trigger audit_critical_metrics after insert or update or delete on public.building_metrics
for each row execute function private.audit_critical_business_change('{building_id,record_year,record_quarter,total_area,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,vacancy_rate,vacant_area,is_locked}');
-- Explicit safe config keys only: never log arbitrary settings or credentials.
create trigger audit_critical_submission_settings_insert after insert on public.app_settings
for each row when (new.key in ('current_submission_year','current_submission_quarter'))
execute function private.audit_critical_business_change('{value}');
create trigger audit_critical_submission_settings_update after update on public.app_settings
for each row when (new.key in ('current_submission_year','current_submission_quarter'))
execute function private.audit_critical_business_change('{value}');
create trigger audit_critical_submission_settings_delete after delete on public.app_settings
for each row when (old.key in ('current_submission_year','current_submission_quarter'))
execute function private.audit_critical_business_change('{value}');

-- Bounded adapter to existing dedicated provenance. Payloads stay in the protected
-- source table; the ordinary center receives submission metadata only.
create index audit_quarterly_entity_time_idx on public.quarterly_submission_provenance(entity_id,submitted_at desc,request_id desc,user_id desc);
create function public.admin_audit_quarterly_timeline(p_building_id uuid,p_before_at timestamptz default null,p_before_request uuid default null,p_before_user uuid default null)
returns table(user_id uuid,request_id uuid,entity_id uuid,submission_id uuid,record_year integer,record_quarter integer,submitted_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not (select private.is_admin()) then raise exception 'forbidden' using errcode='42501';end if;
 if p_building_id is null or (p_before_at is not null and (p_before_request is null or p_before_user is null)) then raise exception 'invalid cursor' using errcode='22023';end if;
 return query select q.user_id,q.request_id,q.entity_id,q.submission_id,q.record_year,q.record_quarter,q.submitted_at
 from public.quarterly_submission_provenance q where q.entity_kind='regular' and q.entity_id=p_building_id
 and (p_before_at is null or (q.submitted_at,q.request_id,q.user_id)<(p_before_at,p_before_request,p_before_user))
 order by q.submitted_at desc,q.request_id desc,q.user_id desc limit 51;
end $$;
revoke all on function public.admin_audit_quarterly_timeline(uuid,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.admin_audit_quarterly_timeline(uuid,timestamptz,uuid,uuid) to authenticated;

commit;
