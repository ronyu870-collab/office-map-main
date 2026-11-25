// Only planning/synthesis is scripted. Actual HTTP, GoTrue, grants, deterministic
// queries, files, encrypted history and download reauthorization stay real.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { grantBusiness } from '../../supabase/tests/ai-business-research/fixture.mjs';
import { loadAgentHandler } from './ai5-export-scenarios.mjs';

export async function verifyAi5FinalHardening({ db, service, keys, output, check, person, artifact, recover, events, decrypt, exportCaps, buildingIds }) {
  const handle = await loadAgentHandler(output);
  const call = (name, args) => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const completion = calls => ({ model: 'deepseek-flash', inputTokens: 20, outputTokens: 20, message: { role: 'assistant',
    content: calls ? null : '合成模型：文件已经保存到桌面 https://fake.invalid/file', ...(calls ? { tool_calls: calls } : {}) } });
  let planner, modelCalls;
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await handle(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) }), {
        client: service, keys, enabled: true, invokeModel: async messages => planner(messages, modelCalls++) });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end('Isolated final-hardening fixture failed'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  const scope = { inventory: 'all_authorized', submarkets: ['CBD'], buildingIds }, period = { year: 2026, quarter: 2 };
  const rank = { scope, period, field: 'netEffectiveRent', direction: 'desc', limit: 10 };
  const list = { scope, period, fields: ['netEffectiveRent', 'totalArea', 'vacantArea'] };
  const prior = messages => messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
  const text = content => ({ ...completion(), message: { role: 'assistant', content } });
  async function actor(label) {
    const who = await person('admin', 'ai5-final-' + label);
    await grantQuery({ setup: db }, who.id, { capabilities: exportCaps, fields: ['height', 'netEffectiveRent', 'totalArea', 'vacantArea'], allBuildings: false, buildingIds });
    return who;
  }
  async function submit(who, question, plan, parent, idempotencyKey = randomUUID()) {
    // Query, recovery and artifact receipts share the existing account limit.
    // Pace the fixture against its real window; do not raise limits, rotate
    // actors, rewrite receipts or retry a rejected request.
    const window = await db.query(`select extract(epoch from (min(received_at)+interval '61 seconds'-clock_timestamp()))*1000 wait_ms,
      count(*) n from private.ai_query_audit_streams where actor_id=$1 and received_at>clock_timestamp()-interval '1 minute'`, [who.id]);
    if (Number(window.rows[0].n) >= 12) {
      console.log('WAIT final-hardening fixture: existing 12/minute account window');
      let remaining = Math.max(0, Math.ceil(Number(window.rows[0].wait_ms)));
      while (remaining > 0) { const chunk = Math.min(remaining, 60000); await delay(chunk); remaining -= chunk; }
    }
    planner = plan; modelCalls = 0;
    const conversation = parent ? { ...parent.body.conversation, parentRequestId: parent.body.requestId } : { id: randomUUID() };
    const input = { idempotencyKey, question, conversation };
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json(), input };
  }
  async function file(who, response, format) {
    const downloaded = await artifact(who, { requestId: response.body.requestId, resultId: response.body.result.resultId, action: 'export', format,
      ...(['png_zip', 'svg_zip'].includes(format) ? { chart: response.body.result.parameters.agentChart.request } : {}) });
    assert.equal(downloaded.status, 200, JSON.stringify(downloaded.body));
    assert.equal(downloaded.headers.get('x-artifact-sha256'), createHash('sha256').update(downloaded.bytes).digest('hex'));
    return downloaded;
  }
  try {
    const basic = await actor('basic');
    for (const question of ['你好。', '你会做什么？', '你的数据来自哪里？']) await check('AI5收口 / A 基础交互路由：' + question, async () => {
      const response = await submit(basic, question, () => text('你好。可以使用已获权的正式楼宇、季度数据和来源；未执行查询不声明已有结果。'));
      assert.equal(response.status, 200); assert.equal(response.body.agent.toolCalls, 0); assert.equal(response.body.result, undefined);
    });
    await check('AI5收口 / A4 数据权限通过真实能力工具而非模型声明', async () => {
      const response = await submit(basic, '你的数据权限是什么？', (messages, step) => {
        if (!step) return completion([call('get_data_capabilities', {})]);
        const observation = prior(messages).at(-1);
        assert.equal(observation.status, 'ready');
        assert.equal(observation.authority.internalExport, true);
        assert.ok(observation.authority.fields.some(f => f.id === 'netEffectiveRent'));
        return text('权限以本次工具授权快照为准。');
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.agent.executionStatus, 'completed');
      assert.ok((await events(response.body.requestId)).filter(e => e.kind === 'accounting').map(decrypt)
        .some(e => e.content.toolNames?.includes('get_data_capabilities')));
    });
    await check('AI5收口 / A5 错别字或模糊租金口径必须澄清而非编造', async () => {
      const response = await submit(basic, 'CBD 租今最高的楼有哪些？', (_, step) => step ? text('请确认是净有效租金、报价还是成交租金。') : completion([call('query_verified_real_estate', { question: 'CBD 租今最高的楼有哪些？' })]));
      assert.equal(response.status, 200); assert.equal(response.body.result, undefined); assert.equal(response.body.agent.executionStatus, 'limited');
    });
    const who = await actor('chain'); let current;
    await check('AI评测 / 单季度报告走真实授权快照与正式聚合而非非法趋势', async () => {
      const response = await submit(who, '查询最近一个已结束季度的净有效租金，用于内部报告。',
        (_, step) => step ? text('正式统计与来源见结果。') : completion([call('query_report_market', { scope, metric: 'rent', recentCompletedQuarters: 1 })]));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.agent.executionStatus, 'completed');
      assert.equal(response.body.result.operation, 'aggregate');
      assert.equal(response.body.result.parameters.period.quarter >= 1, true);
      assert.equal(response.body.result.parameters.reportPeriodRule, 'completed-shanghai-calendar-quarters/1');
      assert.deepEqual((await recover(who, response.body.requestId)).body.result, response.body.result);
    });
    for (const [id, question, tool, args] of [
      ['B6', '把 CBD 所有楼列出来。', 'list_buildings', { scope, fields: [], period: null }],
      ['B7', 'CBD 最高的五栋楼。', 'rank_buildings', { scope, field: 'height', direction: 'desc', limit: 5 }],
      ['B9', '换成 2026Q2 的净有效租金。', 'rank_buildings', rank],
    ]) await check('AI5收口 / ' + id + ' 多轮获权查询：' + question, async () => {
      const parent = current;
      current = await submit(who, question, (messages, step) => {
        if (parent) assert.ok(messages.some(m => m.role === 'system' && m.content.includes('上一轮查询条件')));
        return step ? text('完整正式结果与来源见本条回答。') : completion([call(tool, args)]);
      }, parent);
      assert.equal(current.status, 200, JSON.stringify(current.body)); assert.ok(current.body.result.table.rows.length > 0);
      const executedScope = current.body.result.parameters.executedPlan.scope;
      assert.deepEqual(executedScope.submarkets, ['CBD']);
      if (id === 'B6') assert.equal(executedScope.inventory, 'all_authorized');
      // Model-scripted buildingIds are not user conditions. The fast path
      // preserves the user's logical scope; the real grant filters records.
      assert.ok(current.body.result.table.rows.every(row => buildingIds.includes(row.entityId)));
      if (id === 'B9') assert.deepEqual(current.body.result.parameters.executedPlan.period, period);
      assert.deepEqual((await recover(who, current.body.requestId)).body.result, current.body.result);
    });
    await check('AI5收口 / B8 未指定租金口径的排名先澄清', async () => {
      const response = await submit(basic, 'CBD 租金最高的十栋楼。', (_, step) => step ? text('请先明确租金口径。') : completion([call('query_verified_real_estate', { question: 'CBD 租金最高的十栋楼。' })]));
      assert.equal(response.status, 200); assert.equal(response.body.result, undefined); assert.equal(response.body.agent.executionStatus, 'limited');
    });
    await check('AI5收口 / B10 建筑面积与等级使用独立楼宇资料口径，不替代季度面积', async () => {
      const profileActor = await actor('profile'); await grantBusiness(db, profileActor.id, { fields: ['grade', 'gfaTotal'], allBuildings: false, buildingIds });
      const selected = current.body.result.table.rows.map(r => r.entityId);
      const response = await submit(profileActor, '再加上建筑面积和楼宇等级。', (_, step) => step ? text('楼书建筑面积与目录等级见资料结果；未与季度面积混用。') : completion([call('query_building_dossier', { buildingIds: selected, fields: ['gfaTotal', 'grade'] })]));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.result.table.rows.map(r => r.entityId).sort(), [...selected].sort());
      assert.ok(response.body.result.table.columns.some(c => c.key === 'gfaTotal')); assert.ok(response.body.result.table.columns.some(c => c.key === 'grade'));
      assert.ok(response.body.result.sources.every(s => s.field !== 'total_area'));
    });
    await check('AI5收口 / D15 上轮范围与期间重新鉴权生成Excel，逐单元格回读且重复提交不重调模型', async () => {
      current = await submit(who, '把刚才的结果导出 Excel。', (messages, step) => step === 0 ? completion([call('rank_buildings', rank)])
        : step === 1 ? completion([call('export_table', { resultIds: [prior(messages)[0].resultId], format: 'xlsx' })]) : completion(), current);
      assert.equal(current.status, 200, JSON.stringify(current.body));
      const book = XLSX.read((await file(who, current, 'xlsx')).bytes, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 });
      current.body.result.table.rows.forEach((row, i) => { assert.equal(rows[i + 1][0], row.cells.name.value); assert.equal(rows[i + 1][1], row.cells.netEffectiveRent.value.numeric); });
      const before = modelCalls;
      const replay = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token }, body: JSON.stringify(current.input) });
      assert.equal(replay.status, 202); assert.equal(modelCalls, before); assert.equal((await replay.json()).requestId, current.body.requestId);
    });
    await check('AI5收口 / D16 生成PNG必须真实文件，中文图表、尺寸及来源回读', async () => {
      const chart = { kind: 'plot', type: 'bar', x: 'name', y: ['netEffectiveRent'] };
      current = await submit(who, '生成一张租金排名 PNG 柱状图。', (messages, step) => step === 0 ? completion([call('rank_buildings', rank)]) : step === 1
        ? completion([call('create_chart', { resultId: prior(messages)[0].resultId, chart })]) : step === 2 ? completion([call('export_chart', { format: 'png_zip' })]) : completion(), current);
      assert.equal(current.status, 200, JSON.stringify(current.body)); assert.equal(current.body.agent.executionStatus, 'completed');
      const zip = await JSZip.loadAsync((await file(who, current, 'png_zip')).bytes);
      const png = await zip.file('chart.png').async('nodebuffer'); assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.ok(png.readUInt32BE(16) >= 1600); assert.ok(png.readUInt32BE(20) >= 800);
      const manifest = JSON.parse(await zip.file('manifest.json').async('string')); assert.equal(manifest.resultId, current.body.result.resultId);
    });
    await check('AI5收口 / D17 坐标缺字段时合法新查，同源散点图保留原数值', async () => {
      const chart = { kind: 'plot', type: 'scatter', x: 'netEffectiveRent', y: ['vacancy'] };
      current = await submit(who, '净有效租金为横轴，空置率为纵轴。', (messages, step) => step === 0 ? completion([call('list_buildings', list)])
        : step === 1 ? completion([call('modify_chart', { resultId: prior(messages)[0].resultId, chart })]) : text('同源散点图见本条回答。'), current);
      assert.equal(current.status, 200, JSON.stringify(current.body)); assert.deepEqual(current.body.result.parameters.agentChart.request, chart);
      assert.deepEqual(current.body.result.parameters.executedPlan.period, period);
      assert.ok(current.body.result.table.columns.some(c => c.key === 'vacancy'));
    });
    await check('AI5收口 / D18 同一对话生成中文PDF，表格精确值、来源、分页及历史恢复一致', async () => {
      current = await submit(who, '把这些结果生成 PDF 研究报告。', (messages, step) => step === 0 ? completion([call('list_buildings', list)])
        : step === 1 ? completion([call('generate_pdf_report', { resultIds: [prior(messages)[0].resultId] })]) : completion(), current);
      assert.equal(current.status, 200, JSON.stringify(current.body)); const downloaded = await file(who, current, 'pdf');
      const task = getDocument({ data: new Uint8Array(downloaded.bytes), useSystemFonts: false, useWorkerFetch: false }); const pdf = await task.promise;
      try { assert.ok(pdf.numPages >= 2); const manifest = JSON.parse(new TextDecoder().decode(await pdf.getAttachmentContent('manifest.json')));
        assert.deepEqual(manifest.sections[0].table, current.body.result.parameters.agentReport.sections[0].result.table);
        assert.ok((await (await pdf.getPage(1)).getTextContent()).items.map(i => i.str ?? '').join('').includes('研究报告'));
      } finally { await task.destroy(); }
      assert.deepEqual((await recover(who, current.body.requestId)).body.result, current.body.result);
      const other = await actor('other'); assert.equal((await recover(other, current.body.requestId)).status, 403);
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [who.id]);
      assert.equal((await recover(who, current.body.requestId)).status, 403);
      assert.equal((await artifact(who, { requestId: current.body.requestId, resultId: current.body.result.resultId, action: 'export', format: 'pdf' })).status, 403);
    });
    await check('AI5收口 / 缺少真实成果时拒绝模型虚构链接，回答、成本及历史审计状态一致', async () => {
      for (const format of ['PNG', 'Excel', 'CSV', 'SVG']) {
        const response = await submit(basic, '把刚才的结果生成 ' + format + ' 文件。', () => completion());
        assert.equal(response.status, 200); assert.equal(response.body.agent.executionStatus, 'limited'); assert.equal(response.body.result, undefined);
        assert.ok(!/fake.invalid|已保存|已生成/.test(response.body.message));
        const stored = (await events(response.body.requestId)).filter(e => e.kind === 'accounting').map(decrypt).map(e => e.content);
        assert.equal(stored.find(e => e.provider === 'server_policy').status, 'limited');
      }
    });
    await check('AI5收口 / 请求CSV却只生成Excel时仅标部分完成，真实Excel仍可下载回读', async () => {
      const response = await submit(basic, '把刚才的结果导出 CSV。', (messages, step) => step === 0 ? completion([call('rank_buildings', rank)])
        : step === 1 ? completion([call('export_table', { resultIds: [prior(messages)[0].resultId], format: 'xlsx' })]) : completion());
      assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(response.body.agent.executionStatus, 'partial');
      assert.ok(response.body.message.includes('未生成 CSV')); assert.ok(!response.body.message.includes('fake.invalid'));
      const book = XLSX.read((await file(basic, response, 'xlsx')).bytes, { type: 'array' });
      assert.equal(XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 }).length, response.body.result.table.rows.length + 1);
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
