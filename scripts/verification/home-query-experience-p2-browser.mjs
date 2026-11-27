import { checkKeyboardLayoutContinuity } from './query-focus-layout-checks.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkAllQueryMenus, checkResponsiveQueryMenus, menuRecords } from './query-menu-browser-checks.mjs';
import { checkFocusTransitions } from './query-focus-browser-checks.mjs';

// Actual Next/React pages, synthetic HTTP data. This is visual and interaction
// evidence only; it does not claim production authentication, real DB or phones.
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = resolve(process.env.HOME_QUERY_P2_SOURCE_ROOT || root);
const buildMode = process.env.HOME_QUERY_P2_BUILD_MODE || 'development';
assert.ok(['development', 'production'].includes(buildMode));
const [variant = 'after', base = 'http://127.0.0.1:3213'] = process.argv.slice(2);
assert.ok(['before', 'after'].includes(variant));
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'local isolated preview only');
const out = resolve(process.env.HOME_QUERY_P2_EVIDENCE_DIR || `${root}/docs/verification/colliers-ai-experience-p2/browser`);
const widths = (process.env.HOME_QUERY_P2_WIDTHS || '1280,1536,1024,768,390,320').split(',').map(Number);
assert.ok(widths.every(width => [1280,1536,1024,768,390,320].includes(width)));
await mkdir(out, { recursive: true });
const sourceRequire = createRequire(`${sourceRoot}/package.json`);
const screenshotPixels = sourceRequire('sharp');
sourceRequire('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' } });
const { fixture } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/__tests__/fixtures.ts`);
const { buildAggregateResult, buildTrendResult, buildListResult, buildRankResult, buildDistributionResult, buildRelationshipResult, buildGroupedResult } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/result.ts`);
const { crossTrendPlan, crossTrendSnapshots } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/__tests__/crossTrendFixture.ts`);
const { resolveNumericFact } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/facts.ts`);
const { attachResearchAnalysis } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/researchAnalysis.ts`);
const { buildResultChart } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/charts.ts`);
const { renderResultCopy } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/resultOutput.ts`);
const { buildResultArtifact } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/artifacts.ts`);
const { resultViewSchema } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/presentation.ts`);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const id = '12345678-1111-4111-8111-111111111111';
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const saved = { user: { id, aud: 'authenticated', email: 'visual-fixture@example.test', app_metadata: {}, user_metadata: {} }, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp: expires_at, aud: 'authenticated', session_id: id })}.fixture` };
const examples = ['CBD 有哪些楼宇？', 'CBD 净有效租金从 2026Q1 到 2026Q3 的趋势，按各期样本', '2026Q3 全部获权楼宇的净有效租金按子市场比较', '2026Q3 CBD 净有效租金', '北京 2026Q2 到 2026Q3 净有效租金变化'];
const snapshots = Array.from({ length: 10 }, (_, n) => {
  const snapshot = fixture({ year: 2024 + Math.floor((n + 2) / 4), quarter: (n + 2) % 4 + 1 });
  // The original unit-test fixture spans one year; qualify source IDs when
  // extending it to a multi-year visual fixture so source identity stays exact.
  for (const row of snapshot.rows) for (const fact of Object.values(row.facts)) {
    for (const source of fact.sources) if (source.period) {
      source.id += `/${source.period.year}`;
      source.recordId += `/${source.period.year}`;
    }
  }
  return snapshot;
});
function stableResult(result, resultId) {
  const copy = JSON.parse(JSON.stringify(result));
  copy.resultId = resultId;
  copy.createdAt = '2026-11-17T03:00:00.000Z';
  copy.parameters.scope = { inventory: 'tracked', submarkets: ['CBD'] };
  return resultViewSchema.parse(copy);
}
const aggregate = stableResult(buildAggregateResult(fixture(), 'rent'), '11111111-1111-4111-8111-111111111111');
const vacancyResult = stableResult(buildAggregateResult(fixture(), 'vacancy'), '11111111-2222-4222-8222-111111111111');
const relationship = stableResult(buildRelationshipResult(fixture()), '11111111-3333-4333-8333-111111111111');
const regionSnapshots = crossTrendSnapshots(crossTrendPlan());
const regional = stableResult(buildGroupedResult([regionSnapshots.at(-1)], [regionSnapshots.at(-1)], 'submarket', 'rent', 'per_period'), '11111111-4444-4444-8444-111111111111');
regional.parameters.scope = { inventory: 'tracked' };
const longMarkdown = ['## ' + '北京办公市场研究与有效样本边界'.repeat(6),
  '此回答为合成界面夹具，未附可核验来源，不能作为业务结论。', '研究正文与样本限制。'.repeat(260),
  '## 样本核查', '| 指标 | 数值 |\n| --- | ---: |\n| 合成读数 | 0 |',
  'https://example.test/' + 'long-path-without-breaks'.repeat(12),
  '## 后续核实', '长研究回答的最后一段。', '```text\n尚未闭合的代码与 **Markdown'].join('\n\n');
const gapSnapshots = snapshots.map((snapshot, index) => index !== 4 ? snapshot : { ...snapshot, rows: snapshot.rows.map(row => ({ ...row, facts: { ...row.facts, netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id, row.facts.netEffectiveRent.sources.map(source => ({ ...source, rawValue: null })), snapshot.period) } })) });
const trend = stableResult(attachResearchAnalysis(buildTrendResult(gapSnapshots, 'rent', 'per_period'), gapSnapshots), '22222222-2222-4222-8222-222222222222');
// Larger source-bound list for AI6 table interactions. Only local fixture data.
const listSnapshot = fixture();
const originals = listSnapshot.rows;
listSnapshot.rows = Array.from({ length: 32 }, (_, index) => {
  const row = { ...originals[index % originals.length] };
  row.id = `table-${index + 1}`; row.name = `合成楼${String(index + 1).padStart(2, '0')}`;
  const qualify = source => ({ ...source, id: `${source.id}/table/${index}`, recordId: `${source.recordId}/table/${index}`, entityId: row.id });
  row.nameSource = { ...qualify(row.nameSource), recordId: row.id, rawValue: row.name };
  row.facts = Object.fromEntries(Object.entries(row.facts).map(([field, fact]) => [field, { ...fact, sources: fact.sources.map(qualify) }]));
  return row;
});
listSnapshot.expectedCount = listSnapshot.rows.length;
const tableResult = stableResult(buildListResult(listSnapshot, ['height', 'netEffectiveRent']), '44444444-4444-4444-8444-444444444444');
if (process.env.HOME_QUERY_MENU_ONLY === '1') {
  tableResult.table.columns.push({ key: 'submarket', label: '子市场', unit: null }, { key: 'grade', label: '等级', unit: null });
  tableResult.table.rows.forEach((row, i) => { row.cells.submarket = { kind: 'text', value: i % 2 ? '望京' : 'CBD', sourceIds: [] }; row.cells.grade = { kind: 'text', value: i % 3 ? '甲级' : '乙级', sourceIds: [] }; });
}
const professional = stableResult({ ...tableResult, parameters: { ...tableResult.parameters, agentChart: { version: 'chart-workspace/1', format: 'png_zip', request: { kind: 'plot', type: 'horizontal_bar', x: 'name', y: ['netEffectiveRent'] } } } }, '45454545-4545-4545-8545-454545454545');
const ranking = stableResult(buildRankResult(listSnapshot, 'height', 10, 'desc'), '55555555-5555-4555-8555-555555555555');
const distributionSnapshot = fixture();
for (const [index, value] of [[0, 100], [1, 101], [3, 200]]) {
  const row = distributionSnapshot.rows[index];
  row.facts.netEffectiveRent = resolveNumericFact('netEffectiveRent', row.id,
    row.facts.netEffectiveRent.sources.map(source => ({ ...source, rawValue: value })), distributionSnapshot.period);
}
const distribution = stableResult(buildDistributionResult(distributionSnapshot, 'rent'), '99999999-9999-4999-8999-999999999999');
const entitySnapshot = fixture();
entitySnapshot.rows = [entitySnapshot.rows[2]];
entitySnapshot.expectedCount = entitySnapshot.rows.length;
const entityRow = entitySnapshot.rows[0];
entityRow.id = '12345678-1111-4111-8111-111111111111';
entityRow.nameSource = { ...entityRow.nameSource, entityId: entityRow.id, recordId: entityRow.id };
for (const fact of Object.values(entityRow.facts)) fact.sources = fact.sources.map(source => ({ ...source, entityId: entityRow.id }));
const entity = stableResult(buildListResult(entitySnapshot, ['height', 'totalArea']), '12345678-2222-4222-8222-222222222222');
entity.sources = entity.sources.map(source => ({ ...source, verification: source.id === entityRow.nameSource.id ? 'historical' : 'unreviewed' }));
const fileResult = stableResult({ ...tableResult, parameters: { ...tableResult.parameters,
  agentExport: { version: 'agent-export/1', format: 'xlsx', singleSheet: false, matchedRows: 32, exportedRows: 32 } } }, '66666666-6666-4666-8666-666666666666');
const pdfResult = stableResult({ ...tableResult, parameters: { ...tableResult.parameters,
  agentReport: { version: 'research-pdf/1', format: 'pdf', purpose: 'internal', generatedAt: '2026-11-17T03:00:00.000Z', sectionCount: 1, rowCount: 32, sections: [{ result: tableResult, chart: null }] } } }, '66666666-7777-4777-8777-666666666666');
function leaseFixture(available, quarter) {
  const result = structuredClone(aggregate);
  result.resultId = available ? '77777777-7777-4777-8777-777777777777' : '88888888-8888-4888-8888-888888888888';
  result.operation = 'list'; result.analysis = {};
  result.parameters = { dataDomain: 'lease-research/1', scope: { mode: 'aggregate', source: 'combined', from: quarter === 3 ? '2026-07-01' : '2026-10-01', to: quarter === 3 ? '2026-09-30' : '2026-12-31', groupBy: 'quarter' } };
  result.sources = [];
  const unknown = { kind: 'unknown', state: 'missing', reason: 'no_valid_sample', sourceIds: [] };
  const number = value => ({ kind: 'number', value: { numeric: value, exact: { numerator: String(value), denominator: '1' } }, sourceIds: [] });
  result.table = { id: 'synthetic-lease-summary', columns: [{ key: 'group', label: '季度', unit: null }, { key: 'count', label: '成交记录数', unit: 'transaction_count' }, { key: 'area', label: '成交面积', unit: 'm2' }], rows: [{ entityId: `2026-Q${quarter}`, cells: { group: { kind: 'text', value: `2026-Q${quarter}`, sourceIds: [] }, count: available ? number(12) : unknown, area: available ? number(18300) : unknown } }] };
  result.limitations = ['合成夹具，仅用于界面回归；不是生产成交数据。'];
  return resultViewSchema.parse(result);
}
const leaseSummary = leaseFixture(true, 3), leaseUnknown = leaseFixture(false, 4);
const leaseSelection = { version: 'answer-selection/1', task: 'record', status: 'partial', primaryResultId: leaseSummary.resultId,
  notice: '当前结果仅包含汇总，尚不能确认最新一笔成交。', results: [{ role: 'alternative', result: leaseSummary }, { role: 'supporting', result: leaseUnknown }] };
const historyEntries = ['CBD 季度租金跟踪', '金融街与 CBD 区域对比', '北京办公楼空置率研究'].map((title, index) => ({
  conversationId: `33333333-3333-4333-8333-33333333333${index}`, title, updatedAt: '2026-11-17T02:30:00Z', latestQuestion: index ? '比较当前获权区域的季度指标，并核对统计样本。' : '2026Q3 CBD 净有效租金是多少？', requestId, archived: false,
}));
const notices = [{ id: 1, content: '季度数据已更新，请核对负责楼宇的填报进度。', updated_at: '2026-11-17T02:00:00Z', is_active: true }, { id: 2, content: '地图支持查看楼宇照片、租赁成交及历史季度指标。', updated_at: '2026-11-16T02:00:00Z', is_active: true }];
const records = [];
const fixtureDigest = createHash('sha256').update(JSON.stringify({ examples, aggregate, vacancyResult, relationship, regional, longMarkdown, trend, tableResult, ranking, distribution, entity, fileResult, pdfResult, leaseSelection, historyEntries, notices })).digest('hex');
const baseline = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDiff = execFileSync('git', ['-C', sourceRoot, 'diff', '--', 'src/components/home', 'src/styles/tokens.css'], { encoding: 'utf8' });
const sourceDiffSha256 = createHash('sha256').update(sourceDiff).digest('hex');
const launchOptions = { ...(process.env.PERF_BROWSER_EXECUTABLE ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE } : process.env.PERF_BROWSER_CHANNEL && process.env.PERF_BROWSER_CHANNEL !== 'chromium' ? { channel: process.env.PERF_BROWSER_CHANNEL } : {}), headless: true };
const zoom = Number(process.env.HOME_QUERY_P2_BROWSER_ZOOM || 1);
assert.ok([1, 1.25, 2].includes(zoom));
let zoomProfile, zoomContext;
if (zoom !== 1) {
  assert.ok(widths.length === 1 && widths[0] === 1280 && process.env.HOME_QUERY_MENU_ONLY === '1');
  // Chromium's native per-host browser zoom, not CSS zoom or pinch emulation.
  zoomProfile = await mkdtemp('/tmp/colliers-ai-zoom-');
  await mkdir(`${zoomProfile}/Default`);
  await writeFile(`${zoomProfile}/Default/Preferences`, JSON.stringify({ partition: { per_host_zoom_levels: { x: { [new URL(base).hostname]: { zoom_level: Math.log(zoom) / Math.log(1.2), last_modified: '13400000000000000' } } } } }));
  // Playwright's default headless shell does not load Chrome's zoom prefs.
  // The installed full Chromium channel uses native Chrome browser zoom.
  const zoomBrowser = process.env.PERF_BROWSER_EXECUTABLE ? {} : { channel: process.env.PERF_BROWSER_CHANNEL || 'chromium' };
  zoomContext = await chromium.launchPersistentContext(zoomProfile, { ...launchOptions, ...zoomBrowser, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
}
const browser = zoomContext?.browser() ?? await chromium.launch(launchOptions);

async function makePage(width, capability = 'enabled', role = 'admin') {
  const height = width === 768 ? 1024 : width < 640 ? 844 : 900;
  const context = zoomContext ?? await browser.newContext({ viewport: { width, height }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const calls = [], errors = [];
  const localHistory = structuredClone(historyEntries);
  if (process.env.HOME_QUERY_MENU_ONLY === '1') for (let i = 3; i < 15; i++) localHistory.push({ ...localHistory[0], conversationId: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`, title: `合成长历史记录 ${i}` });
  const control = { exportFailures: 0, answer: 'short', release: null, currentResult: aggregate, lastBody: null };
  // Keep localhost's development HMR transport; only the synthetic Supabase
  // realtime transport is closed. Production mode does not require HMR.
  await context.routeWebSocket(/^wss:\/\/example\.supabase\.co/, ws => ws.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    calls.push({ path: url.pathname, method: request.method(), action: body?.action, ...(['export', 'chart'].includes(body?.action) ? { selection: body.selection, chart: body.chart, resultId: body.resultId, format: body.format } : {}) });
    const json = data => route.fulfill({ json: data });
    if (url.origin === new URL(base).origin) {
      if (url.pathname === '/api/intelligence/query/capabilities') return capability === 'error'
        ? route.fulfill({ status: 503, json: { error: 'synthetic capability unavailable' } })
        : json({ enabled: capability === 'enabled', permissionRevision: 'synthetic-visual-v1', examples: capability === 'enabled' ? examples : [], internalExport: true });
      if (url.pathname === '/api/intelligence/query/history') {
        if (body.action === 'list') return json({ status: 'ready', page: { entries: localHistory.filter(entry => entry.archived === !!body.archived && (entry.title.includes(body.search || '') || entry.latestQuestion.includes(body.search || ''))), hasMore: false, indexing: false, unavailable: 0 } });
        if (body.action === 'open') return json({ status: 'ready', opened: { conversation: { id: body.conversationId, parentRequestId: requestId, resumeToken: 'synthetic-resume' }, title: historyEntries[0].title, turns: [{ requestId, question: '2026Q3 CBD 净有效租金是多少？', submittedAt: '2026-11-17T02:30:00Z', state: 'ready' }], selected: { requestId, question: '2026Q3 CBD 净有效租金是多少？', submittedAt: '2026-11-17T02:30:00Z', state: 'ready', reply: { requestId, status: 'ready', result: aggregate } }, hasMore: false } });
        if (body.action === 'rename') localHistory.find(entry => entry.conversationId === body.conversationId).title = body.title;
        if (body.action === 'archive') localHistory.find(entry => entry.conversationId === body.conversationId).archived = body.archived;
        return json({ status: 'saved' });
      }
      if (url.pathname === '/api/intelligence/query/buildings' && body.resultId === entity.resultId) {
        if (body.requestId !== requestId || body.buildingId || body.photoId) return route.fulfill({ status: 403, json: { status: 'denied' } });
        const row = entity.table.rows[0];
        return json({ status: 'ready', requestId, resultId: entity.resultId, metadataReadAt: '2026-11-17T03:00:00.000Z',
          total: 1, offset: 0, hasMore: false, buildings: [{ id: row.entityId, name: row.cells.name.value, submarket: 'CBD', grade: 'A',
            located: false, unavailableReason: 'missing_coordinates', photo: null }] });
      }
      if (url.pathname === '/api/intelligence/query/artifact') {
        if (body.action === 'chart') {
          const selected = [aggregate, vacancyResult, relationship, regional, trend, tableResult, professional, ranking, distribution, entity, fileResult, pdfResult, leaseSummary, leaseUnknown].find(result => result.resultId === body.resultId);
          return json({ status: 'ready', chart: buildResultChart(selected ?? control.currentResult, body.chart) });
        }
        if (body.action === 'export' && (process.env.HOME_QUERY_MENU_ONLY === '1' || [fileResult.resultId, pdfResult.resultId].includes(body.resultId))) {
          if (control.exportFailures-- > 0) return route.fulfill({ status: 503, json: { error: '合成下载失败，请重试。' } });
          const source = [aggregate, vacancyResult, relationship, regional, trend, tableResult, professional, ranking, distribution, entity, fileResult, pdfResult, leaseSummary, leaseUnknown].find(result => result.resultId === body.resultId);
          const artifact = await buildResultArtifact(source, body);
          return route.fulfill({ body: Buffer.from(artifact.bytes), contentType: artifact.contentType, headers: { 'content-disposition': `attachment; filename="fixture.${body.format.endsWith('_zip') ? 'zip' : body.format}"`, 'x-query-result-id': body.resultId, 'x-artifact-sha256': artifact.sha256 } });
        }
        if (body.action === 'copy') return json({ status: 'ready', requestId: body.requestId, resultId: body.resultId, format: body.format, text: renderResultCopy([aggregate, trend, tableResult, professional, ranking].find(result => result.resultId === body.resultId) ?? control.currentResult, body.format), resultDigest: 'a'.repeat(64) });
        return route.fulfill({ status: 503, json: { error: 'Visual fixture does not implement file export; original export regressions remain required.' } });
      }
      if (url.pathname === '/api/intelligence/query/receipt') return json({ status: 'recorded' });
      if (url.pathname === '/api/intelligence/query') {
        control.lastBody = body;
        if (control.answer === 'waiting') await new Promise(done => { control.release = done; });
        const shared = { requestId, conversation: body.conversation, options: [] };
        if (control.answer === 'failure') return json({ ...shared, status: 'unavailable' });
        if (control.answer === 'clarification') return json({ ...shared, status: 'clarification', reason: 'period_required', message: '你想查看哪个季度的净有效租金？选择季度后，我会按当前获权样本继续查询。', options: [{ id: 'quarter', label: '2026 年第三季度', question: '2026Q3 CBD 净有效租金' }] });
        if (control.answer === 'long-markdown') return json({ ...shared, status: 'clarification', reason: 'assistant_help', message: longMarkdown });
        if (['professional', 'aggregate', 'vacancy', 'relationship', 'regional', 'complex', 'table', 'ranking', 'distribution', 'entity', 'file', 'pdf', 'lease-unknown', 'lease-alternative'].includes(control.answer)) {
          control.currentResult = ({ professional, table: tableResult, aggregate, vacancy: vacancyResult, relationship, regional, complex: trend, ranking, distribution, entity, file: fileResult, pdf: pdfResult, 'lease-unknown': leaseUnknown, 'lease-alternative': leaseSummary })[control.answer];
          return json({ ...shared, status: 'ready', historySaved: true, result: control.currentResult, ...(control.answer === 'lease-alternative' ? { answerSelection: leaseSelection } : {}) });
        }
        return json({ ...shared, status: 'clarification', reason: 'assistant_help', message: '你好！今天想了解什么？' });
      }
      if (url.pathname.startsWith('/api/')) return json({ issues: [], data: [], messages: [] });
      return route.continue();
    }
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (url.origin === 'https://example.supabase.co') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role, full_name: 'Ron Yu', chinese_name: null, session_id: id, phone: null }] });
      if (url.pathname === '/rest/v1/notices') return route.fulfill({ headers, json: notices });
      if (url.pathname === '/rest/v1/messages') return route.fulfill({ headers, json: [{ id: 'visual-message', user_name: 'Lily Liu', user_email: 'fixture@example.test', content: '本周市场观察已更新，欢迎交流近期客户需求。', created_at: '2026-11-17T02:30:00Z' }] });
      return route.fulfill({ headers, status: request.method() === 'GET' ? 200 : 204, ...(request.method() === 'GET' ? { json: [] } : {}) });
    }
    return route.abort();
  });
  await context.addInitScript(({ saved, base }) => {
    if (location.origin !== new URL(base).origin) return;
    localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
    localStorage.setItem('sb-example-auth-token', JSON.stringify(saved));
  }, { saved, base });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', entry => { if (entry.type() === 'error') console.error('browser console:', entry.text()); });
  page.setDefaultTimeout(20000);
  await page.goto(base, { waitUntil: 'networkidle' });
  try { await page.getByRole('link', { name: '季度数据填报', exact: true }).waitFor(); }
  catch (error) {
    await page.screenshot({ path: `${out}/${variant}-${width}-setup-failure.png`, fullPage: true });
    console.error(JSON.stringify({ url: page.url(), body: (await page.locator('body').innerText()).slice(0,6000), calls, errors }));
    throw error;
  }
  if (role === 'admin') await page.locator('#home-query').waitFor();
  if (capability === 'enabled' && role === 'admin') await page.waitForFunction(() => !document.querySelector('#home-query')?.disabled);
  return { context, page, control, errors, calls, width, height, role, capability };
}

async function capture(session, state) {
  const { page, width, height, errors, calls, role, capability } = session;
  await page.evaluate(() => document.fonts.ready);
  await settledPaint(page);
  const chart = ['expanded-complex', 'expanded-chart'].includes(state) ? await chartEvidence(page) : null;
  const history = state === 'history-open' ? await page.getByRole('button', { name: '打开对话：CBD 季度租金跟踪', exact: true }).evaluate(viewportGeometry) : null;
  const dataSummary = state === 'data-summary' ? await page.getByRole('region', { name: '核心指标', exact: true }).evaluate(viewportGeometry) : null;
  // Playwright fast-forwards finite animations and restores them afterwards;
  // do not capture the welcome text halfway through answerEnter's opacity.
  const screenshotPath = `${out}/${variant}-${width}-${state}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
  if (chart?.lineVisible && chart.svgGeometry?.visible) chart.paint = await chartPaintEvidence(screenshotPath, chart.svgGeometry.intersection, width);
  const metrics = await page.evaluate(() => {
    const input = document.querySelector('#home-query'), composer = input?.parentElement;
    const rect = node => { if (!node) return null; const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom }; };
    const dialog = document.querySelector('[aria-label="Colliers AI 工作空间"]');
    const toolbar = document.querySelector('#colliers-ai > header'), identity = toolbar?.firstElementChild;
    const identityBox = identity?.getBoundingClientRect();
    const toolbarNonOverlap = !identityBox || [...(toolbar?.querySelectorAll('button') || [])].every(node => {
      const box = node.getBoundingClientRect();
      return box.width === 0 || box.height === 0 || box.left >= identityBox.right - 1 || box.top >= identityBox.bottom - 1 || box.bottom <= identityBox.top + 1;
    });
    const current = document.querySelector('[aria-label="本次问答"]');
    const textNodes = [...(document.querySelector('#colliers-ai')?.querySelectorAll('h2,h3,h4,p,summary,button,th,td,dt,dd,span,label,time') || [])]
      .filter(node => node.getClientRects().length && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()) && !node.closest('pre,code'));
    const typography = { sizes: [...new Set(textNodes.map(node => getComputedStyle(node).fontSize))].sort(), weights: [...new Set(textNodes.map(node => getComputedStyle(node).fontWeight))].sort() };
    const readingSurfaces = [...(current?.querySelectorAll('summary, [aria-label="图表与分析"], figure') || [])].map(node => ({ tag: node.tagName, text: node.textContent?.slice(0, 70), className: node.className, rect: rect(node), maxWidth: getComputedStyle(node).maxWidth, width: getComputedStyle(node).width, marginInline: getComputedStyle(node).marginInline }));
    return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth, surface: rect(document.querySelector('#colliers-ai')), input: rect(input), composer: rect(composer), dialog: rect(dialog), inputCount: document.querySelectorAll('#home-query').length, nav: rect(document.querySelector('[aria-label="业务入口"]')), activeElement: document.activeElement?.id, toolbarNonOverlap, readingSurfaces, typography, colors: { page: getComputedStyle(document.querySelector('main')).backgroundColor, workspace: getComputedStyle(document.querySelector('#colliers-ai') || document.body).backgroundColor, composer: composer ? getComputedStyle(composer).backgroundColor : null } };
  });
  const checks = { pageOverflow: metrics.scrollWidth <= width, toolbarNonOverlap: metrics.toolbarNonOverlap, singleInput: role !== 'admin' ? metrics.inputCount === 0 : metrics.inputCount === 1, expandedInputWithinViewport: !metrics.dialog || !metrics.input || (metrics.input.y >= -1 && metrics.input.bottom <= height + 1) };
  if (chart) {
    checks.chartGeometryReady = chart.validGeometry;
    // Complex-answer screenshots may legitimately show the conclusion with the
    // plot below the viewport. The dedicated chart state must show the SVG.
    if (state === 'expanded-chart') checks.chartFullyInScrollport = !!chart.svgGeometry?.visible && chart.svgGeometry.intersection.height >= chart.svgGeometry.rect.height - 2;
    if (state === 'expanded-chart' || chart.lineVisible) checks.chartInkPainted = !!chart.paint && chart.paint.darkBluePixels >= 12;
  }
  if (history) {
    metrics.historyFirstEntry = history;
    const firstEntryUsable = history.visible && history.intersection.height >= Math.min(44, history.rect.height) && history.intersection.width >= Math.min(44, history.rect.width);
    metrics.historyFirstEntryUsable = firstEntryUsable;
    if (variant === 'after') checks.historyFirstEntryVisible = firstEntryUsable;
  }
  if (dataSummary) {
    metrics.dataSummaryCore = dataSummary;
    checks.dataSummaryCoreVisible = dataSummary.visible && dataSummary.intersection.height >= Math.min(44, dataSummary.rect.height);
  }
  records.push({ state, width, height, role, capability, metrics, checks, ...(chart ? { chart } : {}), interactionChecks: session.interactionChecks || {}, errors: [...errors], queryPosts: calls.filter(call => call.path === '/api/intelligence/query' && call.method === 'POST').length });
  console.log(`${variant}: ${width}px ${state} ${Object.values(checks).every(Boolean) ? 'visual/layout checks pass' : 'VISUAL OR LAYOUT ISSUE (retained)'}`);
  await writeFile(`${out}/${variant}-browser.json`, JSON.stringify({ variant, baseline, sourceRoot, sourceDiffSha256, fixtureDigest, browser: browser.version(), recordCount: records.length, screenshots: 'Full page; fonts ready and at least two animation frames after scrolling; Playwright animations disabled for stable finite animation endpoints; no CSS injection', environment: `Next ${buildMode} server; real React DOM; synthetic session and intercepted HTTP; no production writes`, limitations: ['Not a real authentication/DB test', 'Not physical iOS/Android; no real soft keyboard or file handling', 'No quantitative production performance claim', 'Implemented UI checked at representative viewports; no independent visual approval gate'], records }, null, 2));
}
async function settledPaint(page) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
// Executed in the browser by locator.evaluate. Include every actual clipping
// scrollport, while stopping at the fixed workspace before its background page.
function viewportGeometry(node) {
  const box = node.getBoundingClientRect(), rect = { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
  const clipping = [], dialog = node.closest('[aria-label="Colliers AI 工作空间"]');
  let left = 0, top = 0, right = innerWidth, bottom = innerHeight, displayed = true;
  for (let parent = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    const clipWidth = parent instanceof SVGElement ? bounds.width : parent.clientWidth;
    const clipHeight = parent instanceof SVGElement ? bounds.height : parent.clientHeight;
    if (style.display === 'none' || style.visibility === 'hidden' || parent.hidden || parent.inert) displayed = false;
    if (parent !== node && /(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left + parent.clientLeft); right = Math.min(right, bounds.left + parent.clientLeft + clipWidth); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top + parent.clientTop); bottom = Math.min(bottom, bounds.top + parent.clientTop + clipHeight); }
      clipping.push({ label: parent.getAttribute('aria-label'), tag: parent.tagName, scrollTop: parent.scrollTop, scrollLeft: parent.scrollLeft, clientWidth: parent.clientWidth, clientHeight: parent.clientHeight, scrollWidth: parent.scrollWidth, scrollHeight: parent.scrollHeight });
    }
    if (parent === dialog && style.position === 'fixed') break;
  }
  const intersection = { left: Math.max(left, rect.left), top: Math.max(top, rect.top), right: Math.min(right, rect.right), bottom: Math.min(bottom, rect.bottom) };
  intersection.width = Math.max(0, intersection.right - intersection.left); intersection.height = Math.max(0, intersection.bottom - intersection.top);
  return { rect, intersection, clipping, visible: displayed && intersection.width > 0 && intersection.height > 0 };
}
async function chartEvidence(page) {
  const chart = page.getByRole('figure', { name: '同源查询图表', exact: true }).last();
  let readinessError = null;
  try {
    await page.waitForFunction(expectedPoints => {
      const figures = document.querySelectorAll('[aria-label="同源查询图表"]'), svg = figures[figures.length - 1]?.querySelector('svg');
      const lines = [...(svg?.querySelectorAll('polyline') || [])], axis = svg?.querySelector('path');
      return !!svg && svg.getBoundingClientRect().width > 0 && svg.getBoundingClientRect().height > 0 && !!axis?.getAttribute('d') && axis.getTotalLength() > 0
        && svg.querySelectorAll('circle').length === expectedPoints && lines.length > 0 && lines.every(line => {
          const coordinates = (line.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
          return coordinates.length >= 4 && coordinates.every(Number.isFinite) && line.getTotalLength() > 0;
        });
    }, trend.table.rows.filter(row => row.cells.value?.kind === 'number').length, { timeout: 10000 });
  } catch (error) { readinessError = error.message.split('\n')[0]; }
  if (!await chart.count() || !await chart.locator('svg').count()) return { validGeometry: false, readinessError: readinessError || 'Chart SVG is absent' };
  const svg = chart.locator('svg').first();
  const facts = await svg.evaluate(node => ({ width: node.getAttribute('width'), height: node.getAttribute('height'), circleCount: node.querySelectorAll('circle').length, axisPaths: [...node.querySelectorAll('path')].map(path => path.getAttribute('d')), polylines: [...node.querySelectorAll('polyline')].map(line => ({ points: line.getAttribute('points'), length: line.getTotalLength() })) }));
  const svgGeometry = await svg.evaluate(viewportGeometry), lines = [];
  for (const line of await svg.locator('polyline').all()) lines.push(await line.evaluate(viewportGeometry));
  return { validGeometry: readinessError === null, readinessError, facts, svgGeometry, lines, lineVisible: lines.some(line => line.visible) };
}
async function chartPaintEvidence(screenshotPath, bounds, viewportWidth) {
  // Read the original PNG without editing it. The fixture's existing chart
  // series uses #003e7e; axes/text alone must not make a blank plot pass.
  const { data, info } = await screenshotPixels(screenshotPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / viewportWidth;
  const region = { left: Math.max(0, Math.floor(bounds.left * scale)), top: Math.max(0, Math.floor(bounds.top * scale)), right: Math.min(info.width, Math.ceil(bounds.right * scale)), bottom: Math.min(info.height, Math.ceil(bounds.bottom * scale)) };
  let darkBluePixels = 0;
  for (let y = region.top; y < region.bottom; y++) for (let x = region.left; x < region.right; x++) {
    const index = (y * info.width + x) * info.channels, red = data[index], green = data[index + 1], blue = data[index + 2];
    if (red <= 64 && green >= 35 && green <= 120 && blue >= 90 && blue <= 180 && blue - red >= 60 && blue - green >= 30) darkBluePixels++;
  }
  return { region, darkBluePixels, minimumRequired: 12, method: 'Read-only original PNG count of existing navy series ink within the visible SVG bounds' };
}
async function send(session, question, kind) {
  session.control.answer = kind;
  await session.page.locator('#home-query').fill(question);
  const firstSubmit = variant === 'after' && !session.calls.some(call => call.path === '/api/intelligence/query' && call.method === 'POST');
  const composerRect = () => session.page.locator('#home-query').evaluate(input => {
    const rect = input.parentElement.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  });
  let before;
  if (firstSubmit) {
    await session.page.waitForFunction(() => {
      const surface = document.querySelector('#colliers-ai');
      return ['focus', 'expanded'].includes(surface?.dataset.mode) && surface.dataset.transitioning === 'false';
    });
    before = await composerRect();
  }
  await session.page.getByRole('button', { name: '发送问题', exact: true }).click();
  if (kind === 'waiting') await session.page.getByRole('button', { name: '停止等待', exact: true }).waitFor();
  else await session.page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
  if (firstSubmit) {
    await settledPaint(session.page);
    const after = await composerRect();
    for (const field of ['top', 'left', 'width', 'height']) {
      assert.ok(Math.abs(before[field] - after[field]) <= 3, `first submit keeps the active composer ${field} stable: ${before[field]} -> ${after[field]}`);
    }
    session.interactionChecks.firstSubmitComposerStable = { passed: true, before, after };
  }
}
async function expanded(page, open) {
  const mode = await page.locator('#colliers-ai').getAttribute('data-mode');
  if (mode === (open ? 'expanded' : 'compact')) return;
  await page.getByRole('button', { name: open ? mode === 'focus' ? '全屏 Colliers AI 工作空间' : '展开 Colliers AI 工作空间' : '收起 Colliers AI 工作空间', exact: true }).click();
  await page.waitForFunction(value => { const node = document.querySelector('#colliers-ai'); return node?.dataset.mode === value && node?.dataset.transitioning === 'false'; }, open ? 'expanded' : 'compact');
}
// A focusable node can have a box while still being outside its scrollport.
// Verify actual visibility after Tab, including clipping ancestors, rather than
// treating document.activeElement alone as successful keyboard navigation.
async function focusedControl(page) {
  return page.evaluate(() => {
    const node = document.activeElement, rect = node?.getBoundingClientRect();
    const dialog = document.querySelector('[aria-label="Colliers AI 工作空间"]');
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, box.left + parent.clientLeft);
        right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, box.top + parent.clientTop);
        bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight);
      }
      // This workspace is fixed to the visual viewport. The background page's
      // scroller is not a clipping ancestor of its fixed-position surface.
      if (parent === dialog && style.position === 'fixed') break;
    }
    return {
      tag: node?.tagName, text: (node?.getAttribute('aria-label') || node?.textContent)?.slice(0, 80),
      visible: !!rect?.width && !!rect?.height && getComputedStyle(node).visibility !== 'hidden'
        && !node.closest('[hidden],[inert]') && rect.right > left && rect.left < right && rect.bottom > top && rect.top < bottom,
      withinDialog: !!dialog?.contains(node),
      wasBelowFold: !!window.__p2BelowFoldControls?.has(node),
      rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      scrollport: { left, top, right, bottom },
      scrollerTop: node?.closest('[aria-label="对话记录"]')?.scrollTop,
    };
  });
}
async function checkLongResultFocus(session) {
  const { page } = session;
  const initial = await page.evaluate(() => {
    const scroller = document.querySelector('[aria-label="对话记录"]');
    scroller.scrollTop = 0;
    const box = scroller.getBoundingClientRect();
    window.__p2BelowFoldControls = new Set([...scroller.querySelectorAll('button:not(:disabled),a[href],summary')]
      .filter(node => node.getBoundingClientRect().top >= box.bottom));
    return { count: window.__p2BelowFoldControls.size, backgroundScroll: document.querySelector('main > div')?.scrollTop || 0 };
  });
  const issues = [];
  let revealedBelowFold = 0;
  for (const direction of ['Tab', 'Shift+Tab']) {
    await page.locator('#home-query').focus();
    for (let step = 0; step < 60; step++) {
      await page.keyboard.press(direction);
      // Native focus scrolling and disclosure blur may settle on the next paint.
      // Measure the rendered target, retaining every visibility/containment check.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const active = await focusedControl(page);
      if (!active.visible || !active.withinDialog) {
        issues.push({ direction, step, active });
        console.error('long-result focus issue:', JSON.stringify({ width: session.width, direction, step, active }));
      }
      if (active.wasBelowFold && active.visible) revealedBelowFold++;
    }
  }
  const backgroundScroll = await page.evaluate(() => document.querySelector('main > div')?.scrollTop || 0);
  session.interactionChecks.longResultTabCycle = {
    passed: initial.count > 0 && revealedBelowFold > 0 && issues.length === 0 && backgroundScroll === initial.backgroundScroll,
    belowFoldControls: initial.count, revealedBelowFold, backgroundStayedFixed: backgroundScroll === initial.backgroundScroll, issues,
  };
}
try {
  for (const width of widths) {
    const session = await makePage(width);
    const { page, control } = session;
    if (process.env.HOME_QUERY_MENU_ONLY === '1') {
      try {
        if (zoom !== 1) await checkResponsiveQueryMenus(session, { send, expanded }, zoom);
        else await checkAllQueryMenus(session, { send, expanded });
      } finally {
        await writeFile(`${out}/menu-geometry.json`, JSON.stringify({ baseline, sourceDiffSha256, browser: browser.version(), environment: `Next ${buildMode}; actual React; synthetic HTTP only`, zoom, menuRecords }, null, 2));
        await session.context.close();
      }
      continue;
    }
    await capture(session, 'welcome');
    if (variant === 'after') await checkFocusTransitions(session, examples);
    if (width === 1280 || width === 390) {
      await page.getByRole('navigation', { name: '业务入口', exact: true }).evaluate(node => node.scrollIntoView({ block: 'start' }));
      // The activity module is lazy mounted. A scroll position alone can still
      // capture its loading placeholder instead of the actual team content.
      await page.getByText(notices[0].content, { exact: true }).waitFor();
      await page.getByText('本周市场观察已更新，欢迎交流近期客户需求。', { exact: true }).waitFor();
      await capture(session, 'business-team');
      await page.getByRole('complementary', { name: '团队动态', exact: true }).evaluate(node => node.scrollIntoView({ block: 'start', inline: 'nearest' }));
      await capture(session, 'team-details');
      await page.evaluate(() => { const scroller = document.querySelector('main > div'); if (scroller) scroller.scrollTop = 0; });
    }
    await page.locator('#home-query').evaluate(node => { window.__p2ComposerNode = node; });
    await expanded(page, true);
    await capture(session, 'expanded-welcome');
    const input = page.locator('#home-query');
    await input.click(); await input.pressSequentially('C');
    await page.waitForTimeout(150); await input.pressSequentially('BD');
    await input.press('ArrowLeft'); await input.pressSequentially('x'); await input.press('Backspace');
    assert.equal(await input.inputValue(), 'CBD');
    assert.equal(await input.evaluate(node => node === document.activeElement), true);
    const postsBeforeComposition = session.calls.filter(call => call.path === '/api/intelligence/query' && call.method === 'POST').length;
    await input.dispatchEvent('compositionstart', { data: '' });
    await input.fill('CBD中文'); await input.press('Enter');
    assert.equal(session.calls.filter(call => call.path === '/api/intelligence/query' && call.method === 'POST').length, postsBeforeComposition, 'composition Enter does not submit');
    await input.dispatchEvent('compositionend', { data: '中文' });
    await input.pressSequentially('草稿');
    const draftBeforeSwitch = await input.inputValue();
    session.interactionChecks = { ...session.interactionChecks, continuousInputAndCursor: true, syntheticCompositionEnterGuard: true };
    if (width < 640) {
      await page.setViewportSize({ width, height: 400 });
      session.height = 400;
      await page.waitForFunction(() => document.querySelector('#colliers-ai')?.dataset.viewportCompact === 'true');
      const invisibleFocus = [];
      for (const direction of ['Tab', 'Shift+Tab']) {
        await input.focus();
        for (let step = 0; step < 20; step++) {
          await page.keyboard.press(direction);
          const active = await focusedControl(page);
          if (!active.visible || !active.withinDialog) invisibleFocus.push({ direction, step, active });
        }
      }
      session.interactionChecks.shortViewportTabCycle = { passed: invisibleFocus.length === 0, invisibleFocus };
      await capture(session, 'short-viewport-tab-cycle');
      await page.setViewportSize({ width, height: 844 }); session.height = 844;
    }
    await expanded(page, false);
    assert.equal(await page.locator('#home-query').evaluate(node => node === window.__p2ComposerNode), true, 'same mounted composer after mode change');
    assert.equal(await input.inputValue(), draftBeforeSwitch, 'draft survives mode change');
    session.interactionChecks.sameComposerAndDraft = true;
    await send(session, '你好', 'short');
    await page.getByText('你好！今天想了解什么？', { exact: true }).waitFor();
    await capture(session, 'short-answer');
    await send(session, '查看 CBD 的净有效租金', 'clarification');
    await page.getByRole('button', { name: '2026 年第三季度', exact: true }).waitFor();
    await capture(session, 'clarification');
    await send(session, '2026Q3 CBD 净有效租金', 'aggregate');
    await page.getByRole('region', { name: '核心指标', exact: true }).waitFor();
    if (variant === 'after') {
      const context = await page.getByRole('article', { name: '本次问答', exact: true }).getByLabel('结果范围', { exact: true }).innerText();
      assert.ok(context.includes('CBD') && context.includes('2026 Q3'), 'formal metric keeps its scope and period');
    }
    await capture(session, 'data-result');
    await page.getByRole('region', { name: '查询结果', exact: true }).last().evaluate(node => node.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await capture(session, 'data-summary');
    const axis = await page.evaluate(() => {
      const current = document.querySelector('[aria-label="本次问答"]');
      const input = document.querySelector('#home-query').parentElement.getBoundingClientRect();
      const heading = current.querySelector('[class*="replyHeading"]').getBoundingClientRect();
      const question = current.querySelector('[class*="questionRow"]').getBoundingClientRect();
      return { composerCenter: input.x + input.width / 2, headingCenter: heading.x + heading.width / 2, questionCenter: question.x + question.width / 2,
        questionHeight: current.querySelector('p[class*="question"]').getBoundingClientRect().height };
    });
    assert.ok(Math.abs(axis.composerCenter - axis.headingCenter) <= 2 && Math.abs(axis.composerCenter - axis.questionCenter) <= 2, 'answer, question and composer share their reading axis');
    assert.ok(axis.questionHeight < 85, 'short question does not reserve a hidden edit row');
    assert.equal(await page.getByText('基于授权数据', { exact: true }).count(), 0);
    assert.equal(await page.getByText('本次分析已自动保存至历史记录。', { exact: true }).count(), 0);
    session.interactionChecks.readingAxis = { passed: true, ...axis };

    await expanded(page, true);
    if (await page.getByRole('button', { name: '关闭历史', exact: true }).isVisible()) await page.getByRole('button', { name: '关闭历史', exact: true }).click();
    const sourceTrigger = page.getByRole('region', { name: '核心指标', exact: true }).getByRole('button', { name: /^查看来源：/ }).first();
    await sourceTrigger.evaluate(node => { window.__p2SourceTrigger = node; });
    await sourceTrigger.click();
    const sourcePanel = page.getByRole('region', { name: '来源详情', exact: true });
    await sourcePanel.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '来源详情');
    // The source section is intentionally programmatic-only (tabindex=-1).
    // Tab must continue from its DOM position to its own close control.
    await page.keyboard.press('Tab');
    assert.equal(await sourcePanel.getByRole('button', { name: '关闭来源', exact: true }).evaluate(node => node === document.activeElement), true, 'Tab from source panel reaches its close control');
    const sourceFocus = await focusedControl(page);
    assert.ok(sourceFocus.visible && sourceFocus.withinDialog, 'source close control is visible inside the workspace');
    await page.keyboard.press('Enter');
    await sourcePanel.waitFor({ state: 'detached' });
    assert.equal(await sourceTrigger.evaluate(node => node === document.activeElement && node === window.__p2SourceTrigger), true, 'closing sources restores the original metric control');
    session.interactionChecks.sourcePanelKeyboardFocus = true;
    await send(session, '比较 CBD 各个季度的净有效租金趋势，并核对共同有效样本', 'complex');
    await page.getByRole('region', { name: '查询结果', exact: true }).last().waitFor();
    await page.getByRole('figure', { name: '同源查询图表', exact: true }).waitFor();
    const trendDetails = page.getByRole('region', { name: '查询结果', exact: true }).last().locator('summary').filter({ hasText: '查看数据明细' });
    if (await trendDetails.count()) await trendDetails.click();
    await checkLongResultFocus(session);
    if(variant==='after')session.interactionChecks.keyboardLayoutContinuity=await checkKeyboardLayoutContinuity(page);
    await page.getByRole('region', { name: '对话记录', exact: true }).evaluate(node => { node.scrollTop = node.scrollHeight; });
    await capture(session, 'expanded-complex-bottom');
    await page.getByRole('region', { name: '对话记录', exact: true }).evaluate(node => { const current = node.querySelector('[aria-label="本次问答"]'); node.scrollTop = current ? current.offsetTop : 0; });
    await capture(session, 'expanded-complex');
    await page.getByRole('figure', { name: '同源查询图表', exact: true }).evaluate(node => node.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await capture(session, 'expanded-chart');
    await page.getByRole('region', { name: '对话记录', exact: true }).evaluate(node => { const current = node.querySelector('[aria-label="本次问答"]'); node.scrollTop = current ? current.offsetTop : 0; });
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    await page.getByRole('button', { name: '打开对话：CBD 季度租金跟踪', exact: true }).waitFor();
    await capture(session, 'history-open');
    const search = page.getByRole('searchbox', { name: '搜索标题或最近问题' });
    await search.click(); await search.pressSequentially('C');
    await page.waitForTimeout(350); await search.pressSequentially('BD');
    assert.equal(await search.inputValue(), 'CBD');
    assert.equal(await search.evaluate(node => node === document.activeElement), true, 'history search retains focus over refresh');
    await search.press('ArrowLeft'); await search.pressSequentially('x'); await search.press('Backspace');
    assert.equal(await search.inputValue(), 'CBD');
    await page.getByRole('button', { name: '关闭历史', exact: true }).click();
    await page.getByRole('button', { name: '研究资料', exact: true }).click();
    await page.getByRole('complementary', { name: '研究资料与口径', exact: true }).waitFor();
    await page.getByRole('region', { name: '来源概览', exact: true }).waitFor();
    await capture(session, 'research-open');
    await page.getByRole('button', { name: '关闭研究资料', exact: true }).click();
    await page.getByRole('region', { name: '对话记录', exact: true }).evaluate(node => { node.scrollTop = 0; });
    await capture(session, 'expanded-multiturn');
    await expanded(page, false);
    await send(session, '列出获权楼宇并显示高度和净有效租金', 'table');
    await expanded(page, true);
    const table = page.getByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' }).last();
    await table.waitFor();
    assert.equal(await table.locator('tbody tr').count(), 25, 'list uses bounded pagination');
    const tableSearch = page.getByRole('searchbox', { name: '搜索本次结果' }).last();
    await tableSearch.fill('合成楼0');
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length >= 1);
    const postsBeforeFilter = session.calls.filter(call => call.path === '/api/intelligence/query' && call.method === 'POST').length;
    await tableSearch.pressSequentially('1');
    assert.equal(await tableSearch.inputValue(), '合成楼01');
    assert.equal(await tableSearch.evaluate(node => node === document.activeElement), true, 'table search keeps focus');
    await table.getByRole('checkbox', { name: '选择合成楼01', exact: true }).check();
    await tableSearch.dispatchEvent('compositionstart'); await tableSearch.fill('无匹配中文'); await tableSearch.dispatchEvent('compositionend');
    await page.getByText('没有匹配的记录，可清除搜索或筛选。', { exact: true }).waitFor();
    await tableSearch.fill('');
    await table.getByRole('button', { name: '建筑高度（米）', exact: true }).click();
    assert.equal(await table.locator('th[aria-sort="ascending"]').count(), 1);
    await expanded(page, false); await expanded(page, true);
    assert.equal(await table.getByRole('checkbox', { name: '选择合成楼01', exact: true }).isChecked(), true, 'selection survives workspace switches');
    assert.equal(session.calls.filter(call => call.path === '/api/intelligence/query' && call.method === 'POST').length, postsBeforeFilter, 'table interactions never query the model/database');
    await page.getByRole('button', { name: '展开表格', exact: true }).last().click();
    const dataWorkspace = page.getByRole('region', { name: '数据工作区', exact: true }).or(page.getByRole('dialog', { name: '数据工作区', exact: true }));
    await dataWorkspace.waitFor();
    assert.equal(await dataWorkspace.getByRole('checkbox', { name: '选择合成楼01', exact: true }).isChecked(), true, 'expanded table keeps selected snapshot row');
    await dataWorkspace.getByRole('searchbox').fill('合成楼01');
    assert.equal(await dataWorkspace.getByRole('searchbox').evaluate(node => node === document.activeElement), true, 'expanded search retains focus');
    await dataWorkspace.getByRole('button', { name: '返回对话', exact: true }).click();
    const restoredSearch = page.getByRole('searchbox', { name: '搜索本次结果' }).last();
    assert.equal(await restoredSearch.inputValue(), '合成楼01');
    assert.equal(await page.getByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' }).last().getByRole('checkbox', { name: '选择合成楼01', exact: true }).isChecked(), true);
    assert.equal(session.calls.filter(call => call.path === '/api/intelligence/query' && call.method === 'POST').length, postsBeforeFilter, 'workspace switching uses saved result only');
    session.interactionChecks.structuredTable = { passed: true, boundedRows: 25, returnedRows: 32, localSearchAndSort: true, retainedSelection: true, noQueryOnInteraction: true };
    await capture(session, 'interactive-table');
    await send(session, '按建筑高度查看最高十栋楼', 'ranking');
    const activeAnswer = page.getByRole('article', { name: '本次问答', exact: true });
    await activeAnswer.getByRole('figure', { name: '同源查询图表', exact: true }).waitFor();
    assert.equal(await activeAnswer.getByRole('table').count(), 0, 'ranking defaults to one comparison visual');
    const rankingLead = await activeAnswer.getByRole('button', { name: '编辑问题', exact: true }).evaluate(viewportGeometry);
    assert.ok(rankingLead.visible && rankingLead.intersection.height >= 32, 'new structured answer keeps its question and lead visible rather than jumping to the tail');
    await capture(session, 'default-ranking');
    if (variant === 'after') {
      await send(session, '查看合成单楼宇资料', 'entity');
      const record = activeAnswer.getByRole('region', { name: '记录摘要', exact: true });
      await record.waitFor();
      await record.getByRole('heading', { name: entity.table.rows[0].cells.name.value, exact: true }).waitFor();
      const boundary = activeAnswer.getByLabel('重要数据限制', { exact: true });
      assert.equal(await boundary.count(), 1);
      assert.match(await boundary.innerText(), /不按零处理/);
      assert.match(await boundary.innerText(), /尚未核验/);
      assert.match(await boundary.innerText(), /含历史来源/);
      await capture(session, 'entity-boundary');
      await send(session, '查看合成租金分布', 'distribution');
      await activeAnswer.getByText('图表设置', { exact: true }).click();
      await activeAnswer.getByRole('button', { name: '查看直方图', exact: true }).click();
      const zeroBar = activeAnswer.getByRole('img', { name: /直方图/ }).locator('rect[height="0"]');
      assert.equal(await zeroBar.count(), 1, 'synthetic distribution retains its zero-count interval');
      assert.equal(await zeroBar.getAttribute('tabindex'), null, 'zero-height bars cannot become invisible keyboard stops');
      await activeAnswer.getByRole('table', { name: '分箱边界与数量', exact: true }).getByRole('button', { name: '0 栋', exact: true }).waitFor();
      const histogramGeometry = await activeAnswer.getByRole('img', { name: /直方图/ }).locator('g').filter({ has: page.locator('rect[role="button"]') }).evaluateAll(groups => groups.map(group => {
        const bar = group.querySelector('rect').getBBox(), value = group.querySelector('text').getBBox();
        return { barCenter: bar.x + bar.width / 2, valueCenter: value.x + value.width / 2 };
      }));
      assert.ok(histogramGeometry.length > 0 && histogramGeometry.every(point => Math.abs(point.barCenter - point.valueCenter) <= 2), `histogram values align with intervals: ${JSON.stringify(histogramGeometry)}`);
      const bar = activeAnswer.getByRole('img', { name: /直方图/ }).getByRole('button').first();
      await bar.focus(); await bar.press('Enter');
      const reading = activeAnswer.getByRole('status', { name: '区间读数', exact: true });
      assert.match(await reading.innerText(), /区间 1：/);
      await reading.getByRole('button', { name: '数据依据', exact: true }).click();
      const evidence = page.getByRole('region', { name: '来源详情', exact: true });
      await evidence.waitFor();
      await evidence.getByText('记录技术信息', { exact: true }).first().click();
      assert.ok((await evidence.innerText()).includes('net_effective_rent'));
      await page.getByRole('button', { name: '返回对话', exact: true }).click();
      await reading.waitFor();
      await capture(session, 'distribution-reading');
      session.interactionChecks.resultContextAndEvidence = { passed: true, entityLimitsVisibleOnce: true, keyboardIntervalReading: true, sourceReturn: true };
    }
    await send(session, '查看第四季度成交汇总', 'lease-unknown');
    await activeAnswer.getByRole('heading', { name: '该期间暂无可交付统计', exact: true }).waitFor();
    assert.equal(await activeAnswer.getByText('该期间暂无可交付统计', { exact: true }).filter({ visible: true }).count(), 1, 'unavailable state is stated once');
    assert.equal(await activeAnswer.getByRole('searchbox').count(), 0);
    assert.equal(await activeAnswer.getByRole('link', { name: '在地图中查看', exact: true }).count(), 0);
    assert.equal(await activeAnswer.getByRole('figure').count(), 0);
    assert.equal(await activeAnswer.getByRole('button', { name: /查看散点图|下一页/ }).count(), 0);
    await capture(session, 'unavailable-lease');
    await send(session, '最近一年最新一笔租赁成交', 'lease-alternative');
    await activeAnswer.getByText(leaseSelection.notice, { exact: true }).waitFor();
    await activeAnswer.getByText('替代信息 · 成交汇总', { exact: true }).waitFor();
    assert.equal(await activeAnswer.getByText('2026-Q3', { exact: true }).count(), 1);
    assert.equal(await activeAnswer.getByText('2026-Q4', { exact: true }).isVisible(), false);
    await capture(session, 'lease-alternative');
    await activeAnswer.getByText('查看辅助依据', { exact: true }).click();
    await activeAnswer.getByRole('heading', { name: '该期间暂无可交付统计', exact: true }).waitFor();
    assert.equal(await activeAnswer.getByText('该期间暂无可交付统计', { exact: true }).filter({ visible: true }).count(), 1, 'unavailable state is stated once');
    await activeAnswer.getByText('查看辅助依据', { exact: true }).click();
    await send(session, '导出本次楼宇清单Excel', 'file');
    await activeAnswer.getByRole('button', { name: '下载 Excel', exact: true }).waitFor();
    assert.equal(await activeAnswer.getByRole('table').count(), 0, 'file attachment leads; details are opt-in');
    const downloaded = page.waitForEvent('download');
    await activeAnswer.getByRole('button', { name: '下载 Excel', exact: true }).click();
    const file = await downloaded;
    assert.equal(file.suggestedFilename(), 'fixture.xlsx');
    await activeAnswer.getByText('已发起下载', { exact: true }).waitFor();
    session.interactionChecks.representativeAnswers = { passed: true, rankingDefaultChart: true, allUnknownState: true, selectedLeaseAlternative: true, realWorkbookDownloaded: true };
    await capture(session, 'file-delivery');
    if (variant === 'after') {
      await send(session, '2026Q3 CBD 空置率', 'vacancy');
      const vacancyMetric = activeAnswer.getByRole('region', { name: '空置率指标', exact: true });
      await vacancyMetric.waitFor();
      assert.match(await vacancyMetric.innerText(), /17.5/);
      await capture(session, 'vacancy-metric');

      await send(session, '比较 CBD 与金融街的净有效租金', 'regional');
      const regionChart = activeAnswer.getByRole('figure', { name: '同源查询图表', exact: true });
      await regionChart.getByText('CBD', { exact: true }).waitFor();
      await regionChart.getByText('金融街', { exact: true }).waitFor();
      await capture(session, 'regional-comparison');

      await send(session, '净有效租金与空置率的关系', 'relationship');
      const points = activeAnswer.getByRole('img', { name: /有效联合样本/ }).getByRole('button');
      await points.first().waitFor();
      const chartCalls = session.calls.filter(call => call.path === '/api/intelligence/query/artifact' && call.action === 'chart').length;
      await points.first().focus(); await points.first().press('Space');
      const pointReading = activeAnswer.getByRole('status').filter({ has: page.getByRole('button', { name: '数据依据', exact: true }) });
      await pointReading.getByRole('button', { name: '数据依据', exact: true }).click();
      await page.getByRole('region', { name: '来源详情', exact: true }).waitFor();
      await page.getByRole('button', { name: '返回对话', exact: true }).click();
      assert.equal(session.calls.filter(call => call.path === '/api/intelligence/query/artifact' && call.action === 'chart').length, chartCalls, 'point/source roundtrip keeps the rendered snapshot');
      await capture(session, 'relationship-reading');

      await send(session, '生成本次合成研究 PDF', 'pdf');
      const pdfDownload = page.waitForEvent('download');
      await activeAnswer.getByRole('button', { name: '下载 PDF 研究报告', exact: true }).click();
      const pdfFile = await pdfDownload;
      assert.equal(pdfFile.suggestedFilename(), 'fixture.pdf');
      assert.equal(await pdfFile.failure(), null);
      assert.equal((await readFile(await pdfFile.path())).subarray(0, 5).toString(), '%PDF-', 'the interface downloads actual report bytes');
      await activeAnswer.getByText('已发起下载', { exact: true }).waitFor();
      await capture(session, 'pdf-delivery');

      await send(session, '阅读含长标题、表格和未闭合代码的研究回答', 'long-markdown');
      await activeAnswer.getByText('回答目录', { exact: true }).click();
      await settledPaint(page);
      const directoryBefore = await page.locator('#home-query').boundingBox();
      const backgroundBeforeDirectory = await page.evaluate(() => document.querySelector('main > div')?.scrollTop || 0);
      await activeAnswer.getByRole('button', { name: '后续核实', exact: true }).click();
      await settledPaint(page);
      const directoryAfter = await page.locator('#home-query').boundingBox();
      assert.ok(Math.abs(directoryBefore.y - directoryAfter.y) <= 2, `answer directory keeps the composer fixed: ${directoryBefore.y} -> ${directoryAfter.y}`);
      assert.equal(await page.evaluate(() => document.querySelector('main > div')?.scrollTop || 0), backgroundBeforeDirectory, 'directory does not move the page behind the workspace');
      await activeAnswer.getByRole('heading', { name: '后续核实', exact: true }).waitFor();
      assert.equal(await activeAnswer.getByRole('heading', { name: '后续核实', exact: true }).evaluate(node => node === document.activeElement), true);
      assert.match(await activeAnswer.locator('pre').innerText(), /尚未闭合/);
      assert.equal(await activeAnswer.getByRole('table').count(), 1);
      assert.equal(await activeAnswer.getByRole('figure').count(), 0, 'a source-less narrative cannot manufacture a structured chart');
      await capture(session, 'long-markdown');
      session.interactionChecks.additionalAnswerReading = { passed: true, vacancy: true, multipleRegions: true, scatterKeyboardAndSources: true, realPdfDownload: true, longChineseTitle: true, longUrl: true, incompleteMarkdown: true, headingNavigation: true };
    }
    const leaseDetailQuestion = '列出2026年上半年CBD单笔租赁成交按面积排名前十笔。';
    if (variant === 'after') {
      await page.locator('#home-query').focus();
      await page.waitForFunction(() => {
        const surface = document.querySelector('#colliers-ai');
        return ['focus', 'expanded'].includes(surface?.dataset.mode) && surface.dataset.transitioning === 'false';
      });
    }
    const pageBeforeLeaseFailure = page.url();
    const modeBeforeLeaseFailure = await page.locator('#colliers-ai').getAttribute('data-mode');
    await send(session, leaseDetailQuestion, 'failure');
    await page.getByRole('button', { name: '重试本次请求', exact: true }).waitFor();
    await capture(session, 'failure');
    if (variant === 'after') {
      const failed = structuredClone(control.lastBody);
      assert.equal(failed.question, leaseDetailQuestion);
      assert.equal(page.url(), pageBeforeLeaseFailure);
      assert.equal(await page.locator('#colliers-ai').getAttribute('data-mode'), modeBeforeLeaseFailure);
      await page.locator('#home-query').fill('下一条还未提交的问题');
      control.answer = 'lease-unknown';
      const retried = page.waitForResponse(response => new URL(response.url()).pathname === '/api/intelligence/query'
        && response.request().method() === 'POST');
      await page.getByRole('button', { name: '重试本次请求', exact: true }).click();
      const request = (await retried).request().postDataJSON();
      assert.equal(request.question, leaseDetailQuestion);
      assert.equal(request.idempotencyKey, failed.idempotencyKey);
      assert.deepEqual(request.conversation, failed.conversation);
      assert.equal(await page.locator('#home-query').inputValue(), '下一条还未提交的问题');
      assert.equal(page.url(), pageBeforeLeaseFailure);
      session.interactionChecks.leaseDetailFailureRetry = { passed: true, sameIdempotencyKey: true, sameConversation: true, pendingDraftPreserved: true };
    }
    await send(session, '继续查询尚在处理中的结果', 'waiting');
    await capture(session, 'waiting');
    await page.getByRole('button', { name: '停止等待', exact: true }).click();
    control.answer = 'short'; control.release?.();
    await capture(session, 'stopped');
    assert.equal(session.errors.length, 0, session.errors.join('\n'));
    await session.context.close();
    const unavailable = await makePage(width, 'disabled');
    await capture(unavailable, 'permission-unavailable');
    assert.equal(await unavailable.page.locator('#home-query').isDisabled(), true);
    await unavailable.context.close();
  }
  for (const role of process.env.HOME_QUERY_MENU_ONLY === '1' ? [] : ['editor', 'viewer']) {
    const restricted = await makePage(390, 'disabled', role);
    await capture(restricted, `role-${role}`);
    assert.equal(await restricted.page.locator('#home-query').count(), 0);
    assert.ok(!restricted.calls.some(call => call.path.startsWith('/api/intelligence/query')), 'ordinary accounts must not probe AI');
    await restricted.context.close();
  }
} finally { await browser.close(); if (zoomProfile) await rm(zoomProfile, { recursive: true, force: true }); }
assert.ok(records.every(record => Object.values(record.checks).every(Boolean)), 'One or more observed visual/layout checks failed; screenshots and report retain the evidence.');
if (variant === 'after') {
  assert.ok(records.every(record => record.interactionChecks.shortViewportTabCycle?.passed !== false), 'Short viewport keyboard focus reached an invisible control; retained in evidence.');
  assert.ok(records.every(record => record.interactionChecks.longResultTabCycle?.passed !== false), 'Long result keyboard focus did not reveal a control inside its scrollport, escaped the dialog, or scrolled the background; retained in evidence.');
}
