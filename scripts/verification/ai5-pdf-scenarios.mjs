// Scripted model planning; real Auth, deterministic queries, encrypted audit,
// native PDF generation and production-built artifact HTTP are exercised.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { loadAgentHandler } from './ai5-export-scenarios.mjs';

export async function verifyAi5Reports({ db, service, keys, output, check, person, artifact, recover, events, decrypt, exportCaps, buildingIds }) {
  const handle = await loadAgentHandler(output);
  let scenario, round;
  const tool = (name, args) => ({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const completion = calls => ({ model: 'deepseek-flash', inputTokens: 20, outputTokens: 20, message: { role: 'assistant',
    content: calls ? null : 'PDF 已保存到桌面 https://fake.invalid/report.pdf', ...(calls ? { tool_calls: calls } : {}) } });
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await handle(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) }), {
        client: service, keys, enabled: true, invokeModel: async messages => {
          const step = round++;
          if (step === 0 && scenario.historyResultIds) {
            const hints = messages.filter(m => m.role === 'system').map(m => m.content).join('');
            scenario.historyResultIds.forEach(id => assert.ok(hints.includes(id), 'restored history snapshot must be exposed as authorized reference'));
            return completion([tool('generate_pdf_report', { resultIds: scenario.historyResultIds })]);
          }
          if (step === 0) return completion((scenario.metrics ?? ['rent', 'vacancy', 'totalArea']).map(metric => tool('query_report_market', {
            scope: { inventory: 'all_authorized', submarkets: [scenario.empty ? '望京' : 'CBD'], buildingIds }, metric, recentCompletedQuarters: 4 })));
          if (scenario.queryOnly) return { ...completion(), message: { role: 'assistant', content: '已查询正式结果。' } };
          if (step === 1 && !scenario.historyResultIds) {
            const results = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
            results.forEach(r => assert.equal(r.status, 'ready'));
            return completion([tool('generate_pdf_report', { resultIds: results.map(r => r.resultId), purpose: scenario.purpose ?? 'internal' })]);
          }
          await scenario.after?.(); return completion();
        },
      });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const endpoint = 'http://127.0.0.1:' + server.address().port;
  async function actor(label, canExport = true) { const who = await person('admin', 'ai5-pdf-' + label); await grantQuery({ setup: db }, who.id, {
    capabilities: canExport ? exportCaps : ['query:catalog', 'query:brochure', 'query:quarter'], fields: ['height', 'netEffectiveRent', 'totalArea', 'vacantArea'], allBuildings: false, buildingIds }); return who; }
  async function submit(who, options = {}) {
    scenario = options; round = 0;
    const response = await fetch(endpoint + '/api/intelligence/query/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token },
      body: JSON.stringify({ idempotencyKey: randomUUID(), question: options.queryOnly ? '查询 CBD 最近四个已结束季度的市场指标。' : '把当前对话已完成的 CBD 季度市场结果生成 PDF 研究报告。', conversation: options.conversation ?? { id: randomUUID() } }) });
    return { status: response.status, body: await response.json() };
  }
  async function readPdf(file) {
    assert.equal(file.status, 200, JSON.stringify(file.body)); assert.match(file.headers.get('content-type'), /^application\/pdf/);
    assert.equal(Buffer.from(file.bytes.subarray(0, 5)).toString(), '%PDF-');
    assert.equal(file.headers.get('x-artifact-sha256'), createHash('sha256').update(file.bytes).digest('hex'));
    const task = getDocument({ data: new Uint8Array(file.bytes), useSystemFonts: false, useWorkerFetch: false }); const pdf = await task.promise;
    try {
      const text = []; for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); text.push((await p.getTextContent()).items.map(item => item.str ?? '').join('')); assert.equal((await p.getAnnotations()).length, 0); }
      assert.equal(await pdf.getJSActions(), null); assert.ok(pdf.numPages >= 5); assert.ok(text.every((s, i) => s.includes(`${i + 1} / ${pdf.numPages}`)));
      const attachments = await pdf.getAttachments(); assert.ok(attachments.has('manifest.json'));
      return { text: text.join(''), manifest: JSON.parse(new TextDecoder().decode(await pdf.getAttachmentContent('manifest.json'))), pages: pdf.numPages };
    } finally { await task.destroy(); }
  }
  let owner, generated;
  try {
    await check('AI5 PDF / CBD 四季度租金、空置率和面积合成真实中文多页报告、图表及表格回读', async () => {
      owner = await actor('owner'); generated = await submit(owner);
      assert.equal(generated.status, 200, JSON.stringify(generated.body)); assert.equal(generated.body.agent.executionStatus, 'completed');
      assert.ok(!/已保存到桌面|fake\.invalid/.test(generated.body.message));
      const result = generated.body.result; assert.equal(result.parameters.agentReport.sectionCount, 3);
      const file = await artifact(owner, { requestId: generated.body.requestId, resultId: result.resultId, action: 'export', format: 'pdf' });
      const opened = await readPdf(file);
      for (const expected of ['高力国际', 'CBD', '净有效租金', '空置率', '季度总面积', '数据期间', '关键指标', '图表', '数据明细', '来源与限制', '内部研究']) assert.ok(opened.text.includes(expected), expected);
      assert.equal(opened.manifest.sections.length, 3);
      for (const [i, s] of opened.manifest.sections.entries()) assert.deepEqual(s.table, result.parameters.agentReport.sections[i].result.table);
      assert.deepEqual((await recover(owner, generated.body.requestId)).body.result, result);
      const answer = (await events(generated.body.requestId)).findLast(e => e.kind === 'tool_finished'); assert.equal(decrypt(answer).content.reportFile.state, 'server_generated');
    });
    await check('AI5 PDF / 连续对话中多个已完成查询经来源重新授权组合原快照', async () => {
      const who = await actor('history'), conversationId = randomUUID(), originals = [];
      let parentRequestId;
      for (const metric of ['rent', 'vacancy', 'totalArea']) {
        const reply = await submit(who, { queryOnly: true, metrics: [metric], conversation: { id: conversationId, ...(parentRequestId ? { parentRequestId } : {}) } });
        assert.equal(reply.status, 200, JSON.stringify(reply.body)); originals.push(reply.body.result); parentRequestId = reply.body.requestId;
      }
      const reply = await submit(who, { historyResultIds: originals.map(r => r.resultId), conversation: { id: conversationId, parentRequestId } });
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      const report = reply.body.result; assert.equal(report.parameters.agentReport.sectionCount, 3);
      const opened = await readPdf(await artifact(who, { requestId: reply.body.requestId, resultId: report.resultId, action: 'export', format: 'pdf' }));
      opened.manifest.sections.forEach((section, i) => { assert.deepEqual(section.table, originals[i].table); assert.equal(section.dataVersion, originals[i].dataVersion); });
      await db.query('update public.buildings set merged_into_id=$1 where id=$2', [buildingIds[0], buildingIds[1]]);
      try {
        const denied = await submit(who, { historyResultIds: originals.map(r => r.resultId), conversation: { id: conversationId, parentRequestId } });
        assert.equal(denied.status, 403); assert.equal(denied.body.result, undefined);
      } finally { await db.query('update public.buildings set merged_into_id=null where id=$1', [buildingIds[1]]); }
    });
    await check('AI5 PDF / 无有效数据保留限制与未知，不编造指标', async () => {
      const who = await actor('empty'), reply = await submit(who, { metrics: ['rent'], empty: true }); assert.equal(reply.status, 200, JSON.stringify(reply.body));
      const opened = await readPdf(await artifact(who, { requestId: reply.body.requestId, resultId: reply.body.result.resultId, action: 'export', format: 'pdf' }));
      assert.ok(opened.text.includes('没有可用的趋势数值')); assert.ok(opened.text.includes('未知'));
    });
    await check('AI5 PDF / 内部查询不等于导出或对客发布授权，跨用户及撤权拒绝', async () => {
      const denied = await submit(await actor('no-export', false), { metrics: ['rent'] }); assert.equal(denied.body.result?.parameters?.agentReport, undefined); assert.ok(denied.body.message.includes('未生成 PDF'));
      const client = await submit(await actor('client'), { metrics: ['rent'], purpose: 'client' }); assert.equal(client.body.result?.parameters?.agentReport, undefined); assert.ok(client.body.message.includes('未生成 PDF'));
      const common = { requestId: generated.body.requestId, resultId: generated.body.result.resultId, action: 'export', format: 'pdf' };
      assert.equal((await artifact(await actor('other'), common)).status, 403);
      await grantQuery({ setup: db }, owner.id, { capabilities: ['query:catalog', 'query:brochure', 'query:quarter'] }); assert.equal((await artifact(owner, common)).status, 403);
    });
    await check('AI5 PDF / 生成后来源撤回及生成中撤权阻止敏感文件交付', async () => {
      const who = await actor('withdraw'), source = await submit(who, { metrics: ['rent'] }); assert.equal(source.status, 200);
      await db.query('update public.buildings set merged_into_id=$1 where id=$2', [buildingIds[0], buildingIds[1]]);
      try { assert.equal((await artifact(who, { requestId: source.body.requestId, resultId: source.body.result.resultId, action: 'export', format: 'pdf' })).status, 403); }
      finally { await db.query('update public.buildings set merged_into_id=null where id=$1', [buildingIds[1]]); }
      const during = await actor('during'); const failed = await submit(during, { metrics: ['rent'], after: () => grantQuery({ setup: db }, during.id, { capabilities: ['query:catalog'] }) }); assert.equal(failed.status, 403); assert.equal(failed.body.result, undefined);
    });
  } finally { server.close(); await once(server, 'close'); }
}
