import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const load=f=>readFile(new URL('../../migrations/'+f,import.meta.url),'utf8');
export const BUSINESS_FIELDS=['district','submarket','grade','completionYear','leasableArea','address','brochureDistrict','completionDate','gfaTotal','gfaOffice','standardFloorArea','height','floors','floorsAbove','floorsBelow','parking','metro','leed','well','greenStandard','propertyManagement','delivery','elevators','telecom','hvac','availablePeriods'];
export async function installBusinessFixture(db){
  for(const [name,type] of [['leasable_area','numeric'],['completion_year','text'],['location_lng','double precision'],['location_lat','double precision']])await db.query('alter table public.buildings add column if not exists '+name+' '+type);
  const base=await load('20260801110130_restore_quarterly_oss_admin.sql');
  if(!(await db.query("select to_regclass('public.future_supplies') r")).rows[0].r){
    const a=base.indexOf('create table public.future_supplies (');const b=base.indexOf('create table public.future_supply_assignments',a);assert.ok(a>=0&&b>a);await db.query(base.slice(a,b));
  }
  // Fields from actual additive supply migrations; no production records/seeds.
  for(const [name,type] of [['status','text'],['is_entered_market','boolean'],['building_id','uuid']])await db.query('alter table public.future_supplies add column if not exists '+name+' '+type);
  if(!(await db.query("select to_regclass('public.future_supply_submissions') r")).rows[0].r){
    const a=base.indexOf('create table public.future_supply_submissions (');const statement=base.slice(a,base.indexOf(');',a)+2);assert.ok(a>=0&&statement.includes('future_supply_id'));await db.query(statement);
  }
  await db.query('alter table public.future_supply_submissions add column if not exists updated_at timestamptz default now()');
  if(!(await db.query("select to_regclass('public.map_submarket_profiles') r")).rows[0].r){
    await db.query(await load('20261119122000_map_submarket_profiles.sql'));
    await db.query(await load('20261120123000_submarket_client_publication.sql'));
  }
  if(!(await db.query("select to_regclass('public.stacking_plan_towers') r")).rows[0].r){
    const s=await load('20261118172000_stacking_plan_xiaoyun33_pilot.sql');const end=s.indexOf('-- 权限校验');assert.ok(end>0);await db.query(s.slice(0,end));
  }
  if(!(await db.query("select to_regclass('private.ai_business_research_grants') r")).rows[0].r)await db.query(await load('20261121142158_ai_business_research.sql'));
}
export async function grantBusiness(db,id,options={}){
 await db.query(`insert into private.ai_business_research_grants(user_id,enabled,valid_until,modules,profile_fields,allow_submissions,allow_export,all_submarkets,submarkets,all_buildings,building_ids,change_reference)
 values($1,true,now()+interval '1 day',$2,$3,$4,$5,$6,$7,$8,$9,'synthetic business regression')
 on conflict(user_id) do update set enabled=true,valid_until=excluded.valid_until,modules=excluded.modules,profile_fields=excluded.profile_fields,allow_submissions=excluded.allow_submissions,allow_export=excluded.allow_export,all_submarkets=excluded.all_submarkets,submarkets=excluded.submarkets,all_buildings=excluded.all_buildings,building_ids=excluded.building_ids`,
 [id,options.modules??['profile','submarket','supply','stacking'],options.fields??BUSINESS_FIELDS,options.submissions??true,options.export??true,options.allSubmarkets??false,options.submarkets??['CBD'],options.allBuildings??true,options.buildingIds??[]]);
}
export async function seedBusiness(db,buildingIds,actor){
 await db.query("update public.buildings set district='合成行政区',completion_year='2015',leasable_area=8800,location_lng=116.46,location_lat=39.91 where id=$1",[buildingIds[0]]);
 await db.query("update public.building_brochure_data set address='合成路1号',completion_date='2016-03-01',gfa_total=12345.67,gfa_office=10000,standard_floor_area=1200,building_floors=36,parking_total=0,metro_access='合成地铁',leed_certification='LEED Gold' where building_id=$1",[buildingIds[0]]);
 const supply='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba8';
 await db.query("insert into public.future_supplies(id,name,submarket,district,launch_year,launch_quarter,total_area,status,is_entered_market,building_id,location_lng,location_lat) values($1,'合成未来供应','CBD','合成区','2028','Q2',50000,'planning',false,$2,116.46,39.91)",[supply,buildingIds[0]]);
 for(const [year,quarter,area] of [[2026,2,48000],[2026,3,49000]])await db.query('insert into public.future_supply_submissions(future_supply_id,user_id,user_name,record_year,record_quarter,total_area) values($1,$2,\'合成填报人\',$3,$4,$5)',[supply,actor,year,quarter,area]);
 await db.query("insert into public.map_submarket_profiles(submarket,headline,overview,industries,transport,is_published,published_at) values('CBD','合成区域定位','合成区域介绍','合成产业描述','合成轨道交通',true,now()) on conflict(submarket) do update set headline=excluded.headline,overview=excluded.overview,industries=excluded.industries,transport=excluded.transport,is_published=true,published_at=now()");
 const tower='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba9',floor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbaa',space='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbaf';
 await db.query("insert into public.stacking_plan_sources(id,building_id,title) values('synthetic-business-source',$1,'合成来源')",[buildingIds[0]]);
 await db.query("insert into public.stacking_plan_towers(id,building_id,code,display_name) values($1,$2,'A','合成A座')",[tower,buildingIds[0]]);
 await db.query("insert into public.stacking_plan_floors(id,tower_id,floor_code,level_order,floor_area_sqm,source_id) values($1,$2,'10F',10,1200,'synthetic-business-source')",[floor,tower]);
 await db.query("insert into public.stacking_plan_spaces(id,floor_id,unit_code,occupancy_status,tenant_name,area_sqm,source_id,notes) values($1,$2,'1001','vacant','合成租户_不得传播',600,'synthetic-business-source','合成保密备注')",[space,floor]);
 return {supply,tower,floor,space};
}
