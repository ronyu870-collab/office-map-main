import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';

/** Real Auth -> built Next -> authorized PostgreSQL -> encrypted recovery; business data is synthetic. */
export async function verifyConversation({ db, check, person, call, recover, events, decrypt, exportCaps, fixture }) {
  const owner = await person('admin', 'p1-conversation');
  const ids = Array.from({ length: 3 }, () => randomUUID());
  const periods = [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
  const grant = async who => grantQuery({ setup: db }, who.id, { capabilities: exportCaps, allSubmarkets: false,
    submarkets: ['CBD', '金融街'], allBuildings: false, buildingIds: ids });
  const conversation = { id: randomUUID() };
  const submit = (question, parent, who = owner, id = conversation.id) => call(who, { idempotencyKey: randomUUID(), question,
    conversation: { id, ...(parent ? { parentRequestId: parent } : {}) } });
  let first, second, compared, trend, clarified;
  try {
    for (let i = 0; i < ids.length; i++) {
      await db.query("insert into public.buildings(id,name,submarket,grade) values($1,$2,$3,'A')", [ids[i], `P1合成${i + 1}楼`, i === 2 ? '金融街' : 'CBD']);
      for (let n = 0; n < periods.length; n++) {
        const p = periods[n], rent = i === 0 ? [100, 110, 180, 80][n] : i === 1 ? [100, 100, 100, null][n] : [200, 190, 180, 170][n];
        await db.query('insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft) values($1,$2,$3,10000,$4,1000,false)', [ids[i], p.year, p.quarter, rent]);
      }
    }
    await grant(owner);
    await check('P1 T01-T02：CBD→金融街→两者比较继承季度、指标、获权楼宇范围', async () => {
      first = await submit('2026年第三季度CBD的净有效租金是多少？'); assert.equal(first.status, 200);
      assert.equal(first.body.result.table.rows[0].cells.value.value.numeric, 80);
      second = await submit('金融街呢？', first.body.requestId); assert.equal(second.status, 200);
      assert.equal(second.body.result.table.rows[0].cells.value.value.numeric, 170);
      assert.deepEqual(second.body.result.parameters.executedPlan.period, periods[3]);
      compared = await submit('把这两个地区对比一下', second.body.requestId); assert.equal(compared.status, 200);
      assert.equal(compared.body.result.operation, 'group_aggregate');
      assert.deepEqual(compared.body.result.parameters.executedPlan.scope.submarkets, ['CBD', '金融街']);
      assert.equal(compared.body.result.table.rows.length, 2);
    });
    await check('P1 T03/T05/T06/T07：真实最新期、连续四季、样本差异与180→80异常', async () => {
      trend = await submit('再看看最近四个季度的变化', compared.body.requestId); assert.equal(trend.status, 200);
      const plan = trend.body.result.parameters.executedPlan;
      assert.equal(plan.operation, 'group_trend'); assert.deepEqual(plan.start, periods[0]); assert.deepEqual(plan.end, periods[3]);
      assert.deepEqual(trend.body.result.parameters.availablePeriods.periods, periods);
      const research = trend.body.result.parameters.researchAnalysis;
      assert.ok(research.series.some(series => series.anomalies.some(value => value.entityId === ids[0] && value.rule === 'entity_qoq_rent_30_percent')));
      assert.ok(research.series.some(series => series.comparability.some(value => value.exitedEntityIds.includes(ids[1]))));
      assert.match(trend.body.result.limitations.join(''), /历史.*全集/);
      const latest = await submit('CBD最新季度净有效租金'); assert.equal(latest.status, 200); assert.deepEqual(latest.body.result.parameters.executedPlan.period, periods[3]);
    });
    await check('P1 T04/T08：最贵澄清可以短回复，多维缺口不被静默丢弃', async () => {
      clarified = await submit('2026Q3 CBD最贵的楼是哪栋'); assert.equal(clarified.status, 422);
      assert.equal(clarified.body.reason, 'metric_required'); assert.ok(clarified.body.options.some(option => option.id === 'net_effective_rent'));
      const ranked = await submit('净有效租金', clarified.body.requestId); assert.equal(ranked.status, 200); assert.equal(ranked.body.result.operation, 'rank');
      const unsupported = await submit('2026Q3比较CBD和金融街不同楼龄的租金和空置率');
      assert.equal(unsupported.status, 422); assert.match(unsupported.body.message, /楼龄|建成年份/); assert.equal(unsupported.body.result, undefined);
      const cross = await submit('2026Q3 CBD、金融街净有效租金按子市场和等级交叉统计'); assert.equal(cross.status, 200); assert.equal(cross.body.result.operation, 'cross_aggregate');
    });
    await check('P1 T09/T10：实际执行条件、原记录、生成快照和空季度可复核', async () => {
      const source = first.body.result.sources.find(value => value.entityId === ids[0] && value.field === 'net_effective_rent'); assert.ok(source);
      const raw = await db.query('select net_effective_rent::text value from public.building_metrics where id=$1', [source.recordId]); assert.equal(Number(raw.rows[0].value), 80);
      assert.deepEqual((await recover(owner, first.body.requestId)).body.result, first.body.result);
      const stored = (await events(first.body.requestId)).map(decrypt).map(value => value.content);
      assert.equal(stored[0].plan.resolution, 'server_semantic/1');
      assert.ok(stored.some(value => value.plan?.metric === 'rent' && value.resolution?.semanticContext));
      const missing = await submit('2020Q1 CBD净有效租金'); assert.equal(missing.status, 200);
      assert.equal(missing.body.result.table.rows[0].cells.value.kind, 'unknown'); assert.equal(missing.body.result.analysis.value, null);
    });
    await check('P1 T11：其他账号、其他conversation、其他真实登录session拒绝继承', async () => {
      const other = await person('admin', 'p1-other'); await grant(other);
      assert.equal((await submit('金融街呢', first.body.requestId, other)).status, 403);
      assert.equal((await submit('金融街呢', first.body.requestId, owner, randomUUID())).status, 403);
      const signed = await owner.client.auth.signInWithPassword({ email: owner.email, password: owner.password }); assert.equal(signed.error, null);
      const newSession = { ...owner, token: signed.data.session.access_token };
      assert.notEqual(JSON.parse(Buffer.from(newSession.token.split('.')[1], 'base64url')).session_id, owner.sessionId);
      assert.equal((await submit('金融街呢', first.body.requestId, newSession)).status, 403);
      assert.equal((await recover(newSession, first.body.requestId)).status, 403);
      assert.equal((await call(owner, { idempotencyKey: randomUUID(), question: '金融街呢', conversation: { id: conversation.id, parentRequestId: first.body.requestId } }, { 'X-Colliers-Impersonate-User': owner.id })).status, 403);
    });
    await check('P1 T13/T14：原请求重试只执行一次，建议保留已审计的条件与父节点', async () => {
      const body = { idempotencyKey: randomUUID(), question: '2026Q3 CBD净有效租金', conversation: { id: randomUUID() } };
      const a = await call(owner, body), b = await call(owner, body); assert.equal(a.status, 200); assert.equal(b.status, 202); assert.equal(a.body.requestId, b.body.requestId);
      const ledger = (await events(a.body.requestId)).map(decrypt).map(value => value.content); assert.equal(ledger.filter(value => value.result?.resultId).length, 1);
      const action = a.body.result.parameters.suggestions.find(value => value.id === 'same_period_vacancy'); assert.ok(action);
      const next = await submit(action.question, a.body.requestId, owner, body.conversation.id); assert.equal(next.status, 200);
      assert.equal(next.body.result.parameters.executedPlan.metric, 'vacancy'); assert.deepEqual(next.body.result.parameters.executedPlan.period, periods[3]);
      const clarifyBody = { idempotencyKey: randomUUID(), question: '2026Q3CBD最贵的楼', conversation: { id: randomUUID() } };
      const c = await call(owner, clarifyBody), d = await call(owner, clarifyBody); assert.equal(c.status, 422); assert.equal(d.status, 422); assert.deepEqual(c.body.options, d.body.options);
    });
    await check('P1 T15：真实HTTP模型候选经校验，非法计划不进入数据执行', async () => {
      const modelUser = await person('admin', 'p1-model'); await grant(modelUser);
      const candidate = { version: 'colliers-semantic-intent/1', operation: 'aggregate', submarkets: ['CBD'], metric: 'rent', time: { kind: 'explicit', periods: [periods[3]] }, unresolvedConditions: [] };
      fixture.semanticReply(candidate); const before = fixture.semanticCalls();
      const body = { idempotencyKey: randomUUID(), question: '2026Q3 CBD净有效租金行情能给个统计吗', conversation: { id: randomUUID() } };
      const good = await call(modelUser, body); assert.equal(good.status, 200); assert.equal(fixture.semanticCalls(), before + 1);
      assert.equal(good.body.result.parameters.interpretation.method, 'validated_model_intent');
      assert.equal((await call(modelUser, body)).status, 202); assert.equal(fixture.semanticCalls(), before + 1);
      const outbound = JSON.parse(fixture.semanticInputs().at(-1).messages[1].content); assert.deepEqual(Object.keys(outbound).sort(), ['allowedSubmarkets', 'context', 'question']);
      fixture.semanticReply({ ...candidate, sql: 'select * from auth.users' });
      const bad = await call(modelUser, { ...body, idempotencyKey: randomUUID() }); assert.equal(bad.status, 422); assert.equal(bad.body.result, undefined);
      assert.ok(!(await events(bad.body.requestId)).some(event => event.kind === 'response_generated'));
    });
    await check('P1 撤权：已形成对话仍逐次复查，不返回旧条件或数值', async () => {
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [owner.id]);
      const denied = await submit('金融街呢', first.body.requestId); assert.equal(denied.status, 403); assert.equal(denied.body.result, undefined);
      assert.equal((await recover(owner, first.body.requestId)).status, 403);
    });
  } finally {
    await db.query('delete from public.building_metrics where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.buildings where id=any($1::uuid[])', [ids]);
  }
}
