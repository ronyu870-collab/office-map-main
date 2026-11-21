import assert from 'node:assert/strict';
import { createAiQueryTestDatabase, grantQuery, SESSION } from '../ai-query-authority/database.mjs';
import { addSnapshotFixture, BUILDINGS } from '../ai-query-authority/snapshot-fixture.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
import { OWNER, OTHER } from '../lease-change-history/database.mjs';
import { installLeaseResearchFixture, grantLeaseResearch, seedLeaseResearch } from './fixture.mjs';
const db = await createAiQueryTestDatabase();
async function snapshot(actor = OWNER, session = SESSION) {
  await db.setup.query('begin');
  try {
    await db.setup.query('set local role service_role');
    const result = await db.setup.query('select public.ai_lease_research_snapshot($1,$1,$2) value',[actor,session]);
    await db.setup.query('commit'); return result.rows[0].value;
  } catch (error) { await db.setup.query('rollback'); throw error; }
}
async function check(name, fn) { await fn(); console.log('PASS AI5 lease: '+name); }
try {
  await loadAuditPrerequisites(db); await applyAdminOnly(db); await addSnapshotFixture(db);
  await installLeaseResearchFixture(db.setup);
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);
  await db.setup.query('update private.ai_query_control set enabled=true'); await grantQuery(db,OWNER);
  const seeded = await seedLeaseResearch(db.setup,BUILDINGS);
  await check('existing AI grant never implies lease research access',async()=>assert.equal((await snapshot()).allowed,false));
  await grantLeaseResearch(db.setup,OWNER);
  await check('real governed view, live/history coverage and separate source identities',async()=>{
    const s = await snapshot(); assert.equal(s.allowed,true); assert.equal(s.rows.filter(r=>r.id.includes('eeeeeeee')).length,8);
    assert.equal(s.rows.find(r=>r.id==='live:'+seeded.ids[0]).building,'A座');
    assert.equal(s.rows.find(r=>r.id==='history:'+seeded.ids[7]).buildingId,BUILDINGS[1]);
    assert.equal(s.rows.find(r=>r.id==='history:'+seeded.ids[5]).match,'project');
    assert.equal(s.rows.find(r=>r.id==='history:'+seeded.ids[6]).match,'unmapped');
    assert.equal(s.rows.find(r=>r.id==='live:'+seeded.ids[0]).financials.faceRent,undefined);
    for (const secret of ['合成保密客户','company','submitter','agency','remarks','raw_record']) assert.equal(JSON.stringify(s).includes(secret),false);
    assert.equal(s.links.length,1);
  });
  await check('financial fields require their independent explicit grant; never grant tenant/broker fields',async()=>{
    await grantLeaseResearch(db.setup,OWNER,{financials:true});
    const s=await snapshot();
    assert.equal(s.rows.find(r=>r.id==='live:'+seeded.ids[0]).financials.effectiveRent,'210');
    assert.equal(s.rows.find(r=>r.id==='history:'+seeded.ids[4]).financials.effectiveRent,'150');
    assert.equal(s.rows.find(r=>r.id==='history:'+seeded.ids[4]).financials.managementFee,'30');
    assert.equal(JSON.stringify(s).includes('合成保密客户'),false);
  });
  await check('building grant intersection excludes ambiguous projects rather than expanding members',async()=>{
    await grantLeaseResearch(db.setup,OWNER,{allBuildings:false,buildingIds:[BUILDINGS[0]],allSubmarkets:false,submarkets:['CBD']});
    const s=await snapshot(); assert.ok(s.rows.length>=5); assert.ok(s.rows.every(r=>r.buildingId===BUILDINGS[0]&&r.match==='exact'));
    await grantQuery(db,OWNER,{allBuildings:false,buildingIds:[BUILDINGS[1]]});
    assert.equal((await snapshot()).rows.length,0);
    await grantQuery(db,OWNER); await grantLeaseResearch(db.setup,OWNER);
  });
  await check('live-only research grant cannot expose history rows',async()=>{
    await grantLeaseResearch(db.setup,OWNER,{sources:['live']}); assert.ok((await snapshot()).rows.every(r=>r.source==='live'));
    await grantLeaseResearch(db.setup,OWNER);
  });
  await check('admin own-session restriction, role change, expiration and revocation',async()=>{
    assert.equal((await snapshot(OTHER)).allowed,false);
    await db.setup.query("update public.user_roles set role='viewer' where user_id=$1",[OWNER]); assert.equal((await snapshot()).allowed,false);
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);
    await db.setup.query("update private.ai_lease_research_grants set valid_until=now()-interval '1 second' where user_id=$1",[OWNER]); assert.equal((await snapshot()).allowed,false);
    await grantLeaseResearch(db.setup,OWNER); const before=await snapshot();
    await db.setup.query('update private.ai_lease_research_grants set enabled=false where user_id=$1',[OWNER]); assert.equal((await snapshot()).allowed,false);
    await grantLeaseResearch(db.setup,OWNER); assert.notEqual((await snapshot()).permission_revision,before.permission_revision);
  });
  await check('authenticated/anon/service_role cannot maintain private grants or identity links',async()=>{
    for(const role of ['anon','authenticated','service_role']) {
      await db.setup.query('begin');
      try { await db.setup.query('set local role '+role); await assert.rejects(()=>db.setup.query('select * from private.ai_lease_research_grants')); }
      finally { await db.setup.query('rollback'); }
    }
    const fn=(await db.setup.query("select n.nspname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.proname='ai_lease_research_snapshot'")).rows;
    assert.equal(fn.length,2); for(const f of fn) {assert.equal(f.anon,false);assert.equal(f.authenticated,false);assert.equal(f.service,true);assert.equal(f.prosecdef,f.nspname==='private');assert.ok(f.proconfig.includes('search_path=""'));}
  });
  await check('grant/link maintenance audit preserves full version and evidence chain',async()=>{
    const events=(await db.setup.query("select * from private.ai_query_policy_events where relation_name like 'ai_lease_%'")).rows;
    assert.ok(events.length>8); assert.ok(events.some(e=>e.relation_name==='ai_lease_verified_duplicates'&&e.new_record.evidence_reference==='synthetic independently verified transaction identity'));
    assert.ok(events.every(e=>e.actor_kind==='unknown'&&e.executor==='postgres'));
  });
  await check('source edits invalidate verified duplicate fingerprints',async()=>{
    const old=await snapshot(); await db.setup.query('update public.lease_transactions_history set area_sqm=999 where id=$1',[seeded.ids[4]]);
    const next=await snapshot(); const row=next.rows.find(r=>r.id==='history:'+seeded.ids[4]);
    assert.notEqual(row.fingerprint,next.links[0].historyFingerprint); assert.notDeepEqual(next.rows,old.rows);
  });
  await check('20000-row limit explicitly rejects rather than paginating or truncating the authorized pool',async()=>{
    await db.setup.query(`insert into public.lease_transactions_history(id,source_uid,new_building,sub_market,transaction_year,transaction_quarter,area_sqm)
      select gen_random_uuid(),'synthetic-limit-'||i,'合成历史楼名','CBD',2026,'Q1',1 from generate_series(1,20001) i`);
    const s=await snapshot();assert.equal(s.allowed,true);assert.equal(s.over_limit,true);assert.equal(s.rows,undefined);
  });
} finally { await db.close(); }
