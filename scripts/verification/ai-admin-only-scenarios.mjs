import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';

export async function verifyAdminOnly({ db, app, check, person, call, input, capabilities, recover, artifact, acknowledge, exportCaps }) {
  const audit = async who => {
    const response = await fetch(app + '/api/intelligence/audit', { method: 'POST', headers: { Authorization: 'Bearer ' + who.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', from: new Date(Date.now() - 86400000).toISOString(), to: new Date().toISOString() }) });
    return { status: response.status, body: await response.json() };
  };
  const grants = async who => {
    await grantQuery({ setup: db }, who.id, { capabilities: exportCaps });
    await db.query("insert into private.ai_audit_read_grants(user_id,valid_until,grant_reference) values($1,now()+interval '1 day','synthetic admin-only matrix')", [who.id]);
  };
  await check('viewer/editor即使持全部AI查询、导出和审计资格仍拒绝，旧公开开关不能放行', async () => {
    for (const role of ['viewer', 'editor']) {
      const who = await person(role, 'admin-only-' + role); await grants(who);
      assert.equal((await capabilities(who)).body.enabled, false);
      const submitted = await call(who, input()); assert.equal(submitted.status, 403); assert.equal(submitted.body.result, undefined);
      assert.equal((await db.query("select count(*)::int n from private.ai_query_audit_events where request_id=$1 and kind='running'", [submitted.body.requestId])).rows[0].n, 0);
      assert.equal((await audit(who)).status, 403);
      assert.equal((await recover(who, randomUUID())).status, 403);
      for (const route of ['parse-requirement', 'recommend']) {
        const response = await fetch(app + '/api/intelligence/' + route, { method: 'POST', headers: { Authorization: 'Bearer ' + who.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ requirement: 'CBD办公楼' }) });
        assert.equal(response.status, 403);
      }
      const expiry = await fetch(app + '/api/intelligence/lease-expiry', { headers: { Authorization: 'Bearer ' + who.token } }); assert.equal(expiry.status, 403);
    }
  });
  await check('admin降级后旧JWT/旧快照/作图/下载/交付回执/审计均拒绝，重新成为admin仍沿用独立资格', async () => {
    const who = await person('admin', 'role-revocation'); await grants(who);
    const source = await call(who, input()); assert.equal(source.status, 200); assert.equal((await audit(who)).status, 200);
    assert.equal((await call(who, input(), { 'X-Colliers-Impersonate-User': who.id })).status, 403);
    assert.equal((await capabilities(who, { 'X-Colliers-Impersonate-User': who.id })).body.enabled, false);
    const common = { requestId: source.body.requestId, resultId: source.body.result.resultId };
    await db.query("update public.user_roles set role='viewer' where user_id=$1", [who.id]);
    assert.equal((await capabilities(who)).body.enabled, false);
    assert.equal((await call(who, input())).status, 403);
    assert.equal((await recover(who, source.body.requestId)).status, 403);
    assert.equal((await artifact(who, { ...common, action: 'chart', chart: { kind: 'bar', field: 'height' } })).status, 403);
    assert.equal((await artifact(who, { ...common, action: 'export', format: 'xlsx' })).status, 403);
    assert.equal((await acknowledge(who, source)).status, 403);
    assert.equal((await audit(who)).status, 403);
    await db.query("update public.user_roles set role='admin' where user_id=$1", [who.id]);
    assert.equal((await capabilities(who)).body.enabled, true); assert.equal((await audit(who)).status, 200);
    await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [who.id]); assert.equal((await call(who, input())).status, 403);
  });
}
