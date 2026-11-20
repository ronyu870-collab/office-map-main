// Real PostgreSQL 17, disposable localhost only. No production credentials or rows.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { createAiQueryTestDatabase, grantQuery, SESSION } from './database.mjs';
import { addSnapshotFixture, BUILDINGS } from './snapshot-fixture.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
import { OWNER, ADMIN } from '../lease-change-history/database.mjs';

const db = await createAiQueryTestDatabase(), results = [];
const check = async (scenario, fn) => { await fn(); results.push({ scenario, status: 'passed' }); console.log('PASS ' + scenario); };
const migration = file => readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8');
async function service(sql, values = []) {
  await db.setup.query('begin');
  try {
    await db.setup.query('set local role service_role');
    const result = await db.setup.query(sql, values);
    await db.setup.query('commit');
    return result;
  } catch (error) { await db.setup.query('rollback'); throw error; }
}
const authority = async (actor = OWNER, session = SESSION) => (await service('select public.ai_query_authority($1,$1,$2) r', [actor, session])).rows[0].r;
async function periods(options = {}) {
  const a = await authority();
  const values = [options.actor ?? OWNER, options.effective ?? options.actor ?? OWNER, options.session ?? SESSION,
    options.revision ?? a.permission_revision ?? 'a'.repeat(64), options.fields ?? ['totalArea', 'netEffectiveRent'],
    options.inventory ?? 'tracked', Object.hasOwn(options, 'submarkets') ? options.submarkets : ['CBD'], options.buildingIds ?? null];
  return (await service('select public.ai_query_available_periods($1,$2,$3,$4,$5,$6,$7,$8) r', values)).rows[0].r;
}
async function metric({ building = BUILDINGS[0], year = 2026, quarter = 4, area = 100, rent = 80, vacant = 0, draft = false } = {}) {
  await db.setup.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft,is_locked)
    values($1,$2,$3,$4,$5,$6,$7,true) on conflict(building_id,record_year,record_quarter)
    do update set total_area=excluded.total_area,net_effective_rent=excluded.net_effective_rent,vacant_area=excluded.vacant_area,is_draft=excluded.is_draft,is_locked=excluded.is_locked`,
  [building, year, quarter, area, rent, vacant, draft]);
}
const keys = result => result.periods.map(period => `${period.year}Q${period.quarter}`);
const denied = error => error.code === '42501';
const invalid = error => error.code === '22023';
const cipher = (size = 1) => ({ version: 1, algorithm: 'aes-256-gcm', keyId: 'p1-synthetic', nonce: randomBytes(12).toString('hex'), tag: randomBytes(16).toString('hex'), ciphertext: 'ab'.repeat(size) });
async function auditRequest(actor = OWNER, state = 'running', size = 1) {
  const id = randomUUID();
  await service('select public.ai_query_audit_receive($1,$2,$3,$3,$4,$5,$6)', [id, randomUUID(), actor, 'p1-synthetic', 'a'.repeat(64), cipher(size)]);
  if (state !== 'received') await service('select public.ai_query_audit_append($1,$2,$3,$4,$5)', [id, randomUUID(), state, 'b'.repeat(64), cipher(size)]);
  return id;
}
async function append(id, kind, size = 1) {
  await service('select public.ai_query_audit_append($1,$2,$3,$4,$5)', [id, randomUUID(), kind, 'c'.repeat(64), cipher(size)]);
}
const context = async (request, actor = OWNER, session = SESSION) => (await service('select public.ai_query_context_read($1,$1,$2,$3) r', [actor, session, request])).rows[0].r;
const budget = async (request, actor = OWNER, session = SESSION) => (await service('select public.ai_query_model_budget($1,$1,$2,$3) r', [actor, session, request])).rows[0].r;

try {
  await loadAuditPrerequisites(db);
  await applyAdminOnly(db);
  await addSnapshotFixture(db);
  await db.setup.query(await migration('20261113042352_ai_query_result_recovery.sql'));
  await db.setup.query(await migration('20261115103701_ai_query_available_periods.sql'));
  await db.setup.query(await migration('20261120095500_ai5_quarterly_sources.sql'));
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
  await db.setup.query('update private.ai_query_control set enabled=true');
  await grantQuery(db, OWNER);

  await check('最新期只取真实获权有效季度，未使用当前自然季度', async () => {
    const result = await periods();
    assert.equal(result.version, 'authorized-periods/1');
    assert.deepEqual(keys(result), ['2026Q2', '2026Q3']);
    assert.equal(result.inventory_time, 'current_catalog');
    assert.equal(result.permission_revision, (await authority()).permission_revision);
    assert.equal(result.truncated, false);
  });
  await check('草稿、空值、零租金、负值、NaN和Infinity不会成为最新有效租金季度', async () => {
    await metric({ draft: true });
    assert.deepEqual(keys(await periods()), ['2026Q2', '2026Q3']);
    for (const rent of [null, 0, -1, 'NaN', 'Infinity', '-Infinity']) {
      await metric({ rent });
      assert.deepEqual(keys(await periods()), ['2026Q2', '2026Q3']);
    }
    for (const area of [null, 0, -1, 'NaN', 'Infinity']) {
      await metric({ area });
      assert.deepEqual(keys(await periods()), ['2026Q2', '2026Q3']);
    }
    await metric();
    assert.deepEqual(keys(await periods()), ['2026Q2', '2026Q3', '2026Q4']);
  });
  await check('零空置面积有效，负值/超总面积/缺失/非有限值不构成有效空置率季度', async () => {
    const fields = ['totalArea', 'vacantArea'];
    await metric({ vacant: 0 });
    assert.equal(keys(await periods({ fields })).at(-1), '2026Q4');
    for (const vacant of [null, -1, 101, 'NaN', 'Infinity']) {
      await metric({ vacant });
      assert.equal(keys(await periods({ fields })).at(-1), '2026Q3');
      assert.equal(keys(await periods()).at(-1), '2026Q4');
    }
    await metric();
  });
  await check('当前跟踪范围与扩展目录分开，合并楼宇不能泄露期别', async () => {
    await db.setup.query('update public.buildings set is_active=false where id=$1', [BUILDINGS[0]]);
    assert.equal(keys(await periods()).at(-1), '2026Q3');
    assert.equal(keys(await periods({ inventory: 'all_authorized' })).at(-1), '2026Q4');
    await db.setup.query("update public.buildings set is_active=true,tracking_scope='untracked' where id=$1", [BUILDINGS[0]]);
    assert.equal(keys(await periods()).at(-1), '2026Q3');
    await db.setup.query("update public.buildings set tracking_scope='tracked',merged_into_id=$2 where id=$1", [BUILDINGS[0], BUILDINGS[1]]);
    assert.equal(keys(await periods({ inventory: 'all_authorized' })).at(-1), '2026Q3');
    await db.setup.query('update public.buildings set merged_into_id=null where id=$1', [BUILDINGS[0]]);
  });
  await check('不存在的地区/楼宇返回空期别，显式空范围不扩为全集', async () => {
    assert.deepEqual(keys(await periods({ submarkets: ['不存在的合成地区'] })), []);
    assert.deepEqual(keys(await periods({ buildingIds: [randomUUID()] })), []);
    assert.deepEqual(keys(await periods({ submarkets: [] })), []);
    assert.deepEqual(keys(await periods({ buildingIds: [] })), []);
  });
  await check('地区与楼宇授权同时生效，范围外更新不能改变最新期且显式越权被拒绝', async () => {
    await db.setup.query("update public.buildings set submarket='金融街' where id=$1", [BUILDINGS[1]]);
    await metric({ building: BUILDINGS[1], year: 2027, quarter: 1 });
    await grantQuery(db, OWNER, { allSubmarkets: false, submarkets: ['CBD'] });
    assert.equal(keys(await periods({ submarkets: null })).at(-1), '2026Q4');
    await assert.rejects(periods({ submarkets: ['金融街'] }), denied);
    await grantQuery(db, OWNER, { allBuildings: false, buildingIds: [BUILDINGS[0]] });
    assert.equal(keys(await periods({ submarkets: null })).at(-1), '2026Q4');
    await assert.rejects(periods({ submarkets: null, buildingIds: [BUILDINGS[1]] }), denied);
    await grantQuery(db, OWNER);
    assert.equal(keys(await periods({ submarkets: null })).at(-1), '2027Q1');
  });
  await check('字段白名单、季度资格和scope复杂度不会被metadata接口绕过', async () => {
    await grantQuery(db, OWNER, { fields: ['totalArea'] });
    await assert.rejects(periods(), denied);
    assert.ok((await periods({ fields: ['totalArea'] })).periods.length > 0);
    await grantQuery(db, OWNER, { capabilities: ['query:catalog'] });
    await assert.rejects(periods(), denied);
    await grantQuery(db, OWNER);
    for (const fields of [[], ['height'], ['sql'], ['totalArea', null], ['totalArea', 'totalArea', 'totalArea', 'totalArea']]) await assert.rejects(periods({ fields }), invalid);
    await assert.rejects(periods({ submarkets: Array.from({ length: 31 }, () => 'CBD') }), invalid);
    await assert.rejects(periods({ buildingIds: Array.from({ length: 501 }, () => BUILDINGS[0]) }), invalid);
    await assert.rejects(periods({ inventory: 'all_database' }), invalid);
  });
  await check('权限版本、撤权、普通角色和模拟身份在下一次请求立即拒绝', async () => {
    const revision = (await authority()).permission_revision;
    await grantQuery(db, OWNER);
    await assert.rejects(periods({ revision }), denied);
    for (const role of ['viewer', 'editor']) {
      await db.setup.query('update public.user_roles set role=$1 where user_id=$2', [role, OWNER]);
      await assert.rejects(periods(), denied);
    }
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
    await assert.rejects(periods({ effective: ADMIN }), denied);
    await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1', [OWNER]);
    await assert.rejects(periods(), denied);
    await grantQuery(db, OWNER);
    await db.setup.query('update private.ai_query_control set enabled=false');
    await assert.rejects(periods(), denied);
    await db.setup.query('update private.ai_query_control set enabled=true');
  });
  await check('失效/错误/已删除会话不返回任何metadata', async () => {
    await assert.rejects(periods({ session: randomUUID() }), denied);
    await db.setup.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [SESSION]);
    await assert.rejects(periods(), denied);
    await db.setup.query('update auth.sessions set not_after=null where id=$1', [SESSION]);
    await db.setup.query('delete from auth.sessions where id=$1', [SESSION]);
    await assert.rejects(periods(), denied);
    await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)', [SESSION, OWNER]);
  });
  await check('读取完毕恢复原JWT上下文，不留下被模拟的数据库身份', async () => {
    const revision = (await authority()).permission_revision;
    await db.setup.query('begin');
    try {
      await db.setup.query('set local role service_role');
      const original = JSON.stringify({ sub: ADMIN, role: 'service_role' });
      await db.setup.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [ADMIN, original]);
      await db.setup.query('select public.ai_query_available_periods($1,$1,$2,$3,$4,$5,$6,$7)', [OWNER, SESSION, revision, ['totalArea'], 'tracked', ['CBD'], null]);
      const claims = (await db.setup.query("select current_setting('request.jwt.claim.sub') sub,current_setting('request.jwt.claims') claims")).rows[0];
      assert.equal(claims.sub, ADMIN); assert.equal(claims.claims, original);
    } finally { await db.setup.query('rollback'); }
  });
  await check('40期窗口明确标记截断，不把旧数据伪称不存在', async () => {
    for (let i = 0; i < 42; i++) await metric({ year: 2000 + Math.floor(i / 4), quarter: i % 4 + 1 });
    const result = await periods();
    assert.equal(result.periods.length, 40); assert.equal(result.truncated, true);
    assert.equal(keys(result).at(-1), '2026Q4');
    assert.ok(!keys(result).includes('2000Q1'));
  });
  await check('三个新RPC均只允许service_role执行，客户端无法直接调用', async () => {
    const signatures = [
      'ai_query_available_periods(uuid,uuid,uuid,text,text[],text,text[],uuid[])',
      'ai_query_context_read(uuid,uuid,uuid,uuid)', 'ai_query_model_budget(uuid,uuid,uuid,uuid)',
    ];
    for (const schema of ['public', 'private']) for (const signature of signatures) for (const role of ['anon', 'authenticated', 'service_role']) {
      const privilege = (await db.setup.query('select has_function_privilege($1,$2,$3) allowed', [role, `${schema}.${signature}`, 'execute'])).rows[0].allowed;
      assert.equal(privilege, role === 'service_role');
    }
    await assert.rejects(db.asUser(OWNER, 'select public.ai_query_context_read($1,$1,$2,$3)', [OWNER, SESSION, randomUUID()]), denied);
    await assert.rejects(db.asUser(OWNER, 'select public.ai_query_model_budget($1,$1,$2,$3)', [OWNER, SESSION, randomUUID()]), denied);
    await assert.rejects(db.asUser(OWNER, 'select public.ai_query_available_periods($1,$1,$2,$3,$4,$5,$6,$7)', [OWNER, SESSION, 'a'.repeat(64), ['totalArea'], 'tracked', ['CBD'], null]), denied);
  });
  const adminSession = randomUUID();
  await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)', [adminSession, ADMIN]);
  await grantQuery(db, ADMIN);
  await check('上下文仅返回本人的有效链解释事件，跨账号/未知请求/撤权拒绝并留痕', async () => {
    const id = await auditRequest();
    await append(id, 'tool_finished'); await append(id, 'response_generated'); await append(id, 'succeeded');
    const own = await context(id);
    assert.equal(own.allowed, true);
    assert.deepEqual(own.events.map(event => event.kind), ['received', 'running', 'tool_finished']);
    assert.equal((await context(id, ADMIN, adminSession)).allowed, false);
    assert.equal((await context(randomUUID())).allowed, false);
    await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1', [OWNER]);
    assert.equal((await context(id)).allowed, false);
    await grantQuery(db, OWNER);
    const access = (await db.setup.query('select outcome from private.ai_query_result_access where request_id=$1', [id])).rows;
    assert.ok(access.some(row => row.outcome === 'allowed')); assert.ok(access.filter(row => row.outcome === 'denied').length >= 2);
  });
  await check('上下文链损坏或超过512KiB解释预算时失败关闭', async () => {
    const id = await auditRequest();
    await db.setup.query("update private.ai_query_audit_events set payload_digest=repeat('d',64) where request_id=$1 and sequence=1", [id]);
    assert.equal((await context(id)).allowed, false);
    const inconsistent = await auditRequest();
    await db.setup.query("update private.ai_query_audit_streams set state='succeeded' where request_id=$1", [inconsistent]);
    assert.equal((await context(inconsistent)).allowed, false);
    const large = await auditRequest(OWNER, 'running', 100000); await append(large, 'tool_finished', 100000);
    assert.equal((await context(large)).allowed, false);
  });
  await check('模型预算只对本人running请求开放，12次/分钟与120次/24h边界精确', async () => {
    const id = await auditRequest(ADMIN);
    assert.equal((await budget(id, ADMIN, adminSession)).allowed, true);
    assert.equal((await budget(id)).allowed, false);
    assert.equal((await budget(randomUUID(), ADMIN, adminSession)).allowed, false);
    const addReceipts = async (count, recent = true) => db.setup.query(`insert into private.ai_query_audit_streams(request_id,actor_id,effective_user_id,actor_role,effective_role,identity_valid,policy_version,payload_digest,state,received_at)
      select gen_random_uuid(),$1,$1,'admin','admin',true,'p1-budget-fixture',repeat('a',64),'received',clock_timestamp()-case when $3 then interval '0' else interval '2 minutes' end from generate_series(1,$2)`, [ADMIN, count, recent]);
    await addReceipts(11);
    assert.equal((await budget(id, ADMIN, adminSession)).allowed, true);
    await addReceipts(1);
    assert.equal((await budget(id, ADMIN, adminSession)).allowed, false);
    await db.setup.query("update private.ai_query_audit_streams set received_at=clock_timestamp()-interval '2 minutes' where actor_id=$1 and request_id<>$2", [ADMIN, id]);
    assert.equal((await budget(id, ADMIN, adminSession)).allowed, true);
    await addReceipts(107, false);
    assert.equal((await budget(id, ADMIN, adminSession)).allowed, true);
    await addReceipts(1, false);
    assert.equal((await budget(id, ADMIN, adminSession)).allowed, false);
  });
  await check('metadata事务持有授权锁，撤权完成后下一次调用被拒绝', async () => {
    const writer = new pg.Client({ host: '127.0.0.1', port: Number(process.env.LEASE_TEST_PG_PORT), user: 'postgres', password: 'synthetic_ci_only', database: db.database });
    await writer.connect();
    try {
      const revision = (await authority()).permission_revision;
      await db.setup.query('begin'); await db.setup.query('set local role service_role');
      await db.setup.query('select public.ai_query_available_periods($1,$1,$2,$3,$4,$5,$6,$7)', [OWNER, SESSION, revision, ['totalArea'], 'tracked', ['CBD'], null]);
      await writer.query("set lock_timeout='150ms'");
      await assert.rejects(writer.query('update private.ai_query_grants set enabled=false where user_id=$1', [OWNER]), error => error.code === '55P03');
      await db.setup.query('commit');
      await writer.query('update private.ai_query_grants set enabled=false where user_id=$1', [OWNER]);
      await assert.rejects(periods(), denied);
    } finally { await db.setup.query('rollback'); await writer.end(); }
  });
  await mkdir('verification/ai-query-p1', { recursive: true });
  await writeFile('verification/ai-query-p1/results.json', JSON.stringify({ database: db.version, scenarios: results, production: false, realAuth: false }, null, 2) + '\n');
  console.log(`PASS ${results.length} P1 PostgreSQL scenarios; sessions are SQL fixtures, not real Auth login evidence`);
} finally { await db.close(); }
