import { readFile } from 'node:fs/promises';
import { createLeaseTestDatabase, OWNER, OTHER, ADMIN, VIEWER } from '../lease-change-history/database.mjs';

export const SESSION='99999999-9999-4999-8999-999999999999';
export async function createAiQueryTestDatabase() {
  const db=await createLeaseTestDatabase();
  try {
    await db.setup.query(`create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz);
      create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
      grant usage on schema public,auth to anon,service_role;`);
    for(const user of [OWNER,OTHER,ADMIN,VIEWER])await db.setup.query('insert into auth.users(id) values($1)',[user]);
    await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)',[SESSION,OWNER]);
    for(const file of ['20261113003933_ai_query_audit_foundation.sql','20261113023341_ai_query_authority.sql'])await db.setup.query(await readFile(new URL(`../../migrations/${file}`,import.meta.url),'utf8'));
    return db;
  }catch(error){await db.close();throw error;}
}
export async function grantQuery(db,user,extra={}) {
  await db.setup.query(`insert into private.ai_query_grants(user_id,enabled,valid_until,capabilities,fields,all_submarkets,submarkets,all_buildings,building_ids,change_reference)
    values($1,true,now()+interval '1 day',$2,$3,$4,$5,$6,$7,'synthetic isolated grant')
    on conflict(user_id) do update set enabled=true,valid_until=excluded.valid_until,capabilities=excluded.capabilities,fields=excluded.fields,all_submarkets=excluded.all_submarkets,submarkets=excluded.submarkets,all_buildings=excluded.all_buildings,building_ids=excluded.building_ids`,
    [user,extra.capabilities??['query:catalog','query:brochure','query:quarter'],extra.fields??['height','totalArea','netEffectiveRent','vacantArea'],extra.allSubmarkets??true,extra.submarkets??[],extra.allBuildings??true,extra.buildingIds??[]]);
}
