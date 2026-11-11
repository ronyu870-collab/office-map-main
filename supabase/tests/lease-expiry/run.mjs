// Synthetic, disposable localhost PostgreSQL 17 only. Never consumes ambient database URLs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
assert.ok(process.env.GITHUB_ACTIONS === 'true' || process.env.LEASE_TEST_ALLOW_LOCAL === 'disposable');
const port = Number(process.env.LEASE_TEST_PG_PORT);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
const config = { host: '127.0.0.1', port, user: 'postgres', password: 'synthetic_ci_only', connectionTimeoutMillis: 5000 };
const admin = new pg.Client({ ...config, database: 'postgres' });
await admin.connect();
const db = `f6_synthetic_${randomUUID().replaceAll('-', '')}`;
const actor = randomUUID(), other = randomUUID(), viewer = randomUUID();
// Put the target after pagination fixtures so a broad first-page lookup cannot pass by chance.
const source = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
let client, concurrent;
const load = name => readFile(new URL(name, import.meta.url), 'utf8');
let checks = 0;
const pass = label => { checks++; console.log(`PASS ${label}`); };
try {
  const version = Number((await admin.query("select current_setting('server_version_num') n")).rows[0].n);
  assert.ok(version >= 170000 && version < 180000);
  for (const role of ['anon', 'authenticated', 'service_role']) if (!(await admin.query('select 1 from pg_roles where rolname=$1', [role])).rowCount) await admin.query(`create role ${role}`);
  await admin.query(`create database ${db}`);
  client = new pg.Client({ ...config, database: db }); await client.connect();
  concurrent = new pg.Client({ ...config, database: db }); await concurrent.connect();
  await client.query("set statement_timeout='10s'"); await concurrent.query("set statement_timeout='10s'");
  await client.query(await load('./fixture.sql'));
  // Use the real unified read view, not a mock of its date / identity logic.
  await client.query(await load('../../migrations/20260915061154_append_project_association_fields_to_lease_read_v1.sql'));
  await client.query(await load('../../migrations/20261102063824_audit_actor_identity.sql'));
  await client.query(await load('../../migrations/20261111034942_lease_expiry_review_workspace.sql'));
  await client.query('insert into auth.users(id) values($1),($2),($3)', [actor, other, viewer]);
  await client.query("insert into public.user_roles(user_id,role) values($1,'admin'),($2,'admin'),($3,'viewer')", [actor,other,viewer]);
  await client.query(`insert into public.lease_transactions_history(id,source_uid,company,new_building,transaction_year,transaction_quarter,lease_term_months,source_lease_term_raw,source_file,source_sheet,source_row,period_source)
    values($1,'synthetic-source','合成企业','合成楼宇',2021,'Q4',60,'60','synthetic.xlsx','Sheet1',2,'info_date_inferred_same_year')`, [source]);
  const original = (await client.query('select to_jsonb(h) data from public.lease_transactions_history h where id=$1',[source])).rows[0].data;
  const list = async (who=actor, opts={}, conn=client) => (await conn.query('select public.lease_expiry_review_list($1,$2,$3,$4,$5) data',[who, opts.date??'2026-11-11',opts.page??1,opts.query??'',opts.scope??'window'])).rows[0].data;
  const first = await list(); assert.equal(first.total,1); assert.equal(first.items[0].proxy_start,'2026-10-01'); assert.equal(first.items[0].proxy_end,'2026-12-31');
  assert.equal(first.items[0].source.period_source,'info_date_inferred_same_year'); pass('quarter + term is a candidate interval, retaining inferred date evidence');
  const base = { actor,source,revision:0, fingerprint:first.items[0].source_fingerprint, request:randomUUID(),status:'missing_info',notes:'合成：起租日和单位未确认',evidence:'合成原件第 2 行' };
  const save = async (input={}, conn=client) => {
    const p={...base,...input}; return (await conn.query('select public.lease_expiry_review_save($1,$2,$3,$4,$5,$6,$7,$8) data',[p.actor,p.source,p.revision,p.fingerprint,p.request,p.status,p.notes,p.evidence])).rows[0].data;
  };
  for (const role of ['anon','authenticated']) {
    await client.query(`set role ${role}`);
    await assert.rejects(list(),e=>e.code==='42501'); await assert.rejects(save(),e=>e.code==='42501');
    await assert.rejects(client.query('select * from public.lease_expiry_reviews'),e=>e.code==='42501');
    await client.query('reset role');
  }
  await client.query("update public.user_roles set role='editor' where user_id=$1",[viewer]);
  await assert.rejects(list(viewer),e=>e.code==='42501'); await assert.rejects(save({actor:viewer}),e=>e.code==='42501');
  await client.query("update public.user_roles set role='viewer' where user_id=$1",[viewer]);
  await assert.rejects(list(viewer),e=>e.code==='42501'); await assert.rejects(save({actor:viewer}),e=>e.code==='42501'); pass('anonymous, broker/viewer and direct table access denied');
  await client.query('set role service_role');
  const saved = await save(); assert.equal(saved.revision,1);
  assert.deepEqual(await save(), saved);
  await assert.rejects(save({notes:'different'}),e=>e.message==='F6_REQUEST_CONFLICT');
  await client.query('reset role');
  assert.equal((await client.query('select count(*)::int n from public.lease_expiry_review_events')).rows[0].n,1);
  assert.deepEqual((await client.query('select to_jsonb(h) data from public.lease_transactions_history h where id=$1',[source])).rows[0].data,original);
  pass('service-only atomic save, content-bound retry, one audit event, unchanged original');
  const audit=(await client.query('select * from public.audit_logs')).rows; assert.equal(audit.length,1);assert.equal(audit[0].actor_kind,'user');assert.equal(audit[0].user_id,actor);
  await client.query(await load('../../migrations/20261111055947_lease_expiry_live_sources.sql'));
  assert.deepEqual(await save(),{...saved,source_kind:'history'});
  assert.equal((await list()).items[0].source_fingerprint,first.items[0].source_fingerprint);
  assert.equal((await client.query('select count(*)::int n from public.lease_expiry_review_events')).rows[0].n,1);
  pass('in-place upgrade preserves historical notes, fingerprints and pre-upgrade idempotent retries');
  await assert.rejects(save({request:randomUUID()}),e=>e.message==='F6_REVISION_CONFLICT');
  const two = await Promise.allSettled([save({actor,revision:1,request:randomUUID()}),save({actor:other,revision:1,request:randomUUID()},concurrent)]);
  assert.equal(two.filter(r=>r.status==='fulfilled').length,1); assert.equal(two.filter(r=>r.status==='rejected' && r.reason.message==='F6_REVISION_CONFLICT').length,1);
  pass('two administrators cannot overwrite the same revision');
  const duplicate = {...base,revision:2,request:randomUUID()};
  const both = await Promise.all([save(duplicate),save(duplicate,concurrent)]); assert.deepEqual(both[0],both[1]); assert.equal(both[0].revision,3);
  pass('simultaneous identical requests save once');
  await client.query("update public.lease_transactions_history set source_lease_term_raw='原件不同' where id=$1",[source]);
  await assert.rejects(save({revision:3,request:randomUUID()}),e=>e.message==='F6_SOURCE_CHANGED');
  await client.query("update public.lease_transactions_history set source_lease_term_raw='60' where id=$1",[source]);
  pass('changed source evidence requires reload');
  await client.query("update public.user_roles set role='viewer' where user_id=$1",[actor]);
  await assert.rejects(list(),e=>e.code==='42501'); await assert.rejects(save(),e=>e.code==='42501');
  await client.query("update public.user_roles set role='admin' where user_id=$1",[actor]);
  await client.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[actor]);
  await assert.rejects(list(),e=>e.code==='42501'); await assert.rejects(save(),e=>e.code==='42501');
  await client.query('update auth.users set banned_until=null,deleted_at=now() where id=$1',[actor]);
  await assert.rejects(list(),e=>e.code==='42501');
  await client.query('update auth.users set deleted_at=null where id=$1',[actor]); pass('revocation, banned and deleted accounts rejected, including idempotent replay');
  await client.query(`create function private.synthetic_fail_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit outage'; end$$;
    create trigger synthetic_audit_failure before insert on public.lease_expiry_review_events for each row execute function private.synthetic_fail_audit()`);
  await assert.rejects(save({revision:3,request:randomUUID()}),/synthetic audit outage/);
  assert.equal((await client.query('select revision from public.lease_expiry_reviews where source_id=$1',[source])).rows[0].revision,3);
  await client.query('drop trigger synthetic_audit_failure on public.lease_expiry_review_events');
  await client.query('create trigger synthetic_audit_failure before insert on public.audit_logs for each row execute function private.synthetic_fail_audit()');
  const eventsBefore=(await client.query('select count(*)::int n from public.lease_expiry_review_events')).rows[0].n;
  await assert.rejects(save({revision:3,request:randomUUID()}),/synthetic audit outage/);
  assert.equal((await client.query('select revision from public.lease_expiry_reviews where source_id=$1',[source])).rows[0].revision,3);
  assert.equal((await client.query('select count(*)::int n from public.lease_expiry_review_events')).rows[0].n,eventsBefore);
  await client.query('drop trigger synthetic_audit_failure on public.audit_logs'); pass('either evidence audit or shared audit failure rolls back the entire draft');
  await assert.rejects(save({status:'verified',request:randomUUID()}),e=>e.code==='22023');
  await assert.rejects(save({notes:'',request:randomUUID()}),e=>e.code==='22023'); pass('cannot confirm expiry; missing-information state needs an explanation');
  assert.equal((await list(actor,{date:'2030-01-01'})).total,0);
  assert.equal((await list(actor,{date:'2030-01-01',scope:'saved'})).total,1); pass('saved evidence stays reachable outside rolling window');
  await client.query(`insert into public.lease_transactions_history(id,source_uid,company,new_building,transaction_year,transaction_quarter,lease_term_months)
    select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-'||n,'分页合成企业','楼宇',2021,'Q4',60 from generate_series(1,26)n`);
  await client.query(`insert into public.lease_transactions_history(id,source_uid,company,new_building,transaction_year,transaction_quarter,lease_term_months)
    select gen_random_uuid(),'invalid-'||n,'排除合成企业','楼宇',2021,'Q4',n from unnest(array[0,121,1.5,null]::numeric[])n`);
  const page1=await list(),page2=await list(actor,{page:2}); assert.equal(page1.total,27);assert.equal(page1.items.length,25);assert.equal(page2.items.length,2);
  assert.equal(new Set([...page1.items,...page2.items].map(i=>i.source.id)).size,27);
  assert.ok(page2.items.some(i=>i.source.id===source), 'target fixture must be outside the first page');
  assert.equal((await list(actor,{query:'%'})).total,0); pass('stable paginated search, literal search and invalid term exclusions');
  await client.query(`insert into public.lease_transactions(id,company,new_building,transaction_year,transaction_quarter) values(gen_random_uuid(),'合成企业','合成楼宇',2026,'Q1')`);
  // The company substring also matches 26 pagination fixtures. Isolate this clue check by its unique building.
  const nameClue = await list(actor,{query:'合成楼宇'});
  assert.equal(nameClue.total,1);
  assert.equal(nameClue.items.find(i=>i.source.id===source)?.has_later_name_match,true);
  pass('later live deal is a name-match clue, not an expiry/ownership decision');
  // Check read boundaries: start at window end is excluded, end at as-of is included.
  assert.equal((await list(actor,{date:'2026-04-01',query:'分页合成'})).total,0);
  assert.equal((await list(actor,{date:'2026-12-31',query:'分页合成'})).total,26);
  pass('half-open observation window and interval overlap boundary');
  const fresh=randomUUID();
  await client.query(`insert into public.lease_transactions_history(id,source_uid,company,new_building,transaction_year,transaction_quarter,lease_term_months)
    values($1,'first-save-race','首次并发合成','楼宇',2021,'Q4',60)`,[fresh]);
  const freshItem=(await list(actor,{query:'首次并发合成'})).items[0];
  const firstRace=await Promise.allSettled([
    save({source:fresh,fingerprint:freshItem.source_fingerprint,request:randomUUID()}),
    save({actor:other,source:fresh,fingerprint:freshItem.source_fingerprint,request:randomUUID()},concurrent),
  ]);
  assert.equal(firstRace.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(firstRace.filter(r=>r.status==='rejected'&&r.reason.message==='F6_REVISION_CONFLICT').length,1);
  pass('concurrent first saves are serialized before any draft exists');
  await client.query('begin');
  await client.query("update public.user_roles set role='viewer' where user_id=$1",[actor]);
  const afterRevocation=save({revision:3,request:randomUUID()},concurrent);
  const denied=assert.rejects(afterRevocation,e=>e.code==='42501');
  await client.query('commit');await denied;
  await client.query("update public.user_roles set role='admin' where user_id=$1",[actor]);
  pass('save waits for an in-flight role withdrawal and then rejects');

  await client.query(`insert into public.lease_transactions(id,company,new_building,transaction_year,transaction_quarter,lease_term_months)
    values($1,'日常接入合成','合成楼宇',2021,'Q4',60)`,[source]);
  const liveItem=(await list(actor,{query:'日常接入合成'})).items[0];
  assert.equal(liveItem.source_kind,'live'); assert.equal(liveItem.source_available,true);assert.equal(liveItem.proxy_start,'2026-10-01');assert.equal(liveItem.review,null);
  const saveLive=async(input={},conn=client)=>{const p={...base,source,kind:'live',revision:0,fingerprint:liveItem.source_fingerprint,request:randomUUID(),...input};return (await conn.query('select public.lease_expiry_review_save($1,$2,$3,$4,$5,$6,$7,$8,$9) data',[p.actor,p.source,p.revision,p.fingerprint,p.request,p.status,p.notes,p.evidence,p.kind])).rows[0].data;};
  await assert.rejects(saveLive({request:base.request}),e=>e.message==='F6_REQUEST_CONFLICT');
  const liveRace=await Promise.allSettled([saveLive(),saveLive({actor:other},concurrent)]);
  assert.equal(liveRace.filter(r=>r.status==='fulfilled').length,1);assert.equal(liveRace.filter(r=>r.status==='rejected'&&r.reason.message==='F6_REVISION_CONFLICT').length,1);
  assert.equal((await client.query("select revision from public.lease_expiry_reviews where source_kind='history' and source_id=$1",[source])).rows[0].revision,3);
  assert.equal((await client.query("select revision from public.lease_expiry_reviews where source_kind='live' and source_id=$1",[source])).rows[0].revision,1);
  pass('daily deals enter automatically; identical UUIDs and first-save races stay isolated by source');
  for(const role of ['anon','authenticated']){await client.query(`set role ${role}`);await assert.rejects(saveLive(),e=>e.code==='42501');await assert.rejects(client.query('select private.lease_expiry_source_v2($1,$2)',['live',source]),e=>e.code==='42501');await client.query('reset role');}
  await assert.rejects(saveLive({actor:viewer}),e=>e.code==='42501');
  await assert.rejects(saveLive({kind:'fake'}),e=>e.code==='22023');
  const publicFns=(await client.query("select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('lease_expiry_review_list','lease_expiry_review_save')")).rows;
  assert.ok(publicFns.every(r=>r.prosecdef===false));pass('live-source access remains admin/service-only, public entrypoints are invokers');
  await client.query('update public.lease_transactions set lease_term_months=61 where id=$1',[source]);
  const moved=(await list(actor,{query:'日常接入合成'})).items[0];assert.equal(moved.proxy_start,'2026-11-01');
  await assert.rejects(saveLive({revision:1}),e=>e.message==='F6_SOURCE_CHANGED');
  const liveRetry={revision:1,fingerprint:moved.source_fingerprint,request:randomUUID()};
  const replay=await Promise.all([saveLive(liveRetry),saveLive(liveRetry,concurrent)]);assert.deepEqual(replay[0],replay[1]);assert.equal(replay[0].revision,2);
  await client.query('update public.lease_transactions set lease_term_months=null where id=$1',[source]);assert.equal((await list(actor,{query:'日常接入合成'})).total,0);
  const withoutTerm=(await list(actor,{query:'日常接入合成',scope:'saved'})).items[0];assert.equal(withoutTerm.proxy_start,null);assert.equal(withoutTerm.source_available,true);
  pass('edited daily term recalculates immediately; stale evidence rejected, retry once, missing terms stay unknown');
  await client.query('delete from public.lease_transactions where id=$1',[source]);
  assert.equal((await list(actor,{query:'日常接入合成'})).total,0);
  const archived=(await list(actor,{query:'日常接入合成',scope:'saved'})).items[0];assert.equal(archived.source_available,false);assert.equal(archived.review.revision,2);assert.equal(archived.proxy_start,null);
  await assert.rejects(saveLive({revision:2,request:randomUUID()}),e=>e.code==='P0002');
  assert.equal((await client.query("select count(*)::int n from public.lease_expiry_review_events where source_kind='live' and source_id=$1",[source])).rows[0].n,2);
  assert.equal((await client.query("select count(*)::int n from public.audit_logs where target_id=$1",['live:'+source])).rows[0].n,2);
  pass('daily deletion remains possible, removes opportunity and preserves read-only notes and both audits');
  console.log(`F6 PostgreSQL ${version}: ${checks} scenarios passed; synthetic database removed on exit.`);
} finally {
  await concurrent?.end(); await client?.end();
  await admin.query(`drop database if exists ${db} with (force)`); await admin.end();
}
