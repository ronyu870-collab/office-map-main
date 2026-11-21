// Only model planning is scripted. Auth, query, immutable source recovery,
// audit, native PNG generation and production artifact HTTP remain real.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import JSZip from 'jszip';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { loadAgentHandler } from './ai5-export-scenarios.mjs';

export async function verifyAi5Charts({ db, service, keys, output, check, person, artifact, recover, events, decrypt, exportCaps, buildingIds }) {
  const handleAgentSubmission = await loadAgentHandler(output);
  const call = (name, args) => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const completion = tool_calls => ({ model: 'deepseek-flash', inputTokens: 20, outputTokens: 20,
    message: { role: 'assistant', content: tool_calls ? null : 'PNG 已保存到桌面 https://fake.invalid/chart.png', ...(tool_calls ? { tool_calls } : {}) } });
  let scenario, round;
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await handleAgentSubmission(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) }), {
        client: service, keys, enabled: true, invokeModel: async messages => {
          const step = round++;
          if (scenario.modify) {
            if (step === 0) return completion([call('modify_chart', { chart: scenario.chart })]);
            if (step === 1) return completion([call('export_chart', { format: 'png_zip' })]);
          } else {
            if (step === 0) return completion([call(scenario.tool, scenario.args)]);
            const prior = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
            if (step === 1) {
              if (prior[0].status !== 'ready') return completion();
              return completion([call('create_chart', { resultId: prior[0].resultId, chart: scenario.chart })]);
            }
            if (step === 2 && prior.at(-1).status === 'ready') return completion([call('export_chart', { format: 'png_zip' })]);
          }
          await scenario.after?.();
          return completion();
        },
      });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  async function submit(actor, question, spec, conversation = { id: randomUUID() }) {
    scenario = spec; round = 0;
    const response = await fetch(endpoint + '/api/intelligence/query/agent', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + actor.token },
      body: JSON.stringify({ idempotencyKey: randomUUID(), question, conversation }) });
    return { status: response.status, body: await response.json() };
  }
  async function actor(label, fields = ['height', 'netEffectiveRent', 'totalArea', 'vacantArea']) {
    const who = await person('admin', 'ai5-chart-' + label);
    await grantQuery({ setup: db }, who.id, { capabilities: exportCaps, fields, allBuildings: false, buildingIds });
    return who;
  }
  const scope = { inventory: 'all_authorized', submarkets: ['CBD'], buildingIds }, period = { year: 2026, quarter: 3 };
  const cases = [
    ['CBD 楼宇租金 Top 10 横向柱状图并导出 PNG。', 'rank_buildings', { scope, period, field: 'netEffectiveRent', direction: 'desc', limit: 10 },
      { kind: 'plot', type: 'horizontal_bar', x: 'name', y: ['netEffectiveRent'] }],
    ['CBD 近四季度租金趋势折线图并导出 PNG（2026Q1至Q4逐期样本）。', 'analyze_market_trends', { scope, start: { year: 2026, quarter: 1 }, end: { year: 2026, quarter: 4 }, metric: 'rent', mode: 'per_period' },
      { kind: 'plot', type: 'line', x: 'period', y: ['value'] }],
    ['CBD 与金融街空置率对比并导出 PNG。', 'compare_market_segments', { submarkets: ['CBD', '金融街'], period, metric: 'vacancy', inventory: 'all_authorized' },
      { kind: 'plot', type: 'bar', x: 'name', y: ['value'] }],
    ['净有效租金为 X 轴、空置率为 Y 轴的散点图并导出 PNG。', 'analyze_rent_vacancy', { scope, period },
      { kind: 'plot', type: 'scatter', x: 'rent', y: ['vacancy'] }],
  ];
  const before = (await db.query('select id,submarket from public.buildings where id=any($1::uuid[])', [buildingIds])).rows;
  let first, owner;
  try {
    let i = 0;
    for (const [question, tool, args, chart] of cases) await check('AI5 图表 / 真实Auth、PNG/SVG回读：' + question, async () => {
      const who = await actor('case-' + (++i));
      if (tool === 'compare_market_segments') await db.query("update public.buildings set submarket='金融街' where id=$1", [buildingIds[1]]);
      let source;
      try { source = await submit(who, question, { tool, args, chart }); }
      finally { if (tool === 'compare_market_segments') for (const row of before) await db.query('update public.buildings set submarket=$2 where id=$1', [row.id, row.submarket]); }
      assert.equal(source.status, 200, JSON.stringify(source.body)); assert.equal(source.body.agent.executionStatus, 'completed');
      assert.deepEqual(source.body.result.parameters.agentChart.request, chart);
      assert.ok(!source.body.message.includes('fake.invalid')); assert.ok(!source.body.message.includes('已保存到桌面'));
      const result = source.body.result, common = { requestId: source.body.requestId, resultId: result.resultId };
      // Dimension changes are source revocations. Restore the comparison's
      // original dimension while downloading it, then always restore fixtures.
      if (tool === 'compare_market_segments') await db.query("update public.buildings set submarket='金融街' where id=$1", [buildingIds[1]]);
      try {
        for (const format of ['png_zip', 'svg_zip']) {
          const file = await artifact(who, { ...common, action: 'export', format, chart });
          assert.equal(file.status, 200, JSON.stringify(file.body));
          assert.equal(file.headers.get('x-artifact-sha256'), createHash('sha256').update(file.bytes).digest('hex'));
          const zip = await JSZip.loadAsync(file.bytes), manifest = JSON.parse(await zip.file('manifest.json').async('string'));
          assert.deepEqual(manifest.sources, result.sources);
          assert.deepEqual(manifest.chart.request, chart);
          assert.equal(manifest.resultId, result.resultId);
          if (format === 'png_zip') {
            const png = await zip.file('chart.png').async('nodebuffer');
            assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
            assert.ok(png.readUInt32BE(16) >= 2200); assert.ok(png.readUInt32BE(20) >= 1280);
            assert.equal(png.readUInt32BE(16), manifest.image.width); assert.equal(png.readUInt32BE(20), manifest.image.height);
            assert.equal(manifest.image.font, 'Noto Sans SC');
          } else {
            const svg = await zip.file('chart.svg').async('string');
            assert.ok(svg.startsWith('<svg')); assert.ok(svg.includes('<metadata>')); assert.ok(svg.includes('未知'));
          }
          if (tool === 'analyze_market_trends') assert.equal(manifest.chart.points.length, 4);
          if (tool === 'analyze_rent_vacancy') {
            assert.ok(manifest.chart.points.some(p => p.state === 'unknown'));
            assert.equal(manifest.chart.yUnit, 'ratio');
          }
        }
        assert.deepEqual((await recover(who, source.body.requestId)).body.result, result);
        const stored = await events(source.body.requestId), answer = stored.findLast(e => e.kind === 'tool_finished');
        assert.equal(decrypt(answer).content.chartFile.state, 'server_generated');
      } finally { if (tool === 'compare_market_segments') for (const row of before) await db.query('update public.buildings set submarket=$2 where id=$1', [row.id, row.submarket]); }
      if (!first) { first = source; owner = who; }
    });
    await check('AI5 对话修改坐标与排序复用原快照、数据和来源', async () => {
      const chart = { ...first.body.result.parameters.agentChart.request, type: 'bar', yAxis: { min: 0, max: 1000, ticks: 6 }, sort: { field: 'netEffectiveRent', direction: 'asc' } };
      const modified = await submit(owner, '改成柱状图，按租金升序，数值轴0至1000。', { modify: true, chart }, { id: first.body.conversation.id, parentRequestId: first.body.requestId });
      assert.equal(modified.status, 200, JSON.stringify(modified.body));
      assert.equal(modified.body.result.resultId, first.body.result.resultId);
      for (const key of ['table', 'analysis', 'sources', 'dataVersion', 'snapshotId', 'createdAt']) assert.deepEqual(modified.body.result[key], first.body.result[key]);
      assert.deepEqual(modified.body.result.parameters.agentChart.request, chart);
    });
    await check('AI5 绘图和PNG导出不能获取未获权字段，且隔离跨用户与撤权', async () => {
      const who = await actor('limited', ['height']), other = await actor('other');
      const failed = await submit(who, '净有效租金图表并导出PNG', { tool: 'rank_buildings', args: cases[0][2], chart: cases[0][3] });
      assert.equal(failed.body.result, undefined);
      const common = { requestId: first.body.requestId, resultId: first.body.result.resultId, action: 'export', format: 'png_zip', chart: cases[0][3] };
      assert.equal((await artifact(other, common)).status, 403);
      await grantQuery({ setup: db }, owner.id, { capabilities: ['query:catalog', 'query:brochure', 'query:quarter'] });
      assert.equal((await artifact(owner, common)).status, 403);
      await grantQuery({ setup: db }, owner.id, { capabilities: exportCaps });
    });
    await check('AI5 已生成PNG在来源撤回后拒绝下载和跨轮修改', async () => {
      const who = await actor('source');
      const source = await submit(who, cases[0][0], { tool: cases[0][1], args: cases[0][2], chart: cases[0][3] });
      assert.equal(source.status, 200);
      await db.query('update public.buildings set merged_into_id=$1 where id=$2', [buildingIds[0], buildingIds[1]]);
      try {
        assert.equal((await artifact(who, { requestId: source.body.requestId, resultId: source.body.result.resultId, action: 'export', format: 'png_zip', chart: cases[0][3] })).status, 403);
        const next = await submit(who, '改成柱状图', { modify: true, chart: { ...cases[0][3], type: 'bar' } }, { id: source.body.conversation.id, parentRequestId: source.body.requestId });
        assert.equal(next.status, 403); assert.equal(next.body.result, undefined);
      } finally { await db.query('update public.buildings set merged_into_id=null where id=$1', [buildingIds[1]]); }
    });
  } finally {
    for (const row of before) await db.query('update public.buildings set submarket=$2 where id=$1', [row.id, row.submarket]);
    server.close(); await once(server, 'close');
  }
}
