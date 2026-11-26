import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLeaseTestDatabase,OWNER,ADMIN,recordId} from '../lease-change-history/database.mjs';
const migration=await readFile(new URL('../../migrations/20261102063824_audit_actor_identity.sql',import.meta.url),'utf8');
const db=await createLeaseTestDatabase();let passed=0;
const check=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
const insert=async(user,extra={})=>(await db.setup.query(`insert into public.audit_logs(user_id,action_type,details) values($1,'SALES_MATERIAL_IMPORT',$2) returning *`,[user,extra])).rows[0];
try {
 await db.setup.query('alter table public.user_roles add column email text,add column full_name text');
 await db.setup.query("update public.user_roles set email='owner@example.test' where user_id=$1",[OWNER]);
 const legacy=await insert('codex',{batch:'synthetic-only'});
 const baseline=await insert(OWNER);
 await check('old implementation loses actor name on actual insert',async()=>{
   assert.throws(()=>assert.equal(baseline.actor_name,'Synthetic owner'),assert.AssertionError);
 });
 const before=(await db.setup.query('select jsonb_agg(to_jsonb(a)-\'actor_kind\'-\'actor_name\' order by id) data from public.audit_logs a')).rows[0].data;
 await db.setup.query(migration);
 await check('legacy raw identities, times, actions and evidence preserved',async()=>{
  assert.deepEqual((await db.setup.query('select jsonb_agg(to_jsonb(a)-\'actor_kind\'-\'actor_name\' order by id) data from public.audit_logs a')).rows[0].data,before);
  const row=(await db.setup.query('select * from public.audit_logs where id=$1',[legacy.id])).rows[0];
  assert.equal(row.actor_name,'Codex（工具执行）');assert.equal(row.actor_kind,'tool');assert.equal(row.user_id,'codex');
 });
 await check('new account and legacy email inserts resolve from protected directory',async()=>{
  assert.equal((await insert(OWNER)).actor_name,'Synthetic owner');
  assert.equal((await insert('OWNER@example.test')).actor_kind,'user');
 });
 await check('client-supplied actor fields cannot spoof identity snapshots',async()=>{
  const row=(await db.setup.query("insert into public.audit_logs(user_id,action_type,actor_kind,actor_name) values($1,'EXPORT_DATA','system','spoof') returning *",[OWNER])).rows[0];
  assert.equal(row.actor_name,'Synthetic owner');assert.equal(row.actor_kind,'user');
 });
 await check('unregistered actors remain recorded as explicit unknown, never system',async()=>{
  for(const value of ['unregistered-tool','unknown','']) {
   const row=await insert(value);assert.equal(row.actor_kind,'unknown');assert.equal(row.actor_name,null);
  }
  assert.equal((await insert('system')).actor_kind,'system');
 });
 // The fixture has the original identity migration; actor_role is the additive
 // column from 20261121105118. Apply the real external identity migration.
 await db.setup.query('alter table public.audit_logs add column actor_role text');
 const externalMigration=await readFile(new URL('../../migrations/20261126121500_audit_external_tool_identity.sql',import.meta.url),'utf8');
 const maintenanceInsert=async(user,source,action,module,table,details,when='2026-11-27 00:00:00+00')=>(await db.setup.query(
  `insert into public.audit_logs(user_id,request_source,action_type,module,target_table,details,created_at,old_values,new_values)
   values($1,$2,$3,$4,$5,$6,$7,'{"submarket":null}'::jsonb,'{"submarket":"CBD"}'::jsonb) returning *`,
  [user,source,action,module,table,details,when])).rows[0];
 const historical=[
  ['chatgpt','chatgpt_mcp','AI_FIELD_FILL','building_data_ai_enrichment','building_brochure_data',{batch_id:'ai_brochure_submarket_20261124_100_v1',field_name:'submarket'},'2026-11-24 14:49:06+00','ChatGPT（工具执行）'],
  ['chatgpt','chatgpt_mcp','AI_FIELD_FILL','building_data_ai_enrichment','building_brochure_data',{batch_id:'ai_technical_fields_20261124_v2'},'2026-11-24 15:08:14+00','ChatGPT（工具执行）'],
  ['chatgpt','server','BUILDING_PHOTO_STORAGE_BACKFILL_RECEIPT','map','building_photos',{batch_id:'20261106-chatgpt-external-links-b8'},'2026-11-06 07:45:00+00','ChatGPT（工具执行）'],
  ['tool:chatgpt_submarket_research','frontend','ADMIN_DATA_OPERATION','map','map_submarket_profiles',{operation:'ai_source_asof_correction'},'2026-11-19 06:25:00+00','ChatGPT（子市场研究）'],
  ['assistant:authorized-auto-publication','frontend','ADMIN_DATA_OPERATION','map','map_submarket_profiles',{operation:'auto_publish_submarket_client_brief'},'2026-11-20 04:55:00+00','AI 助手（资料发布）'],
 ];
 const historicRows=[];
 for(const entry of historical)historicRows.push(await maintenanceInsert(...entry.slice(0,7)));
 const wrongBatch=await maintenanceInsert('chatgpt','chatgpt_mcp','AI_FIELD_FILL','building_data_ai_enrichment','building_brochure_data',{batch_id:'unverified'},'2026-11-24 14:49:06+00');
 const wrongOperation=await maintenanceInsert('tool:chatgpt_submarket_research','frontend','ADMIN_DATA_OPERATION','map','map_submarket_profiles',{operation:'unverified'},'2026-11-19 06:25:00+00');
 const wrongDate=await maintenanceInsert(...historical[4].slice(0,6));
 const originalEvidence=async()=>(await db.setup.query("select jsonb_agg(to_jsonb(a)-'actor_kind'-'actor_name' order by id) data from public.audit_logs a")).rows[0].data;
 const readRow=async id=>(await db.setup.query('select * from public.audit_logs where id=$1',[id])).rows[0];
 const beforeExternal=await originalEvidence();
 await check('scoped historical external actor repair preserves every original field and is idempotent',async()=>{
  await db.setup.query(externalMigration);
  assert.deepEqual(await originalEvidence(),beforeExternal);
  for(let i=0;i<historicRows.length;i++){
   const row=await readRow(historicRows[i].id);
   assert.equal(row.actor_kind,'tool');assert.equal(row.actor_name,historical[i][7]);assert.equal(row.actor_role,null);
  }
  for(const original of [wrongBatch,wrongOperation,wrongDate])assert.equal((await readRow(original.id)).actor_kind,'unknown');
  const classified=(await db.setup.query('select jsonb_agg(to_jsonb(a) order by id) data from public.audit_logs a')).rows[0].data;
  await db.setup.query(externalMigration);
  assert.deepEqual((await db.setup.query('select jsonb_agg(to_jsonb(a) order by id) data from public.audit_logs a')).rows[0].data,classified);
 });
 await check('new external writes use exact registered identifiers and trusted source, never caller-provided snapshots',async()=>{
  for(const [id,label] of [['chatgpt','ChatGPT（工具执行）'],['tool:chatgpt_submarket_research','ChatGPT（子市场研究）'],['assistant:authorized-auto-publication','AI 助手（资料发布）']]){
   for(const source of ['chatgpt_mcp','server']){
    const row=await maintenanceInsert(id,source,'AI_FIELD_FILL','building_data_ai_enrichment','building_brochure_data',{batch_id:'future'});
    assert.equal(row.actor_kind,'tool');assert.equal(row.actor_name,label);assert.equal(row.actor_role,null);
   }
   const frontend=await maintenanceInsert(id,'frontend','AI_FIELD_FILL','building_data_ai_enrichment','building_brochure_data',{});
   assert.equal(frontend.actor_kind,'unknown');assert.equal(frontend.actor_name,null);
  }
  for(const id of ['tool:unregistered','chatgpt-fake','CHATGPT']){
   const row=await maintenanceInsert(id,'chatgpt_mcp','AI_FIELD_FILL','building_data_ai_enrichment','building_brochure_data',{});
   assert.equal(row.actor_kind,'unknown');assert.equal(row.actor_name,null);
  }
  const spoof=(await db.setup.query("insert into public.audit_logs(user_id,action_type,request_source,actor_kind,actor_name,actor_role) values('unknown','AI_FIELD_FILL','chatgpt_mcp','tool','forged','admin') returning *")).rows[0];
  assert.equal(spoof.actor_kind,'unknown');assert.equal(spoof.actor_name,null);assert.equal(spoof.actor_role,null);
  assert.equal((await insert(OWNER)).actor_kind,'user');
  assert.equal((await insert('codex')).actor_kind,'tool');
  assert.equal((await insert('system')).actor_kind,'system');
 });
 await check('authenticated sessions cannot forge external actor identity or write the audit table directly',async()=>{
  await assert.rejects(db.asUser(OWNER,"insert into public.audit_logs(user_id,action_type,request_source) values('chatgpt','AI_FIELD_FILL','chatgpt_mcp')"),e=>e.code==='42501');
  await db.setup.query('begin');
  try {
   await db.setup.query("select set_config('request.jwt.claim.sub',$1,true)",[OWNER]);
   const row=await maintenanceInsert('chatgpt','chatgpt_mcp','AI_FIELD_FILL','building_data_ai_enrichment','building_brochure_data',{});
   assert.equal(row.actor_kind,'unknown');
  } finally {await db.setup.query('rollback');}
 });
 await db.repair();
 await check('real editor lease update writes actor and before/after snapshots through both triggers',async()=>{
  await db.asUser(OWNER,'update public.lease_transactions set face_rent=230 where id=$1',[recordId()]);
  const row=(await db.setup.query("select * from public.audit_logs where action_type='LEASE_TRANSACTION_UPDATE' order by id desc limit 1")).rows[0];
  assert.equal(row.actor_name,'Synthetic owner');assert.equal(row.actor_kind,'user');assert.equal(row.user_id,OWNER);
  assert.equal(row.old_values.face_rent,220);assert.equal(row.new_values.face_rent,230);assert.equal(row.details.change_count,1);
  const count=(await db.setup.query('select count(*)::int n from public.audit_logs')).rows[0].n;
  await db.asUser(OWNER,'update public.lease_transactions set face_rent=face_rent where id=$1',[recordId()]);
  assert.equal((await db.setup.query('select count(*)::int n from public.audit_logs')).rows[0].n,count);
 });
 await check('snapshot survives directory rename/removal and retains restricted read access',async()=>{
  const row=await insert(OWNER);await db.setup.query('delete from public.user_roles where user_id=$1',[OWNER]);
  assert.equal((await db.setup.query('select actor_name from public.audit_logs where id=$1',[row.id])).rows[0].actor_name,'Synthetic owner');
  assert.equal((await db.asUser(OWNER,'select * from public.audit_logs')).rowCount,0);
  assert.ok((await db.asUser(ADMIN,'select * from public.audit_logs')).rowCount>0);
  await assert.rejects(db.asUser(ADMIN,'select private.snapshot_audit_actor()'),e=>e.code==='42501');
 });
 console.log(`PASS ${passed} audit identity PostgreSQL 17 scenarios`);
} finally { await db.close(); }
