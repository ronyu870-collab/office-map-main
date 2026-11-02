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
