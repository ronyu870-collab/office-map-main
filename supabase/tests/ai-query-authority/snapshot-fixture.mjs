import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const source=file=>readFile(new URL(`../../migrations/${file}`,import.meta.url),'utf8');
export const BUILDINGS=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'];
export async function addSnapshotFixture(db,{existingTables=false}={}){
  const base=await source('20260730043721_create_colliers_lite_schema.sql');
  const tables=base.slice(base.indexOf('create table public.buildings ('),base.indexOf('create table public.lease_transactions ('));
  assert.ok(tables.includes('unique (building_id, record_year, record_quarter)'));
  if(!existingTables)await db.setup.query(tables);
  await db.setup.query("alter table public.buildings add column tracking_scope text not null default 'tracked',add column merged_into_id uuid references public.buildings(id)");
  await db.setup.query(await source('20260910160000_add_building_brochure_compare_data.sql'));
  const parity=await source('20260927045505_viewer_readonly_editor_parity.sql');
  const helpers=parity.slice(parity.indexOf('create or replace function private.map_can_view_extended_inventory()'),parity.indexOf('drop policy if exists "role scoped read buildings"'));
  assert.ok(helpers.includes('private.map_building_visible'));await db.setup.query(helpers);
  await db.setup.query(await source('20261113024629_ai_query_snapshot_read.sql'));
  for(let i=0;i<4;i++){
    const id=BUILDINGS[i];await db.setup.query("insert into public.buildings(id,name,submarket,grade) values($1,$2,'CBD','A')",[id,`${String.fromCharCode(65+i)}座`]);
    for(const quarter of [2,3])await db.setup.query('insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft) values($1,2026,$2,$3,$4,$5,false)',[id,quarter,[10000,30000,20000,10000][i],(quarter===3?[100,200,null,150]:[90,180,160,140])[i],(quarter===3?[1000,6000,null,15000]:[2000,3000,4000,1000])[i]]);
    for(const height of [[210],[198],[null],[200,230]][i])await db.setup.query('insert into public.building_brochure_data(building_id,building_height,parking_total) values($1,$2,9999)',[id,height]);
  }
  return {helpers};
}
