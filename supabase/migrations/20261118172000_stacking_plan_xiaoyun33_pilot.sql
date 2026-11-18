-- Stacking Plan 管理员试点：霄云路33号 A/B 两座。
-- 用户上传截图的数据截至日期尚未确认，全部为 source_unverified 草稿；不得当作实时空置。
-- 所有数据仅供真实 Admin 通过受控 API 读取，不开放 public RLS policy。
create table if not exists public.stacking_plan_sources (
  id text primary key,
  building_id uuid not null references public.buildings(id) on delete restrict,
  title text not null,
  source_as_of date,
  as_of_kind text not null default 'unknown' check (as_of_kind in ('unknown','source_data_as_of','owner_confirmed')),
  review_state text not null default 'pending_source_date' check (review_state in ('pending_source_date','verified','rejected')),
  source_note text,
  created_at timestamptz not null default now(),
  check (review_state <> 'verified' or source_as_of is not null)
);
create table if not exists public.stacking_plan_towers (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete restrict,
  code text not null check (length(code) between 1 and 20),
  display_name text not null,
  unique (building_id, code)
);
create table if not exists public.stacking_plan_floors (
  id uuid primary key default gen_random_uuid(),
  tower_id uuid not null references public.stacking_plan_towers(id) on delete cascade,
  floor_code text not null,
  level_order integer not null,
  floor_area_sqm numeric(12,2) check (floor_area_sqm > 0),
  zone text,
  use_type text not null default 'office' check (use_type in ('office','lobby','retail','parking','other')),
  source_id text not null references public.stacking_plan_sources(id),
  unique(tower_id,floor_code)
);
create table if not exists public.stacking_plan_spaces (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.stacking_plan_floors(id) on delete cascade,
  unit_code text not null,
  occupancy_status text not null default 'unknown' check (occupancy_status in ('occupied','vacant','other','unknown')),
  tenant_name text,
  area_sqm numeric(12,2) check (area_sqm > 0),
  lease_steps jsonb not null default '[]'::jsonb check (jsonb_typeof(lease_steps)='array'),
  notes text not null default '',
  verification_status text not null default 'source_unverified' check (verification_status in ('source_unverified','verified')),
  source_id text not null references public.stacking_plan_sources(id),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique(floor_id,unit_code)
);
create table if not exists public.stacking_plan_space_events (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.stacking_plan_spaces(id) on delete restrict,
  actor_id uuid not null,
  before_record jsonb not null,
  after_record jsonb not null,
  recorded_at timestamptz not null default now()
);
create table if not exists public.stacking_plan_export_events (
  id bigint generated always as identity primary key,
  building_id uuid not null references public.buildings(id),
  actor_id uuid not null,
  export_format text not null check (export_format in ('xlsx','png','svg')),
  recorded_at timestamptz not null default now()
);
create index if not exists stacking_plan_towers_by_building on public.stacking_plan_towers(building_id);
create index if not exists stacking_plan_floors_by_tower on public.stacking_plan_floors(tower_id,level_order desc);
create index if not exists stacking_plan_spaces_by_floor on public.stacking_plan_spaces(floor_id);
do $$ begin end $$;
alter table public.stacking_plan_sources enable row level security;
alter table public.stacking_plan_towers enable row level security;
alter table public.stacking_plan_floors enable row level security;
alter table public.stacking_plan_spaces enable row level security;
alter table public.stacking_plan_space_events enable row level security;
alter table public.stacking_plan_export_events enable row level security;
revoke all on public.stacking_plan_sources, public.stacking_plan_towers, public.stacking_plan_floors,
  public.stacking_plan_spaces, public.stacking_plan_space_events, public.stacking_plan_export_events from public, anon, authenticated;
revoke all on sequence public.stacking_plan_space_events_id_seq, public.stacking_plan_export_events_id_seq from public, anon, authenticated;
grant all on public.stacking_plan_sources, public.stacking_plan_towers, public.stacking_plan_floors,
  public.stacking_plan_spaces, public.stacking_plan_space_events, public.stacking_plan_export_events to service_role;
grant usage, select on sequence public.stacking_plan_space_events_id_seq, public.stacking_plan_export_events_id_seq to service_role;

-- 权限校验与写入审计在同一事务内；客户端只能提交有限字段和期望版本。
create schema if not exists private;
create or replace function private.stacking_plan_update_space(p_building_id uuid,p_space_id uuid,p_actor uuid,p_expected_revision integer,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare old_row public.stacking_plan_spaces%rowtype; new_row public.stacking_plan_spaces%rowtype;
begin
  if not exists(select 1 from public.user_roles r join auth.users a on a.id=r.user_id where r.user_id=p_actor and r.role='admin')
  then raise exception 'ADMIN_DENIED' using errcode='42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb or
    exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('tenant_name','occupancy_status','area_sqm','lease_steps','notes'))
  then raise exception 'INVALID_PATCH' using errcode='22023'; end if;
  select s.* into old_row from public.stacking_plan_spaces s
    join public.stacking_plan_floors f on f.id=s.floor_id
    join public.stacking_plan_towers t on t.id=f.tower_id
    where s.id=p_space_id and t.building_id=p_building_id for update of s;
  if not found then raise exception 'SPACE_NOT_FOUND' using errcode='P0002'; end if;
  if old_row.revision<>p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  if p_patch ? 'lease_steps' and jsonb_typeof(p_patch->'lease_steps')<>'array' then raise exception 'INVALID_LEASE_STEPS' using errcode='22023'; end if;
  if p_patch ? 'notes' and length(coalesce(p_patch->>'notes',''))>4000 then raise exception 'NOTES_TOO_LONG' using errcode='22023'; end if;
  update public.stacking_plan_spaces set
    tenant_name=case when p_patch ? 'tenant_name' then nullif(trim(p_patch->>'tenant_name'),'') else tenant_name end,
    occupancy_status=case when p_patch ? 'occupancy_status' then p_patch->>'occupancy_status' else occupancy_status end,
    area_sqm=case when p_patch ? 'area_sqm' then nullif(p_patch->>'area_sqm','')::numeric else area_sqm end,
    lease_steps=case when p_patch ? 'lease_steps' then p_patch->'lease_steps' else lease_steps end,
    notes=case when p_patch ? 'notes' then coalesce(p_patch->>'notes','') else notes end,
    verification_status='source_unverified',
    revision=revision+1,updated_at=now(),updated_by=p_actor
  where id=p_space_id returning * into new_row;
  insert into public.stacking_plan_space_events(space_id,actor_id,before_record,after_record)
  values(p_space_id,p_actor,to_jsonb(old_row),to_jsonb(new_row));
  return to_jsonb(new_row);
end $fn$;
revoke all on function private.stacking_plan_update_space(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.stacking_plan_update_space(uuid,uuid,uuid,integer,jsonb) to service_role;

-- 仅当真实主档存在才录入试点。保持既有楼宇参数、季度和成交数据不变。
insert into public.stacking_plan_sources(id,building_id,title,source_as_of,as_of_kind,review_state,source_note)
select 'xiaoyun33-initial-screenshot',id,'用户提供的霄云路33号 A/B 座租赁水牌截图',null,'unknown','pending_source_date',
 '2026-11-18 收到截图；这不是数据截至日期。图片含原始月租与若干阶梯租金、部分名称不清晰；不可当作现时已核实房源。'
from public.buildings where id='9ee3e3ff-4845-41a1-a78f-390c11b1917a'::uuid on conflict(id) do nothing;
insert into public.stacking_plan_towers(building_id,code,display_name)
select b.id,t.code,t.name from public.buildings b cross join(values('A','A 座'),('B','B 座')) as t(code,name)
where b.id='9ee3e3ff-4845-41a1-a78f-390c11b1917a'::uuid on conflict(building_id,code) do nothing;
insert into public.stacking_plan_floors(tower_id,floor_code,level_order,floor_area_sqm,zone,use_type,source_id)
select t.id, f.code,f.level_order,f.area,f.zone,f.use_type,'xiaoyun33-initial-screenshot' from
(values
('A','20',20,1214.57,'高区','office'),
('A','19',19,1214.57,'高区','office'),
('A','18',18,1214.57,'高区','office'),
('A','17',17,863.1,'高区','office'),
('A','16',16,1716.47,'高区','office'),
('A','15',15,1716.47,'高区','office'),
('A','14',14,1716.47,'高区','office'),
('A','13',13,1716.47,'高区','office'),
('A','12',12,1716.47,'高区','office'),
('A','11',11,1716.47,'高区','office'),
('A','10',10,1716.47,'低区','office'),
('A','9',9,1716.47,'低区','office'),
('A','8',8,1716.47,'低区','office'),
('A','7',7,1716.47,'低区','office'),
('A','6',6,1716.47,'低区','office'),
('A','5',5,1716.47,'低区','office'),
('A','4',4,1716.47,'低区','office'),
('A','3',3,1716.47,'低区','office'),
('A','1',1,NULL,'首层','lobby'),
('A','B1',-1,NULL,'地下','other'),
('A','B2',-2,NULL,'地下','parking'),
('A','B3',-3,NULL,'地下','parking'),
('B','24',24,1633.41,'高区','office'),
('B','23',23,1633.41,'高区','office'),
('B','22',22,1633.41,'高区','office'),
('B','21',21,1633.41,'高区','office'),
('B','20',20,1633.41,'高区','office'),
('B','19',19,1633.41,'高区','office'),
('B','18',18,1633.41,'高区','office'),
('B','17',17,1633.41,'高区','office'),
('B','16',16,1633.41,'高区','office'),
('B','15',15,1633.41,'高区','office'),
('B','14',14,1629.03,'高区','office'),
('B','13',13,1629.03,'高区','office'),
('B','12',12,1629.03,'低区','office'),
('B','11',11,1629.03,'低区','office'),
('B','10',10,1629.03,'低区','office'),
('B','9',9,1629.03,'低区','office'),
('B','8',8,1629.03,'低区','office'),
('B','7',7,1629.03,'低区','office'),
('B','6',6,1629.03,'低区','office'),
('B','5',5,1629.03,'低区','office'),
('B','4',4,1537.5,'低区','office'),
('B','3',3,2341.05,'低区','office'),
('B','2',2,1609.39,'低区','office'),
('B','1',1,70,'首层','retail'),
('B','B1',-1,NULL,'地下','retail'),
('B','B2',-2,NULL,'地下','parking'),
('B','B3',-3,NULL,'地下','parking')
) as f(tower,code,level_order,area,zone,use_type)
join public.stacking_plan_towers t on t.code=f.tower and t.building_id='9ee3e3ff-4845-41a1-a78f-390c11b1917a'::uuid
where exists(select 1 from public.stacking_plan_sources where id='xiaoyun33-initial-screenshot')
on conflict(tower_id,floor_code) do nothing;
with src as (
 select * from jsonb_to_recordset('[{"tower":"A","floor_code":"20","unit_code":"整层","occupancy_status":"vacant","area_sqm":1214.57,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"19","unit_code":"整层","occupancy_status":"vacant","area_sqm":1214.57,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"18","unit_code":"整层","occupancy_status":"vacant","area_sqm":1214.57,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"17","unit_code":"整层","occupancy_status":"vacant","area_sqm":863.1,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"16","unit_code":"整层","occupancy_status":"vacant","area_sqm":1716.47,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"15","unit_code":"整层","occupancy_status":"other","area_sqm":1716.47,"tenant_name":"还建面积","lease_steps":[],"notes":"原图标注为还建面积，不计入普通已租/空置"},{"tower":"A","floor_code":"14","unit_code":"整层","occupancy_status":"other","area_sqm":1716.47,"tenant_name":"还建面积","lease_steps":[],"notes":"原图标注为还建面积，不计入普通已租/空置"},{"tower":"A","floor_code":"13","unit_code":"整层","occupancy_status":"other","area_sqm":1716.47,"tenant_name":"还建面积","lease_steps":[],"notes":"原图标注为还建面积，不计入普通已租/空置"},{"tower":"A","floor_code":"12","unit_code":"整层","occupancy_status":"other","area_sqm":1716.47,"tenant_name":"还建面积","lease_steps":[],"notes":"原图标注为还建面积，不计入普通已租/空置"},{"tower":"A","floor_code":"11","unit_code":"整层","occupancy_status":"other","area_sqm":1716.47,"tenant_name":"还建面积","lease_steps":[],"notes":"原图标注为还建面积，不计入普通已租/空置"},{"tower":"A","floor_code":"10","unit_code":"整层","occupancy_status":"vacant","area_sqm":1716.47,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"9","unit_code":"整层","occupancy_status":"vacant","area_sqm":1716.47,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"8","unit_code":"整层","occupancy_status":"vacant","area_sqm":1716.47,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"7","unit_code":"整层","occupancy_status":"vacant","area_sqm":1716.47,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"6","unit_code":"整层","occupancy_status":"vacant","area_sqm":1716.47,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"A","floor_code":"5","unit_code":"整层","occupancy_status":"occupied","area_sqm":1716.47,"tenant_name":"奥迪","lease_steps":[{"start":"2023-12-01","end":"2025-10-31","face_rent_monthly":330,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"},{"start":"2025-11-01","end":"2028-12-31","face_rent_monthly":360,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":"3–5层合计5,149.41㎡，分层面积按原图逐层记录"},{"tower":"A","floor_code":"4","unit_code":"整层","occupancy_status":"occupied","area_sqm":1716.47,"tenant_name":"奥迪","lease_steps":[{"start":"2023-12-01","end":"2025-10-31","face_rent_monthly":330,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"},{"start":"2025-11-01","end":"2028-12-31","face_rent_monthly":360,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":"3–5层合计5,149.41㎡，分层面积按原图逐层记录"},{"tower":"A","floor_code":"3","unit_code":"整层","occupancy_status":"occupied","area_sqm":1716.47,"tenant_name":"奥迪","lease_steps":[{"start":"2023-12-01","end":"2025-10-31","face_rent_monthly":330,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"},{"start":"2025-11-01","end":"2028-12-31","face_rent_monthly":360,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":"3–5层合计5,149.41㎡，分层面积按原图逐层记录"},{"tower":"A","floor_code":"1","unit_code":"全层","occupancy_status":"other","area_sqm":null,"tenant_name":"大堂","lease_steps":[],"notes":""},{"tower":"A","floor_code":"B1","unit_code":"全层","occupancy_status":"other","area_sqm":null,"tenant_name":"还建面积","lease_steps":[],"notes":""},{"tower":"A","floor_code":"B2","unit_code":"全层","occupancy_status":"other","area_sqm":null,"tenant_name":"停车场","lease_steps":[],"notes":""},{"tower":"A","floor_code":"B3","unit_code":"全层","occupancy_status":"other","area_sqm":null,"tenant_name":"停车场","lease_steps":[],"notes":""},{"tower":"B","floor_code":"24","unit_code":"整层","occupancy_status":"vacant","area_sqm":1633.41,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"23","unit_code":"整层","occupancy_status":"vacant","area_sqm":1633.41,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"22","unit_code":"整层","occupancy_status":"vacant","area_sqm":1633.41,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"21","unit_code":"整层","occupancy_status":"vacant","area_sqm":1633.41,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"20","unit_code":"整层","occupancy_status":"vacant","area_sqm":1633.41,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"19","unit_code":"整层","occupancy_status":"vacant","area_sqm":1633.41,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"18","unit_code":"01","occupancy_status":"occupied","area_sqm":941.84,"tenant_name":"日立数据","lease_steps":[{"start":"2023-09-01","end":"2026-08-31","face_rent_monthly":375,"area_sqm":1633.41,"currency":"CNY","unit":"元/㎡/月"},{"start":"2026-09-01","end":"2029-08-31","face_rent_monthly":220,"area_sqm":941.84,"currency":"CNY","unit":"元/㎡/月"}],"notes":"原图：已完成分租，续租面积941.84㎡；前一租期原租约为整层"},{"tower":"B","floor_code":"18","unit_code":"02","occupancy_status":"vacant","area_sqm":691.57,"tenant_name":null,"lease_steps":[],"notes":"原图明确标注空置691.57㎡；截至日期尚未确认"},{"tower":"B","floor_code":"17","unit_code":"整层","occupancy_status":"occupied","area_sqm":1633.41,"tenant_name":"世开科技","lease_steps":[{"start":"2026-04-13","end":"2029-07-12","face_rent_monthly":165,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":""},{"tower":"B","floor_code":"16","unit_code":"整层","occupancy_status":"vacant","area_sqm":1633.41,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"15","unit_code":"整层","occupancy_status":"vacant","area_sqm":1633.41,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"14","unit_code":"整层","occupancy_status":"vacant","area_sqm":1629.03,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"13","unit_code":"整层","occupancy_status":"occupied","area_sqm":1629.03,"tenant_name":"大金科技","lease_steps":[{"start":"2023-10-01","end":"2026-09-30","face_rent_monthly":360,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"},{"start":"2026-10-01","end":"2028-09-30","face_rent_monthly":390,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":""},{"tower":"B","floor_code":"12","unit_code":"01","occupancy_status":"occupied","area_sqm":814.52,"tenant_name":"李尔顿（名称待核验）","lease_steps":[{"start":"2023-04-14","end":"2025-04-13","face_rent_monthly":360,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"},{"start":"2026-10-01","end":"2028-09-30","face_rent_monthly":390,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":"原图字样较模糊、两阶段租期存在未覆盖期间，原样保留待核实"},{"tower":"B","floor_code":"12","unit_code":"02","occupancy_status":"vacant","area_sqm":814.51,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"11","unit_code":"整层","occupancy_status":"occupied","area_sqm":1629.03,"tenant_name":"SK润滑油","lease_steps":[{"start":null,"end":null,"face_rent_monthly":220,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":"原图未提供明确租期"},{"tower":"B","floor_code":"10","unit_code":"整层","occupancy_status":"other","area_sqm":1629.03,"tenant_name":"样板区","lease_steps":[],"notes":"非普通租赁面积"},{"tower":"B","floor_code":"9","unit_code":"整层","occupancy_status":"occupied","area_sqm":1629.03,"tenant_name":"米可世界","lease_steps":[{"start":"2023-01-01","end":"2025-12-31","face_rent_monthly":335,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"},{"start":"2026-01-01","end":"2027-12-31","face_rent_monthly":365,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":"8–9层合计3,258.06㎡"},{"tower":"B","floor_code":"8","unit_code":"整层","occupancy_status":"occupied","area_sqm":1629.03,"tenant_name":"米可世界","lease_steps":[{"start":"2023-01-01","end":"2025-12-31","face_rent_monthly":335,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"},{"start":"2026-01-01","end":"2027-12-31","face_rent_monthly":365,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":"8–9层合计3,258.06㎡"},{"tower":"B","floor_code":"7","unit_code":"整层","occupancy_status":"occupied","area_sqm":1629.03,"tenant_name":"赤子城","lease_steps":[{"start":"2023-01-01","end":"2025-12-31","face_rent_monthly":335,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"},{"start":"2026-01-01","end":"2027-12-31","face_rent_monthly":365,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":"6–7层合计3,258.06㎡"},{"tower":"B","floor_code":"6","unit_code":"整层","occupancy_status":"occupied","area_sqm":1629.03,"tenant_name":"赤子城","lease_steps":[{"start":"2023-01-01","end":"2025-12-31","face_rent_monthly":335,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"},{"start":"2026-01-01","end":"2027-12-31","face_rent_monthly":365,"area_sqm":null,"currency":"CNY","unit":"元/㎡/月"}],"notes":"6–7层合计3,258.06㎡"},{"tower":"B","floor_code":"5","unit_code":"整层","occupancy_status":"vacant","area_sqm":1629.03,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"4","unit_code":"整层","occupancy_status":"vacant","area_sqm":1537.5,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"3","unit_code":"整层","occupancy_status":"vacant","area_sqm":2341.05,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"2","unit_code":"整层","occupancy_status":"vacant","area_sqm":1609.39,"tenant_name":null,"lease_steps":[],"notes":""},{"tower":"B","floor_code":"1","unit_code":"商铺","occupancy_status":"occupied","area_sqm":70,"tenant_name":"瑞幸咖啡","lease_steps":[{"start":null,"end":null,"face_rent_monthly":null,"monthly_total_rent":20000,"currency":"CNY","unit":"元/月"}],"notes":"原图标注月总租金20,000元，不是每平方米租金"},{"tower":"B","floor_code":"B1","unit_code":"102","occupancy_status":"occupied","area_sqm":273.53,"tenant_name":"富裕宅（名称待核验）","lease_steps":[],"notes":"原图字号较小，租户名称待核验"},{"tower":"B","floor_code":"B1","unit_code":"103","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"104","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"106","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"107","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"108","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"112","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"115","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"116","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"117","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"118","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"119","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"124","occupancy_status":"unknown","area_sqm":null,"tenant_name":null,"lease_steps":[],"notes":"原图有单元编号，尚不能判定出租状态和面积"},{"tower":"B","floor_code":"B1","unit_code":"123","occupancy_status":"other","area_sqm":null,"tenant_name":"员工餐厅","lease_steps":[],"notes":"原图标注123员工餐厅"},{"tower":"B","floor_code":"B2","unit_code":"全层","occupancy_status":"other","area_sqm":null,"tenant_name":"停车场","lease_steps":[],"notes":""},{"tower":"B","floor_code":"B3","unit_code":"全层","occupancy_status":"other","area_sqm":null,"tenant_name":"停车场","lease_steps":[],"notes":""}]'::jsonb) as x(
 tower text,floor_code text,unit_code text,occupancy_status text,area_sqm numeric,tenant_name text,lease_steps jsonb,notes text)
)
insert into public.stacking_plan_spaces(floor_id,unit_code,occupancy_status,tenant_name,area_sqm,lease_steps,notes,source_id)
select f.id,x.unit_code,x.occupancy_status,x.tenant_name,x.area_sqm,coalesce(x.lease_steps,'[]'::jsonb),coalesce(x.notes,''),'xiaoyun33-initial-screenshot'
from src x join public.stacking_plan_towers t on t.code=x.tower and t.building_id='9ee3e3ff-4845-41a1-a78f-390c11b1917a'::uuid
join public.stacking_plan_floors f on f.tower_id=t.id and f.floor_code=x.floor_code
on conflict(floor_id,unit_code) do nothing;
