import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAiQueryTestDatabase, grantQuery, SESSION } from '../ai-query-authority/database.mjs';
import { addSnapshotFixture, BUILDINGS } from '../ai-query-authority/snapshot-fixture.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
import { OWNER, OTHER } from '../lease-change-history/database.mjs';
import { installBusinessFixture, grantBusiness, seedBusiness } from './fixture.mjs';
const db=await createAiQueryTestDatabase();
const profile={tool:'query_building_dossier',buildingIds:[BUILDINGS[0]],fields:['district','address','completionYear','completionDate','leasableArea','gfaTotal','parking','availablePeriods']};
async function snap(plan=profile,actor=OWNER,session=SESSION){
 await db.setup.query('begin');try{await db.setup.query('set local role service_role');const r=await db.setup.query('select public.ai_business_research_snapshot($1,$1,$2,$3) v',[actor,session,plan]);await db.setup.query('commit');return r.rows[0].v;}catch(e){await db.setup.query('rollback');throw e;}
}
const check=async(name,fn)=>{await fn();console.log('PASS AI5 business: '+name);};
try{
 await loadAuditPrerequisites(db);await applyAdminOnly(db);await addSnapshotFixture(db);await installBusinessFixture(db.setup);
 await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);await db.setup.query('update private.ai_query_control set enabled=true');
 await grantQuery(db,OWNER,{fields:['height','floors','parking','totalArea','netEffectiveRent','vacantArea']});await seedBusiness(db.setup,BUILDINGS,OWNER);
 await check('existing AI grant does not grant new business modules',async()=>assert.equal((await snap()).allowed,false));
 await grantBusiness(db.setup,OWNER);
 await check('fixed profile fields preserve source, areas, zero and both dates',async()=>{
  const r=await snap();assert.equal(r.allowed,true);const data=r.records[0].data;
  assert.equal(data[0].values.leasableArea,'8800');assert.equal(data[0].values.completionYear,'2015');
  assert.equal(data[1].values.gfaTotal,'12345.67');assert.equal(data[1].values.parking,'0');assert.equal(data[1].values.completionDate,'2016-03-01');
  assert.deepEqual([...new Set(data.slice(2).map(d=>d.values.availablePeriods))],['2026Q2','2026Q3']);assert.ok(data.slice(2).every(d=>d.id!==BUILDINGS[0]&&d.period.year===2026));assert.equal(JSON.stringify(r).includes('contact_phone'),false);
 });
 await check('Pitch dossier adds only explicitly opted-in names and preserves raw catalog/brochure differences',async()=>{
  const fields=['nameEn','brochureNameCn','brochureSubmarket','brochureGrade','grade','submarket'];
  const plan={tool:'query_building_dossier',buildingIds:[BUILDINGS[0]],fields};
  assert.equal((await snap(plan)).allowed,false);
  await db.setup.query(await readFile(new URL('../../migrations/20261126181849_pitch3_building_dossier_fields.sql',import.meta.url),'utf8'));
  assert.equal((await snap(plan)).allowed,false);
  assert.equal((await snap()).allowed,true);
  await db.setup.query("update public.building_brochure_data set name_en='Synthetic Office',name_cn='合成楼书名',submarket='合成楼书区域',grade='合成楼书分级' where building_id=$1",[BUILDINGS[0]]);
  await grantBusiness(db.setup,OWNER,{fields});
  const allowed=await snap(plan), records=allowed.records[0].data;
  assert.equal(allowed.allowed,true);
  assert.equal(records[0].values.submarket,'CBD');
  assert.equal(records[1].values.brochureSubmarket,'合成楼书区域');
  assert.equal(records[1].values.nameEn,'Synthetic Office');
  assert.equal(records[1].values.brochureNameCn,'合成楼书名');
  assert.equal(records[1].values.brochureGrade,'合成楼书分级');
  assert.match(records[1].version,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(records).includes('contact_phone'),false);
  await grantBusiness(db.setup,OWNER);
 });
 await check('field restrictions and legacy brochure/quarter grants intersect',async()=>{
  await grantBusiness(db.setup,OWNER,{fields:['address']});assert.equal((await snap()).allowed,false);assert.equal((await snap({...profile,fields:['address']})).allowed,true);
  await grantBusiness(db.setup,OWNER);await grantQuery(db,OWNER,{capabilities:['query:catalog']});assert.equal((await snap()).allowed,false);
  await grantQuery(db,OWNER,{fields:['height','floors','parking','totalArea']});
 });
 await check('building and submarket scopes intersect; briefs need whole authorized market',async()=>{
  await grantBusiness(db.setup,OWNER,{allBuildings:false,buildingIds:[BUILDINGS[0]]});assert.equal((await snap({...profile,buildingIds:[BUILDINGS[1]]})).allowed,false);
  assert.equal((await snap({tool:'query_submarket_profile',submarkets:['CBD']})).allowed,false);
  await grantBusiness(db.setup,OWNER);await grantQuery(db,OWNER,{allSubmarkets:false,submarkets:['金融街']});assert.equal((await snap()).allowed,false);
  await grantQuery(db,OWNER,{fields:['height','floors','parking','totalArea']});
 });
 await check('future catalog and submitted periods are distinct; no submitter identities',async()=>{
  const plan={tool:'query_future_supply',submarkets:['CBD'],source:'catalog'};const r=await snap(plan);assert.equal(r.records.length,1);assert.equal(r.records[0].data.length,1);
  const latest=await snap({...plan,source:'latest_submitted'});assert.equal(latest.records[0].data[1].values.submittedArea,'49000');assert.deepEqual(latest.records[0].data[1].period,{year:2026,quarter:3});
  assert.equal(JSON.stringify(latest).includes('合成填报人'),false);await grantBusiness(db.setup,OWNER,{submissions:false});assert.equal((await snap({...plan,source:'latest_submitted'})).allowed,false);await grantBusiness(db.setup,OWNER);
 });
 await check('Stacking Plan uses actual tower/floor/unit identities without tenant, notes or original paths',async()=>{
  const r=await snap({tool:'query_stacking_plan',buildingIds:[BUILDINGS[0]]});assert.equal(r.records.length,1);assert.equal(r.records[0].data[1].values.towerCode,'A');assert.equal(r.records[0].data[3].values.status,'vacant');assert.equal(r.records[0].data[4].values.sourceDate,null);
  for(const secret of ['合成租户','tenant_name','notes','lease_steps','evidence_storage_path'])assert.equal(JSON.stringify(r).includes(secret),false);
  await db.setup.query("update public.stacking_plan_sources set source_as_of='2026-01-01' where id='synthetic-business-source'");
  const pending=await snap({tool:'query_stacking_plan',buildingIds:[BUILDINGS[0]]});assert.equal(pending.records[0].data[4].values.sourceDate,'2026-01-01');assert.equal(pending.records[0].data[4].asOf,null);
  await db.setup.query("update public.stacking_plan_sources set as_of_kind='source_data_as_of',review_state='verified' where id='synthetic-business-source'");assert.equal((await snap({tool:'query_stacking_plan',buildingIds:[BUILDINGS[0]]})).records[0].data[4].asOf,'2026-01-01');
  await db.setup.query("update public.stacking_plan_sources set source_as_of=null,as_of_kind='unknown',review_state='pending_source_date' where id='synthetic-business-source'");
  const brief=await snap({tool:'query_submarket_profile',submarkets:['CBD']});assert.equal(brief.records[0].data[0].asOf,null);
 });
 await check('Pitch tower identity includes empty towers and retains existing stacking permissions',async()=>{
  const request={tool:'query_building_towers',buildingIds:[BUILDINGS[0]]};
  await db.setup.query("insert into public.stacking_plan_towers(building_id,code,display_name) values($1,'B','合成空B座')",[BUILDINGS[0]]);
  const r=await snap(request);
  assert.equal(r.allowed,true);
  assert.deepEqual(r.records.map(item=>item.data[0].values.towerCode).sort(),['A','B']);
  assert.ok(r.records.every(item=>item.buildingId===BUILDINGS[0]&&item.data.length===1&&item.data[0].table==='stacking_plan_towers'));
  assert.equal((await snap(request,OTHER)).allowed,false);
  await grantBusiness(db.setup,OWNER,{modules:['profile']});
  assert.equal((await snap(request)).allowed,false);
  await grantBusiness(db.setup,OWNER);
 });
 await check('viewer/editor, cross-user, expired/revoked research and stale sessions fail closed',async()=>{
  for(const role of ['viewer','editor']){await db.setup.query('update public.user_roles set role=$1 where user_id=$2',[role,OWNER]);assert.equal((await snap({tool:'query_stacking_plan',buildingIds:[BUILDINGS[0]]})).allowed,false);}
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);assert.equal((await snap(profile,OTHER)).allowed,false);
  await db.setup.query("update private.ai_business_research_grants set valid_until=now()-interval '1 sec' where user_id=$1",[OWNER]);assert.equal((await snap()).allowed,false);
  await grantBusiness(db.setup,OWNER);const prior=await snap();await db.setup.query('update private.ai_business_research_grants set enabled=false where user_id=$1',[OWNER]);assert.equal((await snap()).allowed,false);await grantBusiness(db.setup,OWNER);assert.notEqual((await snap()).permission_revision,prior.permission_revision);
 });
 await check('module isolation and stale/deleted/banned identity fail closed',async()=>{
  await grantBusiness(db.setup,OWNER,{modules:['profile']});assert.equal((await snap({tool:'query_stacking_plan',buildingIds:[BUILDINGS[0]]})).allowed,false);await grantBusiness(db.setup,OWNER);
  assert.equal((await snap(profile,OWNER,'88888888-8888-4888-8888-888888888888')).allowed,false);
  await db.setup.query("update auth.sessions set not_after=now()-interval '1 sec' where id=$1",[SESSION]);assert.equal((await snap()).allowed,false);await db.setup.query('update auth.sessions set not_after=null where id=$1',[SESSION]);
  for(const column of ['deleted_at','banned_until']){await db.setup.query('update auth.users set '+column+"=now()+interval '1 day' where id=$1",[OWNER]);assert.equal((await snap()).allowed,false);await db.setup.query('update auth.users set '+column+'=null where id=$1',[OWNER]);}
 });
 await check('cross-building stacking source links are rejected rather than silently removed',async()=>{
  await db.setup.query('update public.stacking_plan_sources set building_id=$1 where id=\'synthetic-business-source\'',[BUILDINGS[1]]);
  await assert.rejects(()=>snap({tool:'query_stacking_plan',buildingIds:[BUILDINGS[0]]}),/STACKING_IDENTITY_MISMATCH/);
  await db.setup.query('update public.stacking_plan_sources set building_id=$1 where id=\'synthetic-business-source\'',[BUILDINGS[0]]);
 });
 await check('over-limit supply pools return an explicit limit state without a partial table',async()=>{
  await db.setup.query("insert into public.future_supplies(name,submarket,district,launch_year,launch_quarter,total_area,location_lng,location_lat) select '合成超限'||n,'CBD','合成区','2028','Q1',100,116.46,39.91 from generate_series(1,5000) n");
  const r=await snap({tool:'query_future_supply',submarkets:['CBD'],source:'catalog'});assert.equal(r.allowed,true);assert.equal(r.over_limit,true);assert.equal(r.records,undefined);
  await db.setup.query("delete from public.future_supplies where name like '合成超限%'");
 });
 await check('source revisions invalidate snapshots; private policy maintenance remains audited and service/client denied',async()=>{
  const before=await snap();await db.setup.query("update public.building_brochure_data set address='合成修订地址' where building_id=$1",[BUILDINGS[0]]);assert.notDeepEqual((await snap()).records,before.records);
  assert.ok((await db.setup.query("select 1 from private.ai_query_policy_events where relation_name='ai_business_research_grants'")).rowCount>0);
  for(const role of ['anon','authenticated','service_role']){await db.setup.query('begin');try{await db.setup.query('set local role '+role);await assert.rejects(()=>db.setup.query('select * from private.ai_business_research_grants'));}finally{await db.setup.query('rollback');}}
  const functions=(await db.setup.query("select n.nspname,p.prosecdef,p.proconfig,has_function_privilege('authenticated',p.oid,'execute') client from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='ai_business_research_snapshot'")).rows;
  assert.equal(functions.length,2);for(const f of functions){assert.equal(f.client,false);assert.equal(f.prosecdef,f.nspname==='private');assert.ok(f.proconfig.includes('search_path=""'));}
 });
}finally{await db.close();}
