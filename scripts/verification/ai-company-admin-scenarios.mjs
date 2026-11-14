import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Seed synthetic names into the governed read layer when available; retain the
// narrow view fixture for standalone legacy checks. Auth/session/RPC/Next are real and local.
export async function setupCompanyAdmin(db, load) {
  await db.query(await load('20261114070036_ai_legacy_admin_session.sql'));
  if ((await db.query("select to_regclass('public.lease_transactions_read_v1') r")).rows[0].r) {
    await db.query(`insert into public.lease_transactions(id,company,new_building,transaction_year,transaction_quarter)
      select gen_random_uuid(),name,'合成楼宇',2026,'Q4' from unnest(array['准入证券股份有限公司','出队证券股份有限公司','返回证券股份有限公司','缓存证券股份有限公司']) name;
      insert into public.lease_transactions_history(id,source_uid,company,new_building,transaction_year,transaction_quarter)
      values(gen_random_uuid(),'company-history-fixture','归档专属公司','合成楼宇',2026,'Q4');`);
  } else await db.query(`
    create table private.company_admin_fixture(company text, record_source text);
    insert into private.company_admin_fixture values
      ('准入证券股份有限公司','live'),('出队证券股份有限公司','live'),
      ('返回证券股份有限公司','live'),('缓存证券股份有限公司','live'),('归档专属公司','history');
    grant select on private.company_admin_fixture to service_role;
    create view public.lease_transactions_read_v1 with (security_invoker=true) as
      select company, record_source, null::text suspected_company_fullname,
        company::text read_id, date '2026-10-01' transaction_period_start,
        '合成楼宇'::text new_building, null::text demand_type, 100::numeric area_sqm,
        10::numeric effective_rent, null::date transaction_date, 2026 transaction_year,
        'Q4'::text transaction_quarter, null::text industry, 'CBD'::text sub_market,
        'exact'::text building_match_scope, 'OPERATIONAL'::text quality_status
      from private.company_admin_fixture;
    grant select on public.lease_transactions_read_v1 to service_role;
  `);
  await db.query(await load('20261111084119_lease_company_ai_assessment.sql'));
  let calls = 0, hold = false, release;
  const provider = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/responses');
      let raw = ''; for await (const part of req) raw += part;
      const pairs = JSON.parse(JSON.parse(raw).input); calls++;
      if (hold) await new Promise(resolve => { release = resolve; });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{
        type: 'output_text', text: JSON.stringify({ results: pairs.map(p => ({ pair: p.pair, relation: 'same_company', strength: 'strong' })) }),
      }] }] }));
    } catch { res.statusCode = 500; res.end(); }
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const baseUrl = `http://127.0.0.1:${provider.address().port}`;
  const model = 'synthetic-company-admin';
  return {
    env: { LEASE_COMPANY_AI_MODE: 'hints', DEEPSEEK_API_KEY: 'synthetic-local-only', DEEPSEEK_API_BASE_URL: baseUrl, DEEPSEEK_MODEL: model },
    policy: createHash('sha256').update(JSON.stringify(['lease-company-pair-v1', baseUrl, model])).digest('hex'),
    calls: () => calls,
    hold: () => { hold = true; },
    release: () => { hold = false; release?.(); release = undefined; },
    close: async () => { hold = false; release?.(); provider.close(); await once(provider, 'close'); },
  };
}

export async function verifyCompanyAdmin({ db, blocker, withdrawal, service, app, check, person, until, fixture, logPath }) {
  const deniedCount = async () => ((await readFile(logPath, 'utf8')).match(/\[lease-company-ai\] deferred assessment did not complete/g) ?? []).length;
  const base = app + '/api/lease-transactions/read';
  const headers = who => who ? { Authorization: 'Bearer ' + who.token } : {};
  const assess = (who, company, extra = {}) => fetch(base + '?company_lookup=assess', {
    method: 'POST', headers: { ...headers(who), 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ company }),
  });
  const hints = (who, company) => fetch(base + '?' + new URLSearchParams({ company_lookup: 'suggestions', company }), { headers: headers(who) });
  const authority = async who => {
    const r = await service.rpc('ai_admin_session_authority', { p_actor: who.id, p_session: who.sessionId });
    assert.equal(r.error, null); return r.data;
  };
  const status = async company => (await db.query('select status from public.lease_company_ai_assessments where key_a=$1 or key_b=$1', [company])).rows[0]?.status;
  const noAi = async (who, company) => {
    const response = await hints(who, company); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.canAssessSimilar, undefined);
    assert.ok(result.suggestions.every(x => x.relation === undefined)); return result;
  };
  const admin = await person('admin', 'company-admin');
  await check('企业AI：viewer/editor拒绝发起和缓存提示，普通成交检索仍可用', async () => {
    assert.equal((await assess(null, '准入证券')).status, 401);
    for (const role of ['viewer', 'editor']) {
      const who = await person(role, 'company-' + role);
      assert.equal(await authority(who), false);
      assert.equal((await assess(who, '准入证券')).status, 403);
      const ordinary = await noAi(who, '准入证券'); assert.equal(ordinary.suggestions.length, 1);
      assert.equal((await noAi(who, '归档专属')).suggestions.length, 0);
      const direct = await who.client.rpc('ai_admin_session_authority', { p_actor: admin.id, p_session: admin.sessionId });
      assert.ok(direct.error, 'Client RPC cannot impersonate an admin');
      const cache = await who.client.rpc('lease_company_ai_hints_v1', { p_policy: fixture.policy, p_query_key: '准入证券', p_source: 'all' });
      assert.ok(cache.error);
    }
    assert.equal(fixture.calls(), 0);
  });
  await check('企业AI：当前admin正常异步执行一次，自模拟/空模拟头均拒绝', async () => {
    for (const value of ['', admin.id]) assert.equal((await assess(admin, '准入证券', { 'x-colliers-impersonate-user': value })).status, 403);
    assert.equal(await authority(admin), true);
    const other = await person('admin', 'company-other-session');
    const mismatched = await service.rpc('ai_admin_session_authority', { p_actor: admin.id, p_session: other.sessionId });
    assert.equal(mismatched.error, null); assert.equal(mismatched.data, false);
    const response = await hints(admin, '准入证券'); assert.equal((await response.json()).canAssessSimilar, true);
    assert.equal(fixture.calls(), 0, 'GET must never start a model call');
    assert.equal((await assess(admin, '准入证券')).status, 202);
    await until(async () => await status('准入证券') === 'scored', 'local synthetic company completion');
    assert.equal(fixture.calls(), 1);
  });
  await check('企业AI：当前角色、停用及会话删除复查，旧JWT不能继续启动', async () => {
    const who = await person('admin', 'company-session');
    await db.query("update public.user_roles set role='editor' where user_id=$1", [who.id]);
    assert.equal(await authority(who), false); assert.equal((await assess(who, '出队证券')).status, 403); await noAi(who, '出队证券');
    await db.query("update public.user_roles set role='admin' where user_id=$1", [who.id]);
    await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1", [who.id]);
    assert.equal(await authority(who), false); assert.ok([401, 403].includes((await assess(who, '出队证券')).status));
    await db.query('update auth.users set banned_until=null where id=$1', [who.id]);
    await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [who.sessionId]);
    assert.equal(await authority(who), false); assert.ok([401, 403].includes((await assess(who, '出队证券')).status));
    await db.query('delete from auth.sessions where id=$1', [who.sessionId]);
    assert.equal(await authority(who), false); assert.ok([401, 403].includes((await assess(who, '出队证券')).status));
    assert.equal(fixture.calls(), 1);
  });
  await check('企业AI：已排队请求在claim等待期间降权，释放锁后不调用模型', async () => {
    const who = await person('admin', 'company-queue');
    const before = await deniedCount();
    await blocker.query('select pg_advisory_lock(725934,1)');
    try {
      assert.equal((await assess(who, '出队证券')).status, 202);
      await until(async () => (await db.query("select 1 from pg_stat_activity where wait_event='advisory' and query like '%lease_company_ai_claim_v1%'")).rowCount > 0, 'company claim waiting');
      await withdrawal.query("update public.user_roles set role='viewer' where user_id=$1", [who.id]);
    } finally { await blocker.query('select pg_advisory_unlock(725934,1)'); }
    await until(async () => await status('出队证券') === 'claimed', 'claimed without provider');
    await until(async () => await deniedCount() > before, 'deferred denial completed');
    assert.equal(fixture.calls(), 1);
  });
  await check('企业AI：模型响应等待期间降权，结果不写入共享提示缓存', async () => {
    const who = await person('admin', 'company-response'); fixture.hold();
    const before = await deniedCount();
    try {
      assert.equal((await assess(who, '返回证券')).status, 202);
      await until(async () => fixture.calls() === 2, 'synthetic provider waiting');
      await db.query("update public.user_roles set role='viewer' where user_id=$1", [who.id]);
    } finally { fixture.release(); }
    await until(async () => await deniedCount() > before, 'provider response denied before save');
    await noAi(who, '返回证券');
    assert.equal(await status('返回证券'), 'claimed');
  });
  await check('企业AI：实际缓存读取期间降权，返回前丢弃关系提示及AI按钮', async () => {
    const who = await person('admin', 'company-hints');
    await db.query("update public.lease_company_ai_assessments set reviewed_relation=relation, review_evidence='synthetic review' where status='scored'");
    await db.query(`insert into public.lease_company_ai_assessments
      (policy_key,key_a,key_b,name_a,name_b,status,relation,strength,completed_at,reviewed_relation,review_evidence,created_at)
      select $1,'校准'||n,'校准'||n||'公司','校准'||n,'校准'||n||'公司','scored','same_company','strong',
        now()-interval '1 day','same_company','synthetic review',now()-interval '1 day' from generate_series(1,99) n`, [fixture.policy]);
    const permitted = await hints(who, '准入证券');
    assert.equal((await permitted.json()).suggestions[0].relation, 'same_company');
    await blocker.query('begin; lock table public.lease_company_ai_assessments in access exclusive mode');
    let pending;
    try {
      pending = hints(who, '准入证券');
      await until(async () => (await db.query("select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%lease_company_ai_hints_v1%' and pid<>pg_backend_pid()")).rowCount > 0, 'hints cache read waiting');
      await withdrawal.query("update public.user_roles set role='editor' where user_id=$1", [who.id]);
    } finally { await blocker.query('commit'); }
    const result = await (await pending).json();
    assert.equal(result.canAssessSimilar, undefined);
    assert.ok(result.suggestions.every(x => x.relation === undefined));
  });
  await check('企业AI：授权服务故障时关闭AI，普通企业检索可继续', async () => {
    await db.query('revoke execute on function public.ai_admin_session_authority(uuid,uuid) from service_role');
    try {
      assert.equal((await assess(admin, '缓存证券')).status, 503);
      assert.equal((await noAi(admin, '缓存证券')).suggestions.length, 1);
    } finally { await db.query('grant execute on function public.ai_admin_session_authority(uuid,uuid) to service_role'); }
  });
}
