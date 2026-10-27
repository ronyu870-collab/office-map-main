begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
alter table public.buildings add column merged_into_id uuid references public.buildings(id) on delete restrict;
create index buildings_merged_into_idx on public.buildings(merged_into_id) where merged_into_id is not null;
alter table public.buildings add constraint buildings_merge_not_self check(merged_into_id is distinct from id);
comment on column public.buildings.merged_into_id is 'Archived duplicate identity. Read/write callers resolve to this active canonical building; the original row is retained.';

create or replace function public.resolve_building_id(p_id uuid)
returns uuid language sql stable security invoker set search_path='' as $$
 select coalesce((select coalesce(b.merged_into_id,b.id) from public.buildings b where b.id=p_id),p_id)
$$;
revoke all on function public.resolve_building_id(uuid) from public,anon,authenticated,service_role;
grant execute on function public.resolve_building_id(uuid) to authenticated,service_role;

create function private.protect_merged_building() returns trigger language plpgsql security invoker set search_path='' as $$
declare target public.buildings%rowtype;
begin
 if tg_op='DELETE' then
   if old.merged_into_id is not null then raise exception using errcode='23514',message='已合并楼宇保留原档，不可删除'; end if;
   return old;
 end if;
 if tg_op='UPDATE' and old.merged_into_id is not null then
   raise exception using errcode='23514',message='此楼宇已合并，请刷新后在主档操作';
 end if;
 if new.merged_into_id is not null then
   if auth.uid() is not null or session_user not in ('postgres','supabase_admin') or current_setting('role',true) not in ('none','postgres','supabase_admin') then
     raise exception using errcode='42501',message='身份合并只能经核验维护事务执行';
   end if;
   select * into target from public.buildings where id=new.merged_into_id;
   if not found or target.merged_into_id is not null or not target.is_active or target.tracking_scope<>'tracked'
      or new.is_active or new.tracking_scope<>'reference_only' or new.id=target.id
      or exists(select 1 from public.buildings where merged_into_id=new.id) then
     raise exception using errcode='23514',message='无效的合并目标、归档状态或多级身份链';
   end if;
 end if;
 if tg_op='UPDATE' and exists(select 1 from public.buildings where merged_into_id=old.id)
    and (not new.is_active or new.tracking_scope<>'tracked' or new.merged_into_id is not null) then
   raise exception using errcode='23514',message='合并主档不可停用或再次合并';
 end if;
 return new;
end $$;
revoke all on function private.protect_merged_building() from public,anon,authenticated,service_role;
create trigger aaa_buildings_protect_merge before update or delete on public.buildings for each row execute function private.protect_merged_building();

-- RLS and the caller's original write privileges still apply to the resulting row.
create function private.canonicalize_building_reference() returns trigger language plpgsql security definer set search_path='' as $$
declare original_id uuid; resolved_id uuid;
begin
 if auth.uid() is null and current_setting('role',true)<>'service_role' and not (session_user in ('postgres','supabase_admin') and current_setting('role',true) in ('none','postgres','supabase_admin')) then
   raise exception using errcode='42501',message='Authenticated write context required';
 end if;
 original_id := (to_jsonb(new)->>tg_argv[0])::uuid;
 if original_id is not null then
   -- Key-share serializes a late FK write with the merge FOR UPDATE lock.
   -- This private trigger alone may lock the parent: callers keep SELECT-only
   -- building access and their original target-table RLS still checks NEW.
   select coalesce(b.merged_into_id,b.id) into resolved_id from public.buildings b where b.id=original_id for key share;
   resolved_id := coalesce(resolved_id,original_id);
   if resolved_id is distinct from original_id then
     new := jsonb_populate_record(new,jsonb_build_object(tg_argv[0],resolved_id));
   end if;
 end if;
 return new;
end $$;
revoke all on function private.canonicalize_building_reference() from public,anon,authenticated,service_role;
do $$ declare fk record; begin
 for fk in select distinct c.conrelid::regclass as relation,a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
   where c.contype='f' and c.confrelid='public.buildings'::regclass and c.conrelid<>'public.buildings'::regclass and array_length(c.conkey,1)=1
 loop
   execute format('create trigger canonicalize_building_identity before insert or update of %I on %s for each row execute function private.canonicalize_building_reference(%L)',fk.attname,fk.relation,fk.attname);
 end loop;
end $$;

-- Private, owner-only evidence and maintenance functions; no browser merge API.
create function private.building_merge_snapshot(p_old uuid,p_keep uuid,p_future uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select jsonb_build_object(
 'buildings',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.buildings t where id in (p_old,p_keep)),
 'metrics',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.building_metrics t where building_id in (p_old,p_keep)),
 'assignments',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.building_assignments t where building_id in (p_old,p_keep)),
 'future',(select to_jsonb(t) from public.future_supplies t where id=p_future),
 'future_assignments',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.future_supply_assignments t where future_supply_id=p_future),
 'future_submissions',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.future_supply_submissions t where future_supply_id=p_future),
 'project_maps',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.lease_building_project_map t where alias_name in (select alias_name from public.lease_building_project_map where building_id in (p_old,p_keep))),
 'other_buildings',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.buildings t where id not in (p_old,p_keep)),
 'live_sources',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.lease_transactions t),
 'history_sources',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.lease_transactions_history t)
 )
$$;
revoke all on function private.building_merge_snapshot(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.merge_verified_buildings(p_old uuid,p_keep uuid,p_future uuid,p_expected jsonb,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior jsonb; expected jsonb; actual jsonb; source public.buildings%rowtype; target public.buildings%rowtype; supply public.future_supplies%rowtype; fk record; n bigint;
begin
 if auth.uid() is not null or session_user not in ('postgres','supabase_admin') or current_setting('role',true) not in ('none','postgres','supabase_admin') then raise exception using errcode='42501',message='Owner maintenance only'; end if;
 if p_old=p_keep or nullif(btrim(p_reason),'') is null then raise exception 'Verified identities and evidence required'; end if;
 perform pg_advisory_xact_lock(1149231,1);
 lock table public.buildings,public.future_supplies,public.building_metrics,public.building_assignments,public.future_supply_assignments,public.future_supply_submissions,public.lease_building_project_map in share row exclusive mode;
 select * into strict source from public.buildings where id=p_old for update;
 select * into strict target from public.buildings where id=p_keep for update;
 select * into strict supply from public.future_supplies where id=p_future for update;
 if source.merged_into_id=p_keep and supply.building_id=p_keep then return jsonb_build_object('status','already_merged','building_id',p_keep); end if;
 prior := private.building_merge_snapshot(p_old,p_keep,p_future);
 if prior is distinct from p_expected then raise exception using errcode='40001',message='Merge source changed; recheck before retry'; end if;
 if source.merged_into_id is not null or target.merged_into_id is not null or source.project_type<>'future' or target.project_type<>'stock'
    or not source.is_active or not target.is_active or source.tracking_scope<>'tracked' or target.tracking_scope<>'tracked'
    or not source.is_entered_market or not target.is_entered_market or not supply.is_entered_market
    or source.name is distinct from target.name or supply.name is distinct from target.name
    or source.city is distinct from target.city or source.owner is distinct from target.owner
    or source.location_lng is distinct from target.location_lng or source.location_lat is distinct from target.location_lat
    or source.leasable_area is distinct from supply.total_area or source.leasable_area is null
    or (target.leasable_area is not null and target.leasable_area is distinct from source.leasable_area)
    or supply.building_id is not null
    or exists(select 1 from public.future_supplies where building_id in (p_old,p_keep))
    or exists(select 1 from public.buildings where merged_into_id in (p_old,p_keep))
    or exists(select 1 from public.building_metrics where building_id=p_keep)
 then raise exception 'Unsafe or conflicting merge identity/area/period'; end if;
 -- Fail on every unexpected reference, including tables added after this migration.
 for fk in select c.conrelid::regclass as relation,a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
   where c.contype='f' and c.confrelid='public.buildings'::regclass and array_length(c.conkey,1)=1
     and c.conrelid not in ('public.building_metrics'::regclass,'public.lease_building_project_map'::regclass)
 loop
   execute format('select count(*) from %s where %I=$1',fk.relation,fk.attname) into n using p_old;
   if n<>0 then raise exception 'Unmigrated reference in %',fk.relation; end if;
 end loop;
 if exists(select 1 from public.lease_building_project_map a join public.lease_building_project_map b using(market_code,alias_name) where a.building_id=p_old and b.building_id=p_keep) then raise exception 'Project member collision'; end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.building_metrics'::regclass and tgname='building_metrics_set_updated_at' and tgenabled='O')
    or not exists(select 1 from pg_trigger where tgrelid='public.future_supplies'::regclass and tgname='future_supplies_guard_identity' and tgenabled='O') then raise exception 'Required guard absent'; end if;
 expected := prior;
 expected := jsonb_set(expected,'{buildings}',(select jsonb_agg(v order by v::text) from (select case when (x->>'id')::uuid=p_old then x||jsonb_build_object('merged_into_id',p_keep,'is_active',false,'tracking_scope','reference_only') else x||jsonb_build_object('leasable_area',source.leasable_area) end as v from jsonb_array_elements(prior->'buildings') x) s));
 expected := jsonb_set(expected,'{metrics}',(select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from (select x||jsonb_build_object('building_id',p_keep) v from jsonb_array_elements(prior->'metrics') x)s));
 expected := jsonb_set(expected,'{project_maps}',(select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from (select case when (x->>'building_id')::uuid=p_old then x||jsonb_build_object('building_id',p_keep) else x end v from jsonb_array_elements(prior->'project_maps') x)s));
 expected := jsonb_set(expected,'{future}',(prior->'future')||jsonb_build_object('building_id',p_keep));
 alter table public.building_metrics disable trigger building_metrics_set_updated_at;
 update public.building_metrics set building_id=p_keep where building_id=p_old;
 alter table public.building_metrics enable trigger building_metrics_set_updated_at;
 update public.lease_building_project_map set building_id=p_keep where building_id=p_old;
 update public.buildings set leasable_area=source.leasable_area where id=p_keep;
 update public.buildings set merged_into_id=p_keep,is_active=false,tracking_scope='reference_only' where id=p_old;
 alter table public.future_supplies disable trigger future_supplies_guard_identity;
 update public.future_supplies set building_id=p_keep where id=p_future;
 alter table public.future_supplies enable trigger future_supplies_guard_identity;
 actual := private.building_merge_snapshot(p_old,p_keep,p_future);
 if actual is distinct from expected then raise exception 'Merge preservation check failed; all changes rolled back'; end if;
 insert into public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,target_name,old_values,new_values,details,event_id)
 values('system','DB_UPDATE','database_maintenance','database','buildings',p_keep::text,target.name,prior,actual,
 jsonb_build_object('operation','merge_verified_building_identity','old_building_id',p_old,'canonical_building_id',p_keep,'future_supply_id',p_future,'reason',p_reason,'assignments_and_submissions_preserved',true),'building-merge-'||p_old::text);
 return jsonb_build_object('status','merged','building_id',p_keep,'archived_id',p_old);
end $$;
revoke all on function private.merge_verified_buildings(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

-- Updated rename implementations are appended below; they preserve their ACLs.
create or replace function private.prepare_building_identity_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  linked public.future_supplies%rowtype;
  names text[];
  proposed jsonb := case when new.former_names is null or new.former_names in ('null'::jsonb,'""'::jsonb) then '[]'::jsonb else new.former_names end;
  previous jsonb := case when old.former_names is null or old.former_names in ('null'::jsonb,'""'::jsonb) then '[]'::jsonb else old.former_names end;
begin
  if new.name is not distinct from old.name
     and proposed=previous then
    new.former_names := old.former_names;
    return new;
  end if;
  if not coalesce(private.is_admin(),false)
     and not (auth.uid() is null and (
       current_setting('role',true)='service_role'
       or (session_user in ('postgres','supabase_admin') and current_setting('role',true) in ('none','postgres','supabase_admin'))
     )) then
    raise exception using errcode='42501', message='仅管理员可以修改楼宇名称和曾用名';
  end if;
  -- All identity changes share one short transaction lock. Unique map keys are
  -- also checked during insertion; no competing rename may take an alias.
  perform pg_advisory_xact_lock(1149231,1);
  new.name := btrim(new.name);
  if new.name is null or new.name='' then
    raise exception using errcode='22023', message='项目名称不能为空';
  end if;
  if new.city is distinct from '北京' then
    raise exception using errcode='22023', message='当前自动更名仅支持北京项目，请先核对项目城市';
  end if;
  if jsonb_typeof(proposed)<>'array' or jsonb_typeof(previous)<>'array' then
    raise exception using errcode='22023', message='曾用名必须是名称列表，请核对后重试';
  end if;
  if exists (select 1 from jsonb_array_elements(proposed || previous) v where jsonb_typeof(v)<>'string') then
    raise exception using errcode='22023', message='曾用名只能包含文字名称';
  end if;
  select * into linked from public.future_supplies where building_id=old.id for update;
  if not found and (old.project_type='future' or new.project_type='future') then
    raise exception using errcode='22023',
      message='此未来供应项目尚未建立唯一楼宇关联，已取消保存；请先由管理员核对关联';
  end if;

  select coalesce(array_agg(distinct value order by value),array[]::text[]) into names
  from (
    select btrim(value) as value from jsonb_array_elements_text(proposed || previous)
    union all select btrim(value) from unnest(coalesce(linked.former_names,array[]::text[])) value
    union all select btrim(old.name)
  ) aliases where value<>'' and value<>new.name;
  new.former_names := to_jsonb(names);
  names := array_append(names,new.name);

  if exists (
    select 1 from public.buildings b
    where b.id<>old.id and b.merged_into_id is distinct from old.id and (
      lower(btrim(b.name)) in (select lower(n) from unnest(names) n)
      or exists (
        select 1 from jsonb_array_elements_text(
          case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end
        ) a where lower(btrim(a)) in (select lower(n) from unnest(names) n)
      )
    )
  ) or exists (
    select 1 from public.lease_building_name_map m
    where m.market_code='BJ' and m.building_id<>old.id
      and lower(btrim(m.alias_name)) in (select lower(n) from unnest(names) n)
  ) or exists (
    select 1 from public.lease_building_project_map m
    where m.market_code='BJ'
      and lower(btrim(m.alias_name)) in (select lower(n) from unnest(names) n)
  ) or exists (
    select 1 from public.future_supplies f
    where f.building_id is distinct from old.id
      and (
        lower(btrim(f.name)) in (select lower(n) from unnest(names) n)
        or exists (select 1 from unnest(coalesce(f.former_names,array[]::text[])) a
          where lower(btrim(a)) in (select lower(n) from unnest(names) n))
      )
  ) then
    raise exception using errcode='23505',
      message='名称或曾用名已属于其他楼宇，或存在项目级歧义；已取消保存，请核对名称';
  end if;
  return new;
end;
$$;

create or replace function private.admin_rename_building(
  p_id uuid, p_expected_name text, p_expected_former_names jsonb,
  p_new_name text, p_former_names jsonb default null
) returns setof public.buildings
language plpgsql security definer set search_path='' as $$
declare
  current_building public.buildings%rowtype;
  canonical_id uuid;
  expected_aliases jsonb := case when p_expected_former_names is null or p_expected_former_names in ('null'::jsonb,'""'::jsonb) then '[]'::jsonb else p_expected_former_names end;
  requested_aliases jsonb := case when p_former_names is null or p_former_names in ('null'::jsonb,'""'::jsonb) then '[]'::jsonb else p_former_names end;
  current_aliases jsonb;
begin
  if auth.uid() is null or not coalesce(private.is_admin(),false) then
    raise exception using errcode='42501',message='仅管理员可以修改楼宇名称和曾用名';
  end if;
  if p_new_name is null or btrim(p_new_name)='' then
    raise exception using errcode='22023',message='项目名称不能为空';
  end if;
  if jsonb_typeof(expected_aliases)<>'array' or jsonb_typeof(requested_aliases)<>'array' then
    raise exception using errcode='22023',message='曾用名必须是名称列表';
  end if;
  if exists(select 1 from jsonb_array_elements(expected_aliases || requested_aliases) x where jsonb_typeof(x)<>'string') then
    raise exception using errcode='22023',message='曾用名只能包含文字名称';
  end if;
  canonical_id := public.resolve_building_id(p_id);
  select * into current_building from public.buildings where id=canonical_id for update;
  if not found then raise exception using errcode='P0002',message='楼宇不存在，请刷新后重试'; end if;
  current_aliases := case when current_building.former_names is null or current_building.former_names in ('null'::jsonb,'""'::jsonb) then '[]'::jsonb else current_building.former_names end;
  if current_building.name is distinct from p_expected_name
     or current_aliases is distinct from expected_aliases then
    -- A lost response can be retried safely when the requested additive result
    -- already exists. A different intervening name is never overwritten.
    if current_building.name=btrim(p_new_name)
       and (current_building.name=p_expected_name or coalesce(current_building.former_names,'[]'::jsonb) ? btrim(p_expected_name))
       and not exists(
         select 1 from (
           select btrim(value) value from jsonb_array_elements_text(expected_aliases || requested_aliases)
           union all select btrim(p_expected_name)
         ) required where value<>'' and value<>current_building.name
           and not (coalesce(current_building.former_names,'[]'::jsonb) ? value)
       ) then
      return next current_building;
      return;
    end if;
    raise exception using errcode='40001',message='楼宇名称或曾用名已被修改，已取消保存；请刷新核对后重试';
  end if;
  return query update public.buildings b
    set name=p_new_name,former_names=case when p_former_names is null then b.former_names else requested_aliases end
    where b.id=canonical_id returning b.*;
end;
$$;

-- Reparse the SQL-standard row expansion after the new composite column.
create or replace function public.admin_rename_building(
  p_id uuid, p_expected_name text, p_expected_former_names jsonb,
  p_new_name text, p_former_names jsonb default null
) returns setof public.buildings
language sql security invoker set search_path=''
begin atomic
  select * from private.admin_rename_building(
    p_id,p_expected_name,p_expected_former_names,p_new_name,p_former_names
  );
end;

commit;
