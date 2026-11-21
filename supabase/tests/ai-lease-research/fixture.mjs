import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
// Disposable fixture only, including the EXACT governed read-view DDL, without
// replaying historical production name/record INSERT statements.
export async function installLeaseResearchFixture(db) {
  if (!(await db.query("select to_regclass('public.lease_transactions_history') r")).rows[0].r) {
    const source = await read('../lease-expiry/fixture.sql');
    const history = source.slice(source.indexOf('create table public.lease_transactions_history('), source.indexOf('create table public.lease_building_name_map'));
    assert.ok(history.includes('source_info_date'));
    await db.query(history);
    await db.query('alter table public.lease_transactions_history alter column submitter_id type varchar using submitter_id::text');
  }
    await db.query(`create table if not exists public.lease_building_name_map(market_code text,alias_name text,building_id uuid,match_method text default 'manual',primary key(market_code,alias_name));
      create table if not exists public.lease_building_project_map(market_code text,alias_name text,building_id uuid,primary key(market_code,alias_name,building_id));
      create table if not exists public.lease_building_record_map(source_uid text primary key,market_code text,building_id uuid);`);
    for (const table of ['lease_transactions_history','lease_building_name_map','lease_building_project_map','lease_building_record_map']) {
      await db.query(`alter table public.${table} enable row level security`);
      await db.query(`revoke all on public.${table} from public,anon,authenticated`);
      await db.query(`grant select on public.${table} to service_role`);
    }
  // A legacy narrow company fixture view has different columns: only disposable DDL is replaced.
  await db.query('drop view if exists public.lease_transactions_read_v1');
  const migration = await read('../../migrations/20260921020006_separate_reference_buildings_from_operational_inventory_v19.sql');
  const view = migration.slice(migration.indexOf('create or replace view public.lease_transactions_read_v1'), migration.indexOf('revoke all on public.lease_transactions_read_v1'));
  assert.ok(view.includes('rm.source_uid=h.source_uid'));
  await db.query(view);
  await db.query('revoke all on public.lease_transactions_read_v1 from public,anon,authenticated; grant select on public.lease_transactions_read_v1 to service_role');
  if (!(await db.query("select to_regclass('private.ai_lease_research_grants') r")).rows[0].r)
    await db.query(await read('../../migrations/20261121131205_ai_lease_research.sql'));
}
export async function grantLeaseResearch(db, id, options = {}) {
  await db.query(`insert into private.ai_lease_research_grants(user_id,enabled,valid_until,sources,allow_details,allow_financials,allow_export,
    all_submarkets,all_buildings,submarkets,building_ids,change_reference)
    values($1,true,now()+interval '1 day',$2,$3,$4,$5,$6,$7,$8,$9,'synthetic isolated research grant')
    on conflict(user_id) do update set enabled=true,valid_until=excluded.valid_until,sources=excluded.sources,allow_details=excluded.allow_details,
    allow_financials=excluded.allow_financials,allow_export=excluded.allow_export,all_submarkets=excluded.all_submarkets,
    all_buildings=excluded.all_buildings,submarkets=excluded.submarkets,building_ids=excluded.building_ids`,
    [id,options.sources??['live','history'],options.details??true,options.financials??false,options.export??true,
      options.allSubmarkets??true,options.allBuildings??true,options.submarkets??[],options.buildingIds??[]]);
}
export async function seedLeaseResearch(db, buildingIds) {
  const ids = Array.from({length: 8},(_,i)=>'eeeeeeee-eeee-4eee-8eee-' + String(i+1).padStart(12,'0'));
  await db.query(`insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method) values('BJ','合成历史楼名',$1,'manual') on conflict do nothing;
    `,[buildingIds[0]]);
  for (const id of buildingIds.slice(0,2)) await db.query("insert into public.lease_building_project_map(market_code,alias_name,building_id) values('BJ','合成多栋项目',$1) on conflict do nothing",[id]);
  for (let i=0;i<4;i++) await db.query(`insert into public.lease_transactions(id,company,new_building,industry,sub_market,area_sqm,face_rent,effective_rent,transaction_year,transaction_quarter,transaction_date)
    values($1,'合成保密客户_禁止模型日志','合成历史楼名',$2,'CBD',$3,260,210,2026,$4,$5)`,
    [ids[i],i===3?'金融业':'TMT',i===0?'100.25':i===1?'0':i===2?null:'200.50',i===3?'Q2':'Q1',null]);
  for (let i=4;i<8;i++) await db.query(`insert into public.lease_transactions_history(id,source_uid,company,new_building,industry,sub_market,area_sqm,face_rent,effective_rent,management_fee,transaction_year,transaction_quarter)
    values($1,$2,'合成保密客户_禁止模型日志',$3,'TMT','CBD',$4,180,150,30,$5,$6)`,
    [ids[i],'synthetic-lease-'+i,i===4?'合成历史楼名':i===5?'合成多栋项目':i===6?'合成未知项目':'合成记录级旧名',
      i===4?'100.25':i===5?'500':i===6?'75':'300',i===6?null:2026,i===4?'Q1':i===7?'Q2':null]);
  await db.query("insert into public.lease_building_record_map values('synthetic-lease-7','BJ',$1)",[buildingIds[1]]);
  await db.query(`insert into private.ai_lease_verified_duplicates(live_id,history_id,live_fingerprint,history_fingerprint,evidence_reference,change_reference)
    select $1,$2,encode(sha256(convert_to(to_jsonb(l)::text,'UTF8')),'hex'),encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex'),'synthetic independently verified transaction identity','synthetic regression'
    from public.lease_transactions_read_v1 l,public.lease_transactions_read_v1 h
    where l.record_source='live' and l.source_record_id=$1 and h.record_source='history' and h.source_record_id=$2`,[ids[0],ids[4]]);
  return { ids };
}
