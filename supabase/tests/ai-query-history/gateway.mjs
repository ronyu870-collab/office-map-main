// Actual history adapters → Supabase JS → PostgREST → disposable PostgreSQL 17.
// SQL session fixtures verify current ownership; not a real GoTrue sign-in claim.
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
import { createAiQueryTestDatabase, grantQuery, SESSION } from '../ai-query-authority/database.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
import { addSnapshotFixture, BUILDINGS } from '../ai-query-authority/snapshot-fixture.mjs';

const db = await createAiQueryTestDatabase(), results = [], root = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), 'colliers-history-rpc-'));
const role = `history_gateway_${randomBytes(8).toString('hex')}`, password = randomBytes(32).toString('hex'), secret = randomBytes(48).toString('hex');
let server;
const check = async (scenario, fn) => { await fn(); results.push({ scenario, status: 'passed' }); console.log('PASS ' + scenario); };
const migration = file => readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8');
try {
  await loadAuditPrerequisites(db); await applyAdminOnly(db); await addSnapshotFixture(db);
  for (const file of ['20261113042352_ai_query_result_recovery.sql','20261115103701_ai_query_available_periods.sql', '20261115173338_ai_query_own_history.sql']) await db.setup.query(await migration(file));
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
  await db.setup.query('update private.ai_query_control set enabled=true'); await grantQuery(db, OWNER);
  const exports = { auditStore: ['createRpcAuditPort'], serverAuthority: ['loadDataAuthority'], admission: ['runAuditedSubmission'],
    conversationStore: ['readConversation'], semanticExecution: ['prepareSemanticExecution', 'attachSemanticExecution'],
    snapshotReader: ['readQuerySnapshots'], executePlan: ['executeQueryPlan'], recovery: ['readOwnResult','recoverOwnResult'],
    historyStore: ['recordHistorySubmission','listOwnHistory','openOwnHistory','changeOwnHistory','prepareHistoryReplay'] };
  const bundle = await rolldown({ input: '\0history-adapters', platform: 'node', resolve: { alias: { '@': root } }, plugins: [{
    name: 'actual-history-adapters', resolveId(id) { if (id === '\0history-adapters') return id; },
    load(id) { if (id === '\0history-adapters') return Object.entries(exports).map(([file, names]) =>
      `export {${names.join(',')}} from ${JSON.stringify(root + '/src/lib/intelligence/query/' + file + '.ts')};`).join('\n'); },
  }] });
  let compiled;
  try { compiled = (await bundle.generate({ format: 'cjs' })).output.find(file => file.type === 'chunk').code; }
  finally { await bundle.close(); }
  const modulePath = path.join(temporary, 'actual-history.cjs'); await writeFile(modulePath, compiled);
  const api = createRequire(import.meta.url)(modulePath);
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); const url = `http://127.0.0.1:${port}`;
  await db.setup.query(`create role ${role} login noinherit password '${password}'; grant anon,authenticated,service_role to ${role}`);
  server = spawn(process.env.POSTGREST_PATH || 'postgrest', [], { env: { PATH: process.env.PATH,
    PGRST_DB_URI: `postgresql://${role}:${password}@127.0.0.1:${process.env.LEASE_TEST_PG_PORT}/${db.database}`,
    PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.resume(); let startError; server.on('error', error => { startError = error; }); let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startError || server.exitCode !== null) throw new Error('POSTGREST_START_FAILED');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Actual PostgREST required');
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
  const keys = { keyId: 'history-isolated-v1', encryptionKey: randomBytes(32), digestKey: randomBytes(32) };
  const audit = api.createRpcAuditPort(service, identity, keys), conversationId = randomUUID();
  const context = async (who = identity) => ({ client: service, keys, identity: who, authority: await api.loadDataAuthority(service, who, signal()), signal: signal() });
  const raw = async (input, who = identity, revision) => service.rpc('ai_query_history', { p_actor: who.actorId, p_effective: who.effectiveUserId,
    p_session: who.sessionId, p_revision: revision ?? (await context(who)).authority.permissionRevision, p_input: input });
  let executionCount = 0;
  async function submit(question, parentRequestId, id = conversationId) {
    const requestId = randomUUID(), turn = { id, ...(parentRequestId ? { parentRequestId } : {}) }; let prepared;
    const outcome = await api.runAuditedSubmission({ requestId, submittedText: question, plan: { resolution: 'server_semantic/1' },
      authority: (await context()).authority, signal: signal(), metadata: { protocol: 'research-conversation/1', conversation: turn } }, audit, {
      freshAuthority: async () => (await context()).authority,
      prepare: async authority => {
        prepared = await api.prepareSemanticExecution({ client: service, keys, identity, authority, audit, requestId,
          conversation: turn, question, receivedAt: new Date('2026-11-15T00:00:00Z'), signal: signal() });
        return { plan: prepared.resolution.kind === 'plan' ? prepared.resolution.plan : null,
          ...(prepared.resolution.kind === 'clarification' ? { clarification: prepared.resolution.clarification } : {}), metadata: prepared.metadata };
      },
      execute: async (plan, authority) => { executionCount++; return api.attachSemanticExecution(api.executeQueryPlan(plan,
        await api.readQuerySnapshots(service, identity, authority, plan, signal())), prepared); },
    });
    assert.equal(outcome.status, 'ready'); return { requestId, outcome, turn };
  }
  const first = await submit('CBD最新季度的净有效租金是多少');
  const second = await submit('看看最近两个季度的变化', first.requestId);
  await check('T10: 历史索引回填原正式对话，不重查数据且不重复保存回答', async () => {
    const page = await api.listOwnHistory(await context(), { action: 'list', search: '', archived: false });
    assert.equal(page.entries.length, 1); assert.equal(page.entries[0].requestId, second.requestId);
    assert.equal(page.entries[0].conversationId, conversationId); assert.equal(executionCount, 2);
    const columns = (await db.setup.query("select column_name from information_schema.columns where table_schema='private' and table_name in ('ai_query_history_threads','ai_query_history_index')")).rows.map(row => row.column_name);
    assert.ok(!columns.some(name => /answer|result|question|body/.test(name)));
    const opened = await api.openOwnHistory(await context(), { action: 'open', conversationId });
    assert.equal(opened.opened.turns.length, 2); assert.deepEqual(opened.opened.selected.reply.result, second.outcome.result); await opened.recheck();
  });
  await check('T10/T17: 修改当前数值后仍恢复原季度/原来源/原数据版本，不执行模型或业务查询', async () => {
    await db.setup.query('update public.building_metrics set net_effective_rent=999 where building_id=$1 and record_year=2026 and record_quarter=3', [BUILDINGS[0]]);
    const opened = await api.openOwnHistory(await context(), { action: 'open', requestId: first.requestId });
    assert.deepEqual(opened.opened.selected.reply.result, first.outcome.result); assert.equal(executionCount, 2); await opened.recheck();
  });
  await check('重新执行只沿用原始绝对计划，原来相对时间和楼宇范围不再次解析', async () => {
    const replay = await api.prepareHistoryReplay(await context(), first.requestId);
    assert.deepEqual(replay.resolution.plan, first.outcome.result.parameters.executedPlan);
    assert.equal(replay.metadata.replayOf, first.requestId); assert.equal(replay.metadata.modelStatus, 'not_needed');
    const plan = replay.resolution.plan, authority = (await context()).authority;
    const fresh = api.executeQueryPlan(plan, await api.readQuerySnapshots(service, identity, authority, plan, signal()));
    assert.notDeepEqual(fresh.table, first.outcome.result.table); assert.deepEqual(plan.period, { year: 2026, quarter: 3 });
  });
  await check('原澄清回复和选项可恢复，查询未执行不能冒充已生成数字', async () => {
    const id = randomUUID(), cid = randomUUID(), a = (await context()).authority;
    const clarification = { code: 'conditions_required', reason: 'metric_required', message: '请选择需要分析的指标。',
      options: [{ id: 'rent', label: '净有效租金', question: 'CBD净有效租金是多少' }] };
    await audit.receive({ requestId: id, submittedText: '分析一下', plan: { resolution: 'server_semantic/1' }, authority: a,
      metadata: { protocol: 'research-conversation/1', conversation: { id: cid } } });
    await audit.append(id, 'running', { permissionRevision: a.permissionRevision });
    await audit.append(id, 'denied', { reason: 'clarification_required', response: clarification,
      resolution: { protocol: 'research-conversation/1', turn: 1, semanticContext: { version: 'colliers-semantic-context/1',
        comparisonSubmarkets: [], pending: { question: '分析一下', clarification } } } });
    await api.recordHistorySubmission(service, keys, identity, cid, id);
    const opened = await api.openOwnHistory(await context(), { action: 'open', requestId: id }); await opened.recheck();
    assert.equal(opened.opened.selected.reply.status, 'clarification'); assert.equal(opened.opened.selected.reply.message, clarification.message);
    assert.deepEqual(opened.opened.selected.reply.options, clarification.options); assert.equal(opened.opened.selected.reply.result, undefined);
    await api.changeOwnHistory(await context(), { action: 'archive', conversationId: cid, archived: true });
  });
  await check('T11: 重命名加密、搜索仅本人、归档保留审计且可以恢复', async () => {
    const beforeEvents = (await db.setup.query('select count(*)::int n from private.ai_query_audit_events')).rows[0].n;
    await api.changeOwnHistory(await context(), { action: 'rename', conversationId, title: 'CBD季度工作记录' });
    const stored = (await db.setup.query('select * from private.ai_query_history_threads where conversation_id=$1', [conversationId])).rows[0];
    assert.ok(!JSON.stringify(stored).includes('CBD季度工作记录'));
    const page = await api.listOwnHistory(await context(), { action: 'list', search: 'ＣＢＤ季度', archived: false });
    assert.equal(page.entries.length, 1); assert.equal(page.entries[0].title, 'CBD季度工作记录');
    await api.changeOwnHistory(await context(), { action: 'archive', conversationId, archived: true });
    assert.equal((await api.listOwnHistory(await context(), { action: 'list', search: '', archived: false })).entries.length, 0);
    assert.ok((await api.listOwnHistory(await context(), { action: 'list', search: '', archived: true })).entries.some(entry => entry.conversationId === conversationId));
    await api.changeOwnHistory(await context(), { action: 'archive', conversationId, archived: false });
    assert.equal((await db.setup.query('select count(*)::int n from private.ai_query_audit_events')).rows[0].n, beforeEvents);
    assert.ok((await db.setup.query("select count(*)::int n from private.ai_query_history_access where action in ('rename','archive') and outcome='allowed'")).rows[0].n >= 3);
  });
  const newSession = randomUUID(); await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)', [newSession, OWNER]);
  const currentIdentity = { ...identity, sessionId: newSession };
  await check('T12: 新会话必须显式打开获权历史，签名继续上下文仍复核原来源', async () => {
    const current = await context(currentIdentity);
    await assert.rejects(api.readConversation(service, currentIdentity, keys, current.authority, { id: conversationId }, first.requestId, signal()), /QUERY_DENIED/);
    const opened = await api.openOwnHistory(current, { action: 'open', requestId: first.requestId }); await opened.recheck();
    assert.ok(opened.opened.conversation.resumeToken); assert.equal(opened.opened.conversation.parentRequestId, first.requestId);
    const inherited = await api.readConversation(service, currentIdentity, keys, current.authority, opened.opened.conversation, first.requestId, signal());
    assert.equal(inherited.plan.metric, 'rent');
    const tampered = { ...opened.opened.conversation, resumeToken: opened.opened.conversation.resumeToken.slice(0, -2) + 'xx' };
    await assert.rejects(api.readConversation(service, currentIdentity, keys, current.authority, tampered, first.requestId, signal()), /QUERY_DENIED/);
  });
  const adminSession = randomUUID(); await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)', [adminSession, ADMIN]); await grantQuery(db, ADMIN);
  const another = { ...identity, actorId: ADMIN, effectiveUserId: ADMIN, sessionId: adminSession };
  await check('T11/T12: 其他有资格管理员不能列表、定位、打开或修改本人的记录', async () => {
    assert.equal((await api.listOwnHistory(await context(another), { action: 'list', search: 'CBD', archived: false })).entries.length, 0);
    for (const input of [{ action: 'locate', requestId: first.requestId }, { action: 'turns', conversationId },
      { action: 'archive', conversationId, archived: true }]) assert.equal((await raw(input, another)).data.allowed, false);
    await assert.rejects(api.openOwnHistory(await context(another), { action: 'open', requestId: first.requestId }), /QUERY_DENIED/);
    const missing = await raw({ action: 'locate', requestId: randomUUID() }, another);
    assert.deepEqual(missing.data, (await raw({ action: 'locate', requestId: first.requestId }, another)).data);
  });
  await check('T12/T18: 撤销来源、字段、会话或角色后不交付历史结果', async () => {
    await db.setup.query('update public.buildings set merged_into_id=$2 where id=$1', [BUILDINGS[0], BUILDINGS[1]]);
    await assert.rejects(api.openOwnHistory(await context(), { action: 'open', requestId: first.requestId }), /QUERY_DENIED/);
    await db.setup.query('update public.buildings set merged_into_id=null where id=$1', [BUILDINGS[0]]);
    const opened = await api.openOwnHistory(await context(), { action: 'open', requestId: first.requestId });
    // A later failed continuation must not erase the previous question's scope
    // from title/search authorization after a field is withdrawn.
    const failed = randomUUID();
    await audit.receive({ requestId: failed, submittedText: '再看一次', plan: { resolution: 'server_semantic/1' },
      authority: (await context()).authority, metadata: { protocol: 'research-conversation/1',
        conversation: { id: conversationId, parentRequestId: first.requestId } } });
    await audit.append(failed, 'failed', { reason: 'synthetic_context_expiry' });
    await api.recordHistorySubmission(service, keys, identity, conversationId, failed);
    await grantQuery(db, OWNER, { fields: ['height'] }); await assert.rejects(opened.recheck(), /QUERY_DENIED/);
    assert.equal((await api.listOwnHistory(await context(), { action: 'list', search: '', archived: false })).entries.length, 0);
    await assert.rejects(api.changeOwnHistory(await context(), { action: 'rename', conversationId, title: '不可越权修改' }), /QUERY_DENIED/);
    await grantQuery(db, OWNER);
    const revision = (await context()).authority.permissionRevision;
    await db.setup.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [SESSION]);
    assert.equal((await raw({ action: 'list' }, identity, revision)).data.allowed, false);
    await db.setup.query('update auth.sessions set not_after=null where id=$1', [SESSION]);
    await db.setup.query("update public.user_roles set role='viewer' where user_id=$1", [OWNER]);
    assert.equal((await raw({ action: 'list' }, identity, revision)).data.allowed, false);
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]); await grantQuery(db, OWNER);
    assert.equal((await raw({ action: 'list' }, { ...identity, effectiveUserId: ADMIN }, (await context()).authority.permissionRevision)).data.allowed, false);
  });
  await check('T15: 分页为15个对话、10轮摘要，游标绑定搜索/会话/权限且无重复记录', async () => {
    for (let i = 0; i < 17; i++) {
      const id = randomUUID();
      await audit.receive({ requestId: id, submittedText: `分页合成问题${i}`, plan: { operation: 'list', fields: [], period: null, scope: { inventory: 'tracked' } },
        authority: (await context()).authority, metadata: { relation: 'initial_structured_submission' } });
      await audit.append(id, 'failed', { reason: 'synthetic_terminal' });
      assert.equal(await api.recordHistorySubmission(service, keys, identity, id, id), true);
    }
    const page = await api.listOwnHistory(await context(), { action: 'list', search: '', archived: false });
    assert.equal(page.entries.length, 15); assert.equal(page.hasMore, true); assert.ok(page.nextCursor);
    const secondPage = await api.listOwnHistory(await context(), { action: 'list', search: '', archived: false, cursor: page.nextCursor });
    assert.equal(new Set([...page.entries, ...secondPage.entries].map(row => row.conversationId)).size, 18);
    await assert.rejects(api.listOwnHistory(await context(), { action: 'list', search: 'changed', archived: false, cursor: page.nextCursor }), /QUERY_DENIED/);
    await assert.rejects(api.listOwnHistory(await context(currentIdentity), { action: 'list', search: '', archived: false, cursor: page.nextCursor }), /QUERY_DENIED/);
    await grantQuery(db, OWNER);
    await assert.rejects(api.listOwnHistory(await context(), { action: 'list', search: '', archived: false, cursor: page.nextCursor }), /QUERY_DENIED/);
  });
  await check('长对话每次只恢复一轮，10轮摘要分页不会截断或重复', async () => {
    const cid = randomUUID(), ids = [];
    for (let i = 0; i < 12; i++) {
      const id = randomUUID(); ids.push(id);
      await audit.receive({ requestId: id, submittedText: `长对话合成问题${i}`, plan: { operation: 'list', fields: [], period: null, scope: { inventory: 'tracked' } },
        authority: (await context()).authority, metadata: { protocol: 'research-conversation/1', conversation: { id: cid } } });
      await audit.append(id, 'failed', { reason: 'synthetic_terminal' }); await api.recordHistorySubmission(service, keys, identity, cid, id);
    }
    const page = await api.openOwnHistory(await context(), { action: 'open', conversationId: cid });
    assert.equal(page.opened.turns.length, 10); assert.equal(page.opened.hasMore, true);
    assert.equal(page.opened.selected.requestId, ids.at(-1)); assert.equal(page.opened.selected.reply.result, undefined);
    const previous = await api.openOwnHistory(await context(), { action: 'open', conversationId: cid, cursor: page.opened.nextCursor });
    assert.equal(previous.opened.turns.length, 2); assert.equal(previous.opened.hasMore, false);
    assert.equal(new Set([...page.opened.turns, ...previous.opened.turns].map(turn => turn.requestId)).size, 12);
    const exact = await api.openOwnHistory(await context(), { action: 'open', conversationId: cid, requestId: ids[0] });
    assert.equal(exact.opened.selected.question, '长对话合成问题0');
    assert.ok(new Date(exact.opened.selected.submittedAt).getFullYear() > 2020);
  });
  await check('T18: 新RPC仅服务端可执行，所有历史表RLS开启且服务角色不能直读', async () => {
    for (const name of ['ai_query_history_threads','ai_query_history_index','ai_query_history_access']) {
      assert.equal((await db.setup.query('select relrowsecurity from pg_class where oid=$1::regclass', [`private.${name}`])).rows[0].relrowsecurity, true);
      for (const actor of ['anon','authenticated','service_role']) assert.equal((await db.setup.query('select has_table_privilege($1,$2,$3) allowed', [actor, `private.${name}`, 'select'])).rows[0].allowed, false);
    }
    for (const actor of ['anon','authenticated']) {
      const response = await client(actor).rpc('ai_query_history', { p_actor: OWNER, p_effective: OWNER, p_session: SESSION,
        p_revision: (await context()).authority.permissionRevision, p_input: { action: 'list' } });
      assert.equal(response.error.code, '42501');
    }
  });
  await check('索引批次失败回滚，不将部分保存宣称完整成功', async () => {
    const id = randomUUID();
    await audit.receive({ requestId: id, submittedText: '回滚合成', plan: null, authority: (await context()).authority });
    const result = await raw({ action: 'index', records: [{ requestId: id, conversationId: id }, { requestId: randomUUID(), conversationId: randomUUID() }] });
    assert.equal(result.error.code, '42501');
    assert.equal((await db.setup.query('select count(*)::int n from private.ai_query_history_index where request_id=$1', [id])).rows[0].n, 0);
  });
  await check('历史结构不可用时不虚报保存，也不阻断原快照恢复或按原计划重查', async () => {
    await db.setup.query('revoke execute on function public.ai_query_history(uuid,uuid,uuid,text,jsonb) from service_role');
    assert.equal(await api.recordHistorySubmission(service, keys, identity, conversationId, first.requestId), false);
    await assert.rejects(api.listOwnHistory(await context(), { action: 'list', search: '', archived: false }), /QUERY_HISTORY_UNAVAILABLE/);
    const replay = await api.prepareHistoryReplay(await context(), first.requestId);
    assert.deepEqual(replay.resolution.plan, first.outcome.result.parameters.executedPlan);
    await db.setup.query('grant execute on function public.ai_query_history(uuid,uuid,uuid,text,jsonb) to service_role');
  });
  await mkdir('verification/ai-query-history', { recursive: true });
  await writeFile('verification/ai-query-history/gateway.json', JSON.stringify({ database: db.version, scenarios: results, production: false, realAuth: false }, null, 2) + '\n');
  console.log(`PASS ${results.length} own history SDK/PostgREST/PostgreSQL scenarios`);
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit').catch(() => {}); }
  await db.close();
  // The gateway role exists only in this isolated cluster and owns no business data.
  const pg = (await import('pg')).default;
  const admin = new pg.Client({ host: '127.0.0.1', port: Number(process.env.LEASE_TEST_PG_PORT), user: 'postgres', password: 'synthetic_ci_only', database: 'postgres' });
  await admin.connect(); try { await admin.query(`drop role if exists ${role}`); } finally { await admin.end(); }
  await rm(temporary, { recursive: true, force: true });
}
