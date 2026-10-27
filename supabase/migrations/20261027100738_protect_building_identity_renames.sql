begin;
set local lock_timeout='5s';
set local statement_timeout='45s';

-- Persist a verified one-to-one identity; never resolve a rename by fuzzy name.
alter table public.future_supplies
  add column building_id uuid references public.buildings(id) on delete restrict;
create unique index future_supplies_building_identity_unique
  on public.future_supplies(building_id) where building_id is not null;
comment on column public.future_supplies.building_id is
  'Canonical building identity. Rename through project basic information; do not match by the new display name.';

-- The DDL locks protect both tables while the transaction checks that adding a
-- link did not modify any existing business field, even through an old trigger.
create temporary table _rename_future_before on commit drop as
  select id,to_jsonb(f)-'building_id' as row_data from public.future_supplies f;
create temporary table _rename_buildings_before on commit drop as
  select id,to_jsonb(b) as row_data from public.buildings b;

-- Backfill only exact current names AND exact coordinates, unique in both directions.
-- Ambiguous / incomplete records remain unlinked and cannot silently rename a peer.
with candidates as (
  select f.id as future_id, b.id as building_id,
    count(*) over (partition by f.id) as future_candidates,
    count(*) over (partition by b.id) as building_candidates
  from public.future_supplies f
  join public.buildings b on b.name=f.name
    and b.location_lng::numeric=f.location_lng
    and b.location_lat::numeric=f.location_lat
    and b.city='北京'
)
update public.future_supplies f set building_id=c.building_id
from candidates c where f.id=c.future_id
  and c.future_candidates=1 and c.building_candidates=1;

do $$
begin
  if exists (
    select 1 from _rename_future_before previous
    full join public.future_supplies current on current.id=previous.id
    where previous.id is null or current.id is null
      or previous.row_data is distinct from (to_jsonb(current)-'building_id')
  ) then raise exception 'Existing future supply data changed; migration rolled back'; end if;
  if exists (
    select 1 from _rename_buildings_before previous
    full join public.buildings current on current.id=previous.id
    where previous.id is null or current.id is null
      or previous.row_data is distinct from to_jsonb(current)
  ) then raise exception 'Existing building data changed; migration rolled back'; end if;
end;
$$;

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
    where b.id<>old.id and (
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

create or replace function private.finish_building_identity_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  alias text;
  affected integer;
  linked public.future_supplies%rowtype;
  updated_supply public.future_supplies%rowtype;
  names text[];
  event_group text := gen_random_uuid()::text;
  actor text := coalesce(auth.uid()::text,'system');
begin
  if new.name is not distinct from old.name
     and new.former_names is not distinct from old.former_names then return new; end if;
  select array_agg(value order by value) into names from jsonb_array_elements_text(new.former_names);
  names := coalesce(names,array[]::text[]);
  foreach alias in array array_append(names,new.name) loop
    insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
      values('BJ',alias,new.id,case when alias=new.name then 'canonical_name' else 'former_name' end,'MANUAL_VERIFIED')
    on conflict(market_code,alias_name) do update
      set match_method=excluded.match_method, verification_status='MANUAL_VERIFIED'
      where lease_building_name_map.building_id=excluded.building_id;
    get diagnostics affected=row_count;
    if affected<>1 then
      raise exception using errcode='23505', message='名称关联已被其他项目占用，已取消整笔保存';
    end if;
  end loop;
  select * into linked from public.future_supplies where building_id=new.id for update;
  if found then
    update public.future_supplies set name=new.name,former_names=names
    where id=linked.id and (name is distinct from new.name or former_names is distinct from names)
    returning * into updated_supply;
    if found then
      insert into public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,target_name,old_values,new_values,details,event_id)
      values(actor,'DB_UPDATE','database_trigger','database','future_supplies',linked.id::text,new.name,
        to_jsonb(linked),to_jsonb(updated_supply),
        jsonb_build_object('table','future_supplies','building_id',new.id,'event_group',event_group,'operation','synchronize_building_identity'),
        event_group || '-future');
    end if;
  end if;
  insert into public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,target_name,old_values,new_values,details,event_id)
  values(actor,'DB_UPDATE','database_trigger','database','buildings',new.id::text,new.name,
    to_jsonb(old),to_jsonb(new),
    jsonb_build_object('table','buildings','event_group',event_group,'operation','rename_or_add_former_names',
      'aliases',array_append(names,new.name),'source_records_rewritten',false),
    event_group || '-building');
  return new;
end;
$$;

-- The master is the only name authority. A stale direct edit of the secondary
-- table must not undo a successful rename or rebind existing assignments.
create or replace function private.guard_future_supply_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  canonical public.buildings%rowtype;
  expected_aliases text[];
begin
  if tg_op='UPDATE' then
    if new.building_id is distinct from old.building_id then
      raise exception using errcode='42501', message='楼宇身份关联不可在普通编辑中更换，请核对项目关联';
    end if;
    if new.name is not distinct from old.name
       and new.former_names is not distinct from old.former_names then return new; end if;
  end if;
  if new.building_id is null then
    if tg_op='INSERT' then return new; end if;
    raise exception using errcode='22023', message='请在项目基础信息中更名；此未来供应记录尚未建立楼宇关联';
  end if;
  select * into canonical from public.buildings where id=new.building_id;
  if not found then raise exception using errcode='23503', message='关联楼宇不存在'; end if;
  select coalesce(array_agg(value order by value),array[]::text[]) into expected_aliases
    from jsonb_array_elements_text(coalesce(canonical.former_names,'[]'::jsonb));
  if new.name is distinct from canonical.name
     or coalesce(new.former_names,array[]::text[]) is distinct from expected_aliases then
    raise exception using errcode='22023', message='请在项目基础信息中修改名称和曾用名，系统会同步未来供应记录';
  end if;
  return new;
end;
$$;

-- Production deliberately grants authenticated users SELECT only on buildings.
-- Provide a narrow admin-only write capability instead of granting table UPDATE.
create or replace function private.admin_rename_building(
  p_id uuid, p_expected_name text, p_expected_former_names jsonb,
  p_new_name text, p_former_names jsonb default null
) returns setof public.buildings
language plpgsql security definer set search_path='' as $$
declare
  current_building public.buildings%rowtype;
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
  select * into current_building from public.buildings where id=p_id for update;
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
    where b.id=p_id returning b.*;
end;
$$;

-- The SQL-standard body resolves the private function at definition time.
-- This wrapper needs no grant of USAGE on the private schema.
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

revoke all on function private.admin_rename_building(uuid,text,jsonb,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_rename_building(uuid,text,jsonb,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_rename_building(uuid,text,jsonb,text,jsonb) to authenticated;
grant execute on function public.admin_rename_building(uuid,text,jsonb,text,jsonb) to authenticated;

revoke all on function private.prepare_building_identity_update() from public,anon,authenticated,service_role;
revoke all on function private.finish_building_identity_update() from public,anon,authenticated,service_role;
revoke all on function private.guard_future_supply_identity() from public,anon,authenticated,service_role;

create trigger buildings_prepare_identity_update before update of name,former_names
on public.buildings for each row execute function private.prepare_building_identity_update();
create trigger buildings_finish_identity_update after update of name,former_names
on public.buildings for each row execute function private.finish_building_identity_update();
create trigger future_supplies_guard_identity before insert or update of name,former_names,building_id
on public.future_supplies for each row execute function private.guard_future_supply_identity();

commit;
