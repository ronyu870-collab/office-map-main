import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';

/** Actual GoTrue login -> built Next HTTP -> PostgreSQL. Only disposable synthetic data is changed. */
export async function verifyP2History({ db, app, check, person, call, recover, artifact, events, decrypt, exportCaps }) {
  const owner = await person('admin', 'p2-history'), other = await person('admin', 'p2-history-other');
  const ids = [randomUUID(), randomUUID()], conversation = { id: randomUUID() };
  const grant = (who, overrides = {}) => grantQuery({ setup: db }, who.id, { capabilities: exportCaps,
    allSubmarkets: false, submarkets: ['CBD'], allBuildings: false, buildingIds: ids, ...overrides });
  const history = async (who, input, headers = {}) => {
    const response = await fetch(app + '/api/intelligence/query/history', { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token, ...headers,
    }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const submit = (who, question, reference = { id: randomUUID() }, extra = {}) => call(who, {
    idempotencyKey: randomUUID(), question, conversation: reference, ...extra,
  });
  let first, second, renewed, restored;
  try {
    for (const [index, id] of ids.entries()) {
      await db.query("insert into public.buildings(id,name,submarket,grade) values($1,$2,'CBD','A')", [id, `P2历史合成${index + 1}座`]);
      for (const year of [2025, 2026]) await db.query(`insert into public.building_metrics
        (building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft)
        values($1,$2,3,10000,$3,1000,false)`, [id, year, year === 2025 ? 80 + index * 20 : 100 + index * 40]);
    }
    await grant(owner); await grant(other);
    await check('Experience P0 问候有真实审计、可恢复本人历史且不能读取他人问候', async () => {
      const helpUser = await person('admin', 'experience-p0-help'); await grant(helpUser);
      const greeting = await submit(helpUser, '你好');
      assert.equal(greeting.status, 200, JSON.stringify(greeting.body));
      assert.equal(greeting.body.reason, 'assistant_help');
      assert.equal(greeting.body.historySaved, true);
      assert.match(greeting.body.message, /Colliers AI/);
      const audit = await events(greeting.body.requestId);
      assert.equal(audit.filter(event => event.kind === 'received').length, 1);
      assert.equal(audit.filter(event => event.kind === 'tool_started').length, 0);
      const opened = await history(helpUser, { action: 'open', requestId: greeting.body.requestId });
      assert.equal(opened.status, 200, JSON.stringify(opened.body));
      assert.equal(opened.body.opened.selected.reply.reason, 'assistant_help');
      assert.equal(opened.body.opened.selected.reply.message, greeting.body.message);
      assert.equal((await history(other, { action: 'open', requestId: greeting.body.requestId })).status, 403);
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [helpUser.id]);
      assert.equal((await submit(helpUser, '你是谁')).status, 403);
      assert.equal((await history(helpUser, { action: 'open', requestId: greeting.body.requestId })).status, 403);
    });
    await check('P2 T10/T17 正式问答自动关联本人历史，对话恢复原始快照且不执行新查询', async () => {
      first = await submit(owner, '2026年第三季度CBD净有效租金是多少？', conversation);
      assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.historySaved, true);
      second = await submit(owner, '去年同期呢', { ...conversation, parentRequestId: first.body.requestId });
      assert.equal(second.status, 200, JSON.stringify(second.body)); assert.equal(second.body.historySaved, true);
      assert.deepEqual(second.body.result.parameters.executedPlan.period, { year: 2025, quarter: 3 });
      const list = await history(owner, { action: 'list' }); assert.equal(list.status, 200);
      assert.equal(list.body.page.entries.filter(entry => entry.conversationId === conversation.id).length, 1);
      assert.match(list.headers.get('cache-control'), /private.*no-store/);
      const before = await events(first.body.requestId);
      await db.query('update public.building_metrics set net_effective_rent=9999 where building_id=any($1::uuid[])', [ids]);
      const opened = await history(owner, { action: 'open', conversationId: conversation.id, requestId: first.body.requestId });
      assert.equal(opened.status, 200, JSON.stringify(opened.body));
      assert.deepEqual(opened.body.opened.selected.reply.result, first.body.result);
      assert.equal(opened.body.opened.selected.question, '2026年第三季度CBD净有效租金是多少？');
      assert.equal(opened.body.opened.turns.length, 2);
      const after = await events(first.body.requestId);
      assert.equal(after.length, before.length, 'Opening history must not append execution events to the original request');
      assert.equal(after.filter(event => event.kind === 'response_generated').length, 1);
    });
    await check('P2 T10 新会话显式重新授权历史，原恢复边界不变，继续分析与复制仍使用真实来源', async () => {
      const signed = await owner.client.auth.signInWithPassword({ email: owner.email, password: owner.password });
      assert.equal(signed.error, null); renewed = { ...owner, token: signed.data.session.access_token };
      renewed.sessionId = JSON.parse(Buffer.from(renewed.token.split('.')[1], 'base64url')).session_id;
      assert.notEqual(renewed.sessionId, owner.sessionId);
      assert.equal((await recover(renewed, first.body.requestId)).status, 403);
      const opened = await history(renewed, { action: 'open', requestId: first.body.requestId });
      assert.equal(opened.status, 200, JSON.stringify(opened.body)); restored = opened.body.opened;
      assert.equal(restored.conversation.id, conversation.id); assert.ok(restored.conversation.resumeToken);
      assert.deepEqual(restored.selected.reply.result, first.body.result);
      const copied = await artifact(renewed, { requestId: first.body.requestId, resultId: first.body.result.resultId,
        action: 'copy', format: 'conclusion' });
      assert.equal(copied.status, 200, JSON.stringify(copied.body)); assert.match(copied.body.text, /2026Q3/);
      assert.doesNotMatch(copied.body.text, /9999|9,999/);
      const resumed = await submit(renewed, '去年同期呢', restored.conversation);
      assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
      assert.deepEqual(resumed.body.result.parameters.executedPlan.period, { year: 2025, quarter: 3 });
      assert.equal(resumed.body.result.table.rows[0].cells.value.value.numeric, 9999);
      const tampered = { ...restored.conversation, resumeToken: restored.conversation.resumeToken + 'x' };
      assert.equal((await submit(renewed, '去年同期呢', tampered)).status, 403);
    });
    await check('P2 T10/T13 明确重查沿用原已执行绝对计划，重试复用请求且不会再次平移去年同期', async () => {
      const input = { idempotencyKey: randomUUID(), question: second.body.result.parameters.interpretation.resolvedQuestion,
        conversation: { id: randomUUID() }, replayRequestId: second.body.requestId };
      const replay = await call(renewed, input); assert.equal(replay.status, 200, JSON.stringify(replay.body));
      assert.deepEqual(replay.body.result.parameters.executedPlan, second.body.result.parameters.executedPlan);
      assert.equal(replay.body.result.table.rows[0].cells.value.value.numeric, 9999);
      const ledger = (await events(replay.body.requestId)).map(decrypt).map(event => event.content);
      assert.ok(ledger.some(event => event.resolution?.replayOf === second.body.requestId));
      const retried = await call(renewed, input); assert.equal(retried.status, 202);
      assert.equal(retried.body.requestId, replay.body.requestId);
      assert.equal((await events(replay.body.requestId)).filter(event => event.kind === 'response_generated').length, 1);
      assert.equal((await call(other, { ...input, idempotencyKey: randomUUID() })).status, 403);
      assert.equal((await call(renewed, { ...input, idempotencyKey: randomUUID(), plan: second.body.result.parameters.executedPlan })).status, 403);
    });
    await check('P2 T10 澄清也恢复原回答和选项，不伪装为已完成的数值结果', async () => {
      const clarified = await submit(renewed, '2026Q3 CBD最贵的楼是哪栋');
      assert.equal(clarified.status, 422); assert.equal(clarified.body.historySaved, true);
      const opened = await history(renewed, { action: 'open', requestId: clarified.body.requestId });
      assert.equal(opened.status, 200, JSON.stringify(opened.body));
      assert.equal(opened.body.opened.selected.reply.status, 'clarification');
      assert.equal(opened.body.opened.selected.reply.message, clarified.body.message);
      assert.deepEqual(opened.body.opened.selected.reply.options, clarified.body.options);
      assert.equal(opened.body.opened.selected.reply.result, undefined);
    });
    await check('P2 T11 搜索与加密重命名仅整理本人工作记录，归档及恢复不删除正式审计', async () => {
      const title = 'ＣＢＤ 历史净有效租金研究';
      assert.equal((await history(renewed, { action: 'rename', conversationId: conversation.id, title })).status, 200);
      const stored = (await db.query('select title_cipher from private.ai_query_history_threads where actor_id=$1 and conversation_id=$2', [owner.id, conversation.id])).rows[0];
      assert.doesNotMatch(JSON.stringify(stored), /历史净有效租金研究/);
      const found = await history(renewed, { action: 'list', search: 'cbd 历史' });
      assert.equal(found.status, 200); assert.deepEqual(found.body.page.entries.map(entry => entry.conversationId), [conversation.id]);
      assert.equal(found.body.page.entries[0].title, title);
      const originalCount = (await events(first.body.requestId)).length;
      assert.equal((await history(renewed, { action: 'archive', conversationId: conversation.id, archived: true })).status, 200);
      assert.equal((await history(renewed, { action: 'list', search: 'cbd 历史' })).body.page.entries.length, 0);
      assert.equal((await history(renewed, { action: 'list', search: 'cbd 历史', archived: true })).body.page.entries.length, 1);
      assert.equal((await history(renewed, { action: 'archive', conversationId: conversation.id, archived: false })).status, 200);
      assert.equal((await events(first.body.requestId)).length, originalCount);
    });
    await check('P2 T11/T12 历史查询、按请求定位、修改和模拟身份不能突破本人边界', async () => {
      const list = await history(other, { action: 'list', search: '历史净有效租金研究' });
      assert.equal(list.status, 200); assert.equal(list.body.page.entries.length, 0);
      const ownerInput = { action: 'open', requestId: first.body.requestId };
      for (const response of [await history(other, ownerInput), await history(other, { action: 'open', requestId: randomUUID() }),
        await history(other, { action: 'rename', conversationId: conversation.id, title: '越权标题' }),
        await history(other, { action: 'archive', conversationId: conversation.id, archived: true }),
        await history(renewed, ownerInput, { 'X-Colliers-Impersonate-User': renewed.id }),
        await history(renewed, ownerInput, { Origin: 'https://foreign.invalid' })]) {
        assert.equal(response.status, 403); assert.equal(response.body.opened, undefined); assert.equal(response.body.page, undefined);
      }
    });
    await check('P2 T12/T18 已保存历史逐次复查字段、来源和角色撤销，不通过旧快照继续交付数值', async () => {
      const input = { action: 'open', requestId: first.body.requestId };
      await grant(renewed, { fields: ['height'] });
      assert.equal((await history(renewed, input)).status, 403);
      assert.equal((await history(renewed, { action: 'list', search: 'cbd 历史' })).body.page.entries.length, 0);
      assert.equal((await history(renewed, { action: 'rename', conversationId: conversation.id, title: '撤权后标题' })).status, 403);
      await grant(renewed);
      await db.query('update public.buildings set merged_into_id=$1 where id=$2', [ids[0], ids[1]]);
      try { assert.equal((await history(renewed, input)).status, 403); }
      finally { await db.query('update public.buildings set merged_into_id=null where id=$1', [ids[1]]); }
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [owner.id]);
      for (const response of [await history(renewed, input), await history(renewed, { action: 'list' }),
        await artifact(renewed, { requestId: first.body.requestId, action: 'copy', format: 'conclusion' })]) {
        assert.equal(response.status, 403); assert.equal(response.body.opened, undefined); assert.equal(response.body.text, undefined);
      }
    });
  } finally {
    await db.query('delete from public.building_metrics where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.buildings where id=any($1::uuid[])', [ids]);
  }
}
