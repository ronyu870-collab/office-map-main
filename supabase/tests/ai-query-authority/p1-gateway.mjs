// Actual P1 adapters → Supabase JS → pinned PostgREST 16.5 → PostgreSQL 17.
// Identity/session are SQL fixtures, not evidence of a real GoTrue sign-in.
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';
import { createClient } from '@supabase/supabase-js';
import { OWNER, ADMIN } from '../lease-change-history/database.mjs';
import { createAiQueryTestDatabase, grantQuery, SESSION } from './database.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
import { addSnapshotFixture, BUILDINGS } from './snapshot-fixture.mjs';
import { installAi5QuarterlyFixture } from './ai5-fixture.mjs';

const db = await createAiQueryTestDatabase(), results = [];
const root = process.cwd(), temporary = await mkdtemp(path.join(tmpdir(), 'colliers-p1-rpc-'));
const role = `p1_gateway_${randomBytes(8).toString('hex')}`, password = randomBytes(32).toString('hex'), secret = randomBytes(48).toString('hex');
let server;
const check = async (scenario, fn) => { await fn(); results.push({ scenario, status: 'passed' }); console.log('PASS ' + scenario); };
const migration = file => readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8');
try {
  await loadAuditPrerequisites(db); await applyAdminOnly(db); await addSnapshotFixture(db);
  await db.setup.query(await migration('20261113042352_ai_query_result_recovery.sql'));
  await db.setup.query(await migration('20261115103701_ai_query_available_periods.sql'));
  await installAi5QuarterlyFixture(db.setup, migration);
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
  await db.setup.query('update private.ai_query_control set enabled=true'); await grantQuery(db, OWNER);
  await db.setup.query("update public.buildings set submarket='金融街' where id=$1", [BUILDINGS[1]]);
  const exports = {
    auditStore: ['createRpcAuditPort'], serverAuthority: ['loadDataAuthority'], admission: ['runAuditedSubmission'],
    availablePeriods: ['readAvailablePeriods'], conversationStore: ['readConversation'],
    conversationProtocol: ['SEMANTIC_PROTOCOL_VERSION'], semanticExecution: ['prepareSemanticExecution', 'attachSemanticExecution'],
    snapshotReader: ['readQuerySnapshots'], executePlan: ['executeQueryPlan'], resultArchive: ['decodeGeneratedArchive'],
  };
  const bundle = await rolldown({ input: '\0p1-adapters', platform: 'node', resolve: { alias: { '@': root } }, plugins: [{
    name: 'actual-p1-adapters', resolveId(id) { if (id === '\0p1-adapters') return id; },
    load(id) { if (id === '\0p1-adapters') return Object.entries(exports).map(([file, names]) =>
      `export {${names.join(',')}} from ${JSON.stringify(root + '/src/lib/intelligence/query/' + file + '.ts')};`).join('\n'); },
  }] });
  let compiled;
  try { compiled = (await bundle.generate({ format: 'cjs' })).output.find(file => file.type === 'chunk').code; }
  finally { await bundle.close(); }
  const modulePath = path.join(temporary, 'actual-p1.cjs'); await writeFile(modulePath, compiled);
  const api = createRequire(import.meta.url)(modulePath);
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  await db.setup.query(`create role ${role} login noinherit password '${password}'; grant anon,authenticated,service_role to ${role}`);
  server = spawn(process.env.POSTGREST_PATH || 'postgrest', [], { env: { PATH: process.env.PATH,
    PGRST_DB_URI: `postgresql://${role}:${password}@127.0.0.1:${process.env.LEASE_TEST_PG_PORT}/${db.database}`,
    PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
    PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.resume(); let startError; server.on('error', error => { startError = error; }); let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startError || server.exitCode !== null) throw new Error('POSTGREST_START_FAILED');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Actual PostgREST is required');
  const token = roleName => {
    const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role: roleName, sub: OWNER, exp: Math.floor(Date.now() / 1000) + 300 })}`;
    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  };
  const client = roleName => createClient(url, 'synthetic-publishable', { accessToken: async () => token(roleName), global: { fetch: (input, options) => {
    const target = new URL(input); assert.equal(target.origin, url); assert.ok(target.pathname.startsWith('/rest/v1/'));
    target.pathname = target.pathname.slice('/rest/v1'.length); return fetch(target, options);
  } } });
  const service = client('service_role'), signal = () => new AbortController().signal;
  const identity = { actorId: OWNER, effectiveUserId: OWNER, sessionId: SESSION, expiresAt: Date.now() + 300000 };
  const keys = { keyId: 'p1-isolated-v1', encryptionKey: randomBytes(32), digestKey: randomBytes(32) };
  const audit = api.createRpcAuditPort(service, identity, keys);
  const fresh = () => api.loadDataAuthority(service, identity, signal());
  const conversation = { id: randomUUID() }; let executed = 0, prepared = 0;
  async function submit(question, parentRequestId, requestId = randomUUID()) {
    const turn = { ...conversation, ...(parentRequestId ? { parentRequestId } : {}) };
    let preparation;
    const outcome = await api.runAuditedSubmission({ requestId, submittedText: question, plan: null, authority: await fresh(), signal: signal(),
      metadata: { protocol: api.SEMANTIC_PROTOCOL_VERSION, conversation: turn } }, audit, {
      freshAuthority: fresh,
      prepare: async authority => {
        prepared++;
        preparation = await api.prepareSemanticExecution({ client: service, keys, identity, authority, audit, requestId,
          conversation: turn, question, receivedAt: new Date('2026-11-15T00:00:00Z'), signal: signal() });
        return { plan: preparation.resolution.kind === 'plan' ? preparation.resolution.plan : null,
          ...(preparation.resolution.kind === 'clarification' ? { clarification: preparation.resolution.clarification } : {}), metadata: preparation.metadata };
      },
      replay: async authority => {
        const saved = await api.readConversation(service, identity, keys, authority, turn, requestId, signal(), true);
        return { ...(saved.plan ? { plan: saved.plan } : {}), ...(saved.clarification ? { clarification: saved.clarification } : {}) };
      },
      execute: async (plan, authority) => {
        executed++;
        const snapshots = await api.readQuerySnapshots(service, identity, authority, plan, signal());
        return api.attachSemanticExecution(api.executeQueryPlan(plan, snapshots), preparation);
      },
    });
    return { requestId, outcome };
  }

  await check('真实 SDK 期别来自已授权数据库有效记录，并在读取后重核权限版本', async () => {
    const periods = await api.readAvailablePeriods(service, identity, await fresh(), { inventory: 'tracked', submarkets: ['CBD'] }, ['totalArea', 'netEffectiveRent'], signal());
    assert.deepEqual(periods.periods, [{ year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }]);
    assert.equal(periods.inventory_time, 'current_catalog');
    assert.deepEqual((await api.readAvailablePeriods(service, identity, await fresh(), { inventory: 'tracked', submarkets: ['无此合成地区'] }, ['totalArea'], signal())).periods, []);
  });
  let first, second, third, fourth;
  await check('T01 实际审计→规划→获权快照，金融街追问继承 CBD 租金及真实最新季度', async () => {
    first = await submit('CBD最新季度的净有效租金是多少');
    assert.equal(first.outcome.status, 'ready', JSON.stringify(first.outcome));
    assert.deepEqual(first.outcome.result.parameters.executedPlan.period, { year: 2026, quarter: 3 });
    assert.equal(first.outcome.result.parameters.researchAnalysis.series[0].periods[0].value.numeric, 125);
    second = await submit('金融街呢', first.requestId);
    assert.equal(second.outcome.status, 'ready');
    assert.equal(second.outcome.result.parameters.executedPlan.metric, 'rent');
    assert.deepEqual(second.outcome.result.parameters.executedPlan.scope.submarkets, ['金融街']);
    assert.deepEqual(second.outcome.result.parameters.executedPlan.period, { year: 2026, quarter: 3 });
    assert.equal(second.outcome.result.parameters.researchAnalysis.series[0].periods[0].value.numeric, 200);
  });
  await check('T02/T03 实际上下文继承两地区并形成四季度趋势，缺期保持空值', async () => {
    third = await submit('把两者比较一下', second.requestId);
    assert.equal(third.outcome.status, 'ready');
    assert.equal(third.outcome.result.parameters.executedPlan.operation, 'group_aggregate');
    assert.deepEqual(third.outcome.result.parameters.executedPlan.scope.submarkets, ['CBD', '金融街']);
    fourth = await submit('再看看最近四个季度的变化', third.requestId);
    assert.equal(fourth.outcome.status, 'ready');
    assert.equal(fourth.outcome.result.parameters.executedPlan.operation, 'group_trend');
    for (const series of fourth.outcome.result.parameters.researchAnalysis.series) {
      assert.deepEqual(series.periods.map(period => period.period), [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }]);
      assert.equal(series.periods[0].value, null); assert.equal(series.periods[1].value, null);
      assert.equal(series.direction, 'incomplete'); assert.equal(series.overall.change, null);
    }
  });
  await check('T09 审计分块恢复保留确定性研究、实际条件及真实 building_metrics 来源', async () => {
    const events = (await db.setup.query("select * from private.ai_query_audit_events where request_id=$1 and kind='response_generated' order by sequence", [fourth.requestId])).rows.map(event => ({ ...event, sequence: Number(event.sequence) }));
    const saved = api.decodeGeneratedArchive(events, { requestId: fourth.requestId, actorId: OWNER, effectiveUserId: OWNER }, new Map([[keys.keyId, keys]]));
    assert.deepEqual(saved.result, fourth.outcome.result);
    assert.ok(saved.result.sources.some(source => source.table === 'building_metrics' && source.recordId && source.period?.quarter === 3));
    const ids = new Set(saved.result.sources.map(source => source.id));
    assert.ok(saved.result.parameters.researchAnalysis.findings.every(finding => finding.sourceIds.every(id => ids.has(id))));
  });
  await check('T11 同账号新会话、其他账号及其他 conversation 均不能继承已保存上下文', async () => {
    const a = await fresh(), secondSession = randomUUID(), adminSession = randomUUID();
    await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)', [secondSession, OWNER, adminSession, ADMIN]); await grantQuery(db, ADMIN);
    const otherIdentity = { ...identity, actorId: ADMIN, effectiveUserId: ADMIN, sessionId: adminSession };
    const otherAuthority = await api.loadDataAuthority(service, otherIdentity, signal());
    await assert.rejects(api.readConversation(service, otherIdentity, keys, otherAuthority, conversation, first.requestId, signal()), /QUERY_DENIED/);
    await assert.rejects(api.readConversation(service, { ...identity, sessionId: secondSession }, keys, a, conversation, first.requestId, signal()), /QUERY_DENIED/);
    await assert.rejects(api.readConversation(service, identity, keys, a, { id: randomUUID() }, first.requestId, signal()), /QUERY_DENIED/);
  });
  await check('T13 原请求幂等重试只恢复已审计解释，不重复规划或执行', async () => {
    const before = { prepared, executed };
    const replay = await submit('金融街呢', first.requestId, second.requestId);
    assert.equal(replay.outcome.status, 'already_received'); assert.deepEqual({ prepared, executed }, before);
  });
  await check('新增 metadata/context/model-budget RPC 均在真实网关拒绝终端角色，预算只限本人 running 请求', async () => {
    const id = randomUUID(), a = await fresh();
    await audit.receive({ requestId: id, submittedText: '预算隔离测试', plan: null, authority: a });
    await audit.append(id, 'running', { permissionRevision: a.permissionRevision });
    const own = await service.rpc('ai_query_model_budget', { p_actor: OWNER, p_effective: OWNER, p_session: SESSION, p_request_id: id });
    assert.equal(own.error, null); assert.equal(own.data.allowed, true);
    for (const [name, args] of [
      ['ai_query_available_periods', { p_actor: OWNER, p_effective: OWNER, p_session: SESSION, p_permission_revision: a.permissionRevision, p_fields: ['totalArea'], p_inventory: 'tracked', p_submarkets: ['CBD'], p_building_ids: null }],
      ['ai_query_context_read', { p_actor: OWNER, p_effective: OWNER, p_session: SESSION, p_request_id: first.requestId }],
      ['ai_query_model_budget', { p_actor: OWNER, p_effective: OWNER, p_session: SESSION, p_request_id: id }],
    ]) assert.equal((await client('authenticated').rpc(name, args)).error.code, '42501');
  });
  await check('T11 撤权阻断下一次期别和上下文读取，重新授权的版本也不能接回旧上下文', async () => {
    const stale = await fresh();
    await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1', [OWNER]);
    await assert.rejects(api.readAvailablePeriods(service, identity, stale, { inventory: 'tracked', submarkets: ['CBD'] }, ['totalArea'], signal()), /QUERY_DENIED/);
    await assert.rejects(api.readConversation(service, identity, keys, stale, conversation, first.requestId, signal()), /QUERY_DENIED/);
    await grantQuery(db, OWNER);
    await assert.rejects(api.readConversation(service, identity, keys, await fresh(), conversation, first.requestId, signal()), /QUERY_DENIED/);
  });
  await mkdir('verification/ai-query-p1', { recursive: true });
  await writeFile('verification/ai-query-p1/gateway-results.json', JSON.stringify({ database: db.version, gateway: 'PostgREST 16.5', scenarios: results, production: false, realAuth: false, modelCalls: 0 }, null, 2) + '\n');
  console.log(`PASS ${results.length} P1 actual SDK/PostgREST scenarios; SQL fixture identities, no model or production calls`);
} finally {
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
  await db.setup.query(`drop owned by ${role};drop role if exists ${role}`).catch(() => {});
  await db.close(); await rm(temporary, { recursive: true, force: true });
}
