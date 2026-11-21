// Scripted native model planning only. Identity, grants, snapshots, audit,
// encrypted archives and the production-built download HTTP route remain real.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';

const handlers = new Map();
export async function loadAgentHandler(output) {
  if (handlers.has(output)) return handlers.get(output);
  const root = process.cwd(), bundled = path.join(output, 'agent-export-handler.cjs');
  const bundle = await rolldown({ input: path.join(root, 'src/lib/intelligence/agent/agentHttp.ts'),
    platform: 'node', resolve: { alias: { '@': root } }, external: ['next', 'next/server', 'next/headers', '@supabase/supabase-js', '@resvg/resvg-js'] });
  try { await bundle.write({ file: bundled, format: 'cjs', codeSplitting: false }); } finally { await bundle.close(); }
  const { handleAgentSubmission } = createRequire(import.meta.url)(bundled);
  handlers.set(output, handleAgentSubmission);
  return handleAgentSubmission;
}

export async function verifyAi5Exports({ db, service, keys, output, check, person, artifact, recover, events, decrypt, exportCaps, buildingIds }) {
  const handleAgentSubmission = await loadAgentHandler(output);
  let scenario, round;
  const completion = tool_calls => ({ model: 'deepseek-flash', inputTokens: 20, outputTokens: 20,
    message: { role: 'assistant', content: tool_calls ? null : '文件已由服务器生成，请使用下载操作。', ...(tool_calls ? { tool_calls } : {}) } });
  const call = (name, args) => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
      const response = await handleAgentSubmission(request, { client: service, keys, enabled: true,
        invokeModel: async messages => {
          const step = round++;
          if (step === 0) return completion((scenario.options.periods ?? [3]).map(quarter => call('list_buildings', { scope: { inventory: 'all_authorized', submarkets: ['CBD'], buildingIds },
            fields: ['height', 'netEffectiveRent', 'totalArea'], period: { year: 2026, quarter } })));
          if (step === 1) {
            const tools = messages.filter(item => item.role === 'tool').map(item => JSON.parse(item.content));
            tools.forEach(tool => assert.equal(tool.status, 'ready'));
            const { periods: _periods, ...options } = scenario.options; void _periods;
            await scenario.beforeExport?.();
            return completion([call('export_table', { resultIds: tools.map(tool => tool.resultId), format: 'xlsx', ...options })]);
          }
          await scenario.afterExport?.();
          return completion();
        } });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  async function submit(who, question, options = {}, hooks = {}, conversation = { id: randomUUID() }) {
    scenario = { options, ...hooks }; round = 0;
    const response = await fetch(endpoint + '/api/intelligence/query/agent', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token },
      body: JSON.stringify({ idempotencyKey: randomUUID(), question, conversation }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  const who = await person('admin', 'ai5-export'), other = await person('admin', 'ai5-export-other');
  const grant = capabilities => grantQuery({ setup: db }, who.id, { capabilities,
    fields: ['height', 'netEffectiveRent', 'totalArea'], allBuildings: false, buildingIds });
  try {
    await grant(exportCaps);
    let first;
    const cases = [
      ['把 CBD 所有楼导出 Excel。', {}],
      ['把 CBD 净有效租金最高的 10 栋楼导出 Excel。', { sort: { field: 'netEffectiveRent', direction: 'desc' }, topN: 10 }],
      ['按照建筑高度排序，导出前 20 栋楼。', { sort: { field: 'height', direction: 'desc' }, topN: 20 }],
      ['把刚才的结果导出 CSV。', { format: 'csv_zip' }],
      ['只保留楼宇名称、子市场、租金和面积。', { fields: ['name', 'submarket', 'netEffectiveRent', 'totalArea'], singleSheet: true }],
      ['导出全部结果，不只是当前显示的第一页。', {}],
      ['合并2026Q2和Q3的楼宇结果导出Excel。', { periods: [2, 3] }],
    ];
    let caseIndex = 0;
    for (const [question, options] of cases) await check('AI5 Agent / 真实Auth与下载回读：' + question, async () => {
      const actor = first && !question.includes('刚才') ? await person('admin', 'ai5-export-case-' + (++caseIndex)) : who;
      if (actor !== who) await grantQuery({ setup: db }, actor.id, { capabilities: exportCaps, fields: ['height', 'netEffectiveRent', 'totalArea'], allBuildings: false, buildingIds });
      const conversation = first && question.includes('刚才') ? { ...first.body.conversation, parentRequestId: first.body.requestId } : undefined;
      const source = await submit(actor, question, options, {}, conversation);
      assert.equal(source.status, 200, JSON.stringify(source.body));
      assert.equal(source.body.status, 'ready');
      const result = source.body.result;
      assert.equal(result.parameters.agentExport.exportedRows, result.table.rows.length);
      assert.ok(result.table.rows.length > 0);
      const downloaded = await artifact(actor, { requestId: source.body.requestId, resultId: result.resultId,
        action: 'export', format: options.format ?? 'xlsx' });
      assert.equal(downloaded.status, 200, JSON.stringify(downloaded.body));
      if (options.format === 'csv_zip') {
        const zip = await JSZip.loadAsync(downloaded.bytes);
        const csv = await zip.file('data.csv').async('string');
        assert.ok(csv.includes('楼宇'));
        assert.equal(csv.split('\r\n').length, result.table.rows.length + 2);
        assert.equal(JSON.parse(await zip.file('manifest.json').async('string')).resultId, result.resultId);
      } else {
        const book = XLSX.read(downloaded.bytes, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 });
        assert.equal(rows[1][0], options.periods ? result.table.rows[0].cells.export_result_id.value : result.table.rows[0].cells.name.value);
        if (options.periods) assert.equal(result.parameters.exportPlans.length, 2);
        assert.equal(book.Sheets['数据']['!autofilter'].ref.endsWith(String(result.table.rows.length + 1)), true);
        if (options.singleSheet) { assert.equal(book.SheetNames.length, 1); assert.equal(rows[0].length, 4); }
        else assert.equal(rows.length, result.table.rows.length + 1);
      }
      const stored = await events(source.body.requestId);
      assert.ok(stored.some(event => event.kind === 'response_generated'));
      const accounting = stored.find(event => event.kind === 'accounting');
      assert.ok(decrypt(accounting).content.toolTrace.some(item => item.name === 'export_table' && item.status === 'ready'));
      assert.deepEqual((await recover(actor, source.body.requestId)).body.result, result);
      if (!first) first = source;
    });
    await check('AI5 已生成文件仍受跨用户隔离、独立导出资格和撤权约束', async () => {
      const body = { requestId: first.body.requestId, resultId: first.body.result.resultId, action: 'export', format: 'xlsx' };
      await grantQuery({ setup: db }, other.id, { capabilities: exportCaps });
      assert.equal((await artifact(other, body)).status, 403);
      await grant(['query:catalog', 'query:brochure', 'query:quarter']);
      assert.equal((await artifact(who, body)).status, 403);
      const denied = await submit(who, '导出CBD Excel');
      assert.equal(denied.body.result?.parameters.agentExport, undefined);
      assert.ok(denied.body.agent.unresolvedFailures.some(item => item.code === 'export_not_authorized'));
      await grant(exportCaps);
    });
    await check('AI5 下载前来源撤回拒绝派生文件', async () => {
      const actor = await person('admin', 'ai5-export-source');
      await grantQuery({ setup: db }, actor.id, { capabilities: exportCaps, fields: ['height', 'netEffectiveRent', 'totalArea'], allBuildings: false, buildingIds });
      const source = await submit(actor, '导出CBD Excel');
      assert.equal(source.status, 200);
      await db.query('update public.buildings set merged_into_id=$1 where id=$2', [buildingIds[0], buildingIds[1]]);
      try {
        const response = await artifact(actor, { requestId: source.body.requestId, resultId: source.body.result.resultId, action: 'export', format: 'xlsx' });
        assert.equal(response.status, 403); assert.equal(response.bytes, undefined);
      } finally { await db.query('update public.buildings set merged_into_id=null where id=$1', [buildingIds[1]]); }
    });
    await check('AI5 生成中撤权拒绝最终文件和成功交付', async () => {
      const response = await submit(who, '导出CBD Excel', {}, {
        afterExport: () => grant(['query:catalog', 'query:brochure', 'query:quarter']),
      });
      assert.equal(response.status, 403);
      assert.equal(response.body.result, undefined);
      await grant(exportCaps);
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
