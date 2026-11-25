// Only supplier responses are synthetic. Login, authority, snapshots, encrypted
// archives, recovery and built HTTP artifact downloads use the disposable stack.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { loadAgentHandler } from './ai5-export-scenarios.mjs';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';

export async function verifyAi6Runtime({ db, service, keys, output, check, person, artifact, recover, events, decrypt, exportCaps }) {
  const handle = await loadAgentHandler(output);
  const originalFetch = globalThis.fetch, previous = new Map();
  const env = values => { for (const [key, value] of Object.entries(values)) { previous.set(key, process.env[key]); process.env[key] = value; } };
  env({ DEEPSEEK_API_KEY: 'synthetic-ai6-only', DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_CHAT_MODEL: 'deepseek-flash', DEEPSEEK_API_BASE_URL: 'https://api.deepseek.com',
    AI_PROVIDER_QUICK: 'deepseek', AI_PROVIDER_PROFESSIONAL: 'deepseek', AI_MODEL_FALLBACK_ENABLED: 'false', AI_AGENT_MAX_TOKENS: '60000', AI_AGENT_MAX_ESTIMATED_USD: '.25' });
  const ids = Array.from({ length: 5 }, () => randomUUID());
  let mode = 'forbid', calls = 0, controller;
  const queryPlan = { operation: 'group_aggregate', metric: 'rent', groupBy: 'submarket', scope: { inventory: 'all_authorized' }, period: { year: 2026, quarter: 2 } };
  globalThis.fetch = async (url, init) => {
    if (new URL(String(url)).hostname !== 'api.deepseek.com') return originalFetch(url, init);
    calls++;
    assert.notEqual(mode, 'forbid', 'deterministic task contacted a supplier');
    const body = JSON.parse(init.body);
    if (body.messages.some(m => m.role === 'tool')) {
      if (mode === 'cancel') { controller.abort(); init.signal.throwIfAborted(); }
      return Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 });
    }
    return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
      tool_calls: [{ id: randomUUID(), type: 'function', function: { name: 'execute_query_plan', arguments: JSON.stringify({ plan: queryPlan }) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 30 } });
  };
  async function submit(who, question, extra = {}) {
    calls = 0; controller = new AbortController();
    const response = await handle(new Request('http://127.0.0.1/api/intelligence/query/agent', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token }, signal: controller.signal,
      body: JSON.stringify({ idempotencyKey: randomUUID(), question, conversation: { id: randomUUID() }, ...extra }) }), { client: service, keys, enabled: true });
    return { status: response.status, body: await response.json(), calls };
  }
  const grant = (who, caps = exportCaps) => grantQuery({ setup: db }, who.id, { capabilities: caps,
    fields: ['height', 'netEffectiveRent', 'totalArea', 'vacantArea'], allBuildings: false, buildingIds: ids.slice(0, 4) });
  let owner, other, grouped;
  try {
    for (let i = 0; i < ids.length; i++) {
      await db.query('insert into public.buildings(id,name,submarket,grade,tracking_scope) values($1,$2,$3,$4,$5)',
        [ids[i], `合成AI6-${i + 1}`, i === 2 ? '金融街' : 'CBD', i === 1 ? 'B' : 'A', i === 2 ? 'reference_only' : 'tracked']);
      await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft,is_locked,locked_at,locked_by)
        values($1,2026,2,10000,$2,$3,false,true,now(),$1)`, [ids[i], [80, 120, 200, null, 999][i], [0, 1000, 2000, null, 0][i]]);
    }
    owner = await person('admin', 'ai6-owner'); other = await person('admin', 'ai6-other'); await grant(owner); await grant(other);
    await check('AI6 / 全部获权按子市场保留非跟踪楼宇、缺失与正式加权口径，零模型调用', async () => {
      grouped = await submit(owner, '2026Q2全部获权楼宇净有效租金按子市场比较');
      assert.equal(grouped.status, 200, JSON.stringify(grouped.body)); assert.equal(grouped.calls, 0);
      assert.equal(grouped.body.agent.modelCalls, 0); assert.equal(grouped.body.agent.executionRoute, 'deterministic_query');
      assert.equal(grouped.body.result.parameters.executedPlan.scope.inventory, 'all_authorized');
      const encoded = JSON.stringify(grouped.body.result);
      assert.ok(encoded.includes(ids[2]), 'non-tracked authorized source was dropped');
      assert.ok(!encoded.includes(ids[4]), 'ungranted source escaped');
      assert.deepEqual((await recover(owner, grouped.body.requestId)).body.result, grouped.body.result);
      assert.equal((await recover(other, grouped.body.requestId)).status, 403);
    });
    await check('AI6 / 已重新鉴权的上一轮快照直接生成CSV与图表，不重新查数或调用供应商', async () => {
      const conversation = { id: grouped.body.conversation.id, parentRequestId: grouped.body.requestId };
      const sorted = await submit(owner, '按净有效租金从高到低排列', { conversation });
      assert.equal(sorted.status, 200, JSON.stringify(sorted.body)); assert.equal(sorted.calls, 0);
      assert.equal(sorted.body.result.parameters.agentTableView.sort.direction, 'desc');
      const exported = await submit(owner, '把刚才的结果导出CSV', { conversation });
      assert.equal(exported.status, 200, JSON.stringify(exported.body)); assert.equal(exported.calls, 0);
      assert.ok(exported.body.result.parameters.agentExport); assert.equal(exported.body.agent.toolCalls, 2);
      const chart = await submit(owner, '把刚才的结果画成图', { conversation });
      assert.equal(chart.status, 200, JSON.stringify(chart.body)); assert.equal(chart.calls, 0);
      assert.ok(chart.body.result.parameters.agentChart); assert.equal(chart.body.agent.toolCalls, 2);
      for (const [label, format, extension] of [['PNG', 'png_zip', '.png'], ['SVG', 'svg_zip', '.svg']]) {
        const image = await submit(owner, '导出' + label, { conversation: { id: chart.body.conversation.id, parentRequestId: chart.body.requestId } });
        assert.equal(image.status, 200, JSON.stringify(image.body)); assert.equal(image.calls, 0);
        assert.equal(image.body.agent.executionStatus, 'completed');
        const downloaded = await artifact(owner, { requestId: image.body.requestId, resultId: image.body.result.resultId, action: 'export', format });
        assert.equal(downloaded.status, 200);
        const zip = await JSZip.loadAsync(downloaded.bytes);
        const file = Object.values(zip.files).find(f => f.name.endsWith(extension)); assert.ok(file);
        if (label === 'PNG') assert.deepEqual([...(await file.async('uint8array')).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        else assert.match(await file.async('string'), /<svg/);
      }
    });
    await check('AI6 / 历史CBD Top10故障生成真实可读Excel，零模型调用且下载检查独立资格', async () => {
      const reply = await submit(owner, '把CBD在2026Q2净有效租金最高的10栋楼导出Excel');
      assert.equal(reply.status, 200, JSON.stringify(reply.body)); assert.equal(reply.calls, 0);
      assert.equal(reply.body.agent.executionStatus, 'completed');
      const request = { requestId: reply.body.requestId, resultId: reply.body.result.resultId, action: 'export', format: 'xlsx' };
      const file = await artifact(owner, request); assert.equal(file.status, 200);
      const book = XLSX.read(file.bytes, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 });
      assert.equal(rows.length, 3); assert.ok(rows[1].includes('合成AI6-2')); assert.ok(rows[1].includes(120));
      assert.ok(rows[2].includes('合成AI6-1')); assert.ok(rows[2].includes(80));
      assert.equal((await artifact(other, request)).status, 403);
      await grant(owner, ['query:catalog', 'query:brochure', 'query:quarter']);
      assert.equal((await artifact(owner, request)).status, 403); await grant(owner);
    });
    await check('AI6 / 供应商总结失败仍交付正式结果并可从加密历史恢复', async () => {
      mode = 'fail'; const reply = await submit(owner, '复合核对全部获权楼宇的季度市场资料');
      assert.equal(reply.status, 200, JSON.stringify(reply.body)); assert.equal(reply.body.agent.executionStatus, 'partial');
      assert.ok(reply.body.result); assert.equal(reply.calls, 2);
      assert.deepEqual((await recover(owner, reply.body.requestId)).body.result, reply.body.result);
      const recorded = (await events(reply.body.requestId)).filter(e => e.kind === 'accounting').map(decrypt).map(e => e.content);
      assert.equal(recorded.filter(c => c.protocol === 'agent-model-attempt/1').length, 2);
    });
    await check('AI6 / 请求中断后保留普通正式结果检查点，撤权仍拒绝恢复', async () => {
      mode = 'cancel'; const reply = await submit(owner, '复合核对全部获权楼宇的季度市场资料');
      assert.equal(reply.status, 409, JSON.stringify(reply.body));
      assert.match(reply.body.error, /历史恢复/);
      assert.equal((await recover(owner, reply.body.requestId)).status, 200);
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [owner.id]);
      assert.equal((await recover(owner, reply.body.requestId)).status, 403);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
