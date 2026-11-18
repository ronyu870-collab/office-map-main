import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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
const widths = (process.env.HOME_QUERY_P2_WIDTHS || '1280,1536,768,390,320').split(',').map(Number);
assert.ok(widths.every(width => [1280,1536,768,390,320].includes(width)));
await mkdir(out, { recursive: true });
const sourceRequire = createRequire(`${sourceRoot}/package.json`);
const screenshotPixels = sourceRequire('sharp');
sourceRequire('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' } });
const { fixture } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/__tests__/fixtures.ts`);
const { buildAggregateResult, buildTrendResult } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/result.ts`);
const { attachResearchAnalysis } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/researchAnalysis.ts`);
const { buildResultChart } = sourceRequire(`${sourceRoot}/src/lib/intelligence/query/charts.ts`);
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
const trend = stableResult(attachResearchAnalysis(buildTrendResult(snapshots, 'rent', 'paired'), snapshots), '22222222-2222-4222-8222-222222222222');
const historyEntries = ['CBD 季度租金跟踪', '金融街与 CBD 区域对比', '北京办公楼空置率研究'].map((title, index) => ({
  conversationId: `33333333-3333-4333-8333-33333333333${index}`, title, updatedAt: '2026-11-17T02:30:00Z', latestQuestion: index ? '比较当前获权区域的季度指标，并核对统计样本。' : '2026Q3 CBD 净有效租金是多少？', requestId, archived: false,
}));
const notices = [{ id: 1, content: '季度数据已更新，请核对负责楼宇的填报进度。', updated_at: '2026-11-17T02:00:00Z', is_active: true }, { id: 2, content: '地图支持查看楼宇照片、租赁成交及历史季度指标。', updated_at: '2026-11-16T02:00:00Z', is_active: true }];
const records = [];
const fixtureDigest = createHash('sha256').update(JSON.stringify({ examples, aggregate, trend, historyEntries, notices })).digest('hex');
const baseline = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDiff = execFileSync('git', ['-C', sourceRoot, 'diff', '--', 'src/components/home', 'src/styles/tokens.css'], { encoding: 'utf8' });
const sourceDiffSha256 = createHash('sha256').update(sourceDiff).digest('hex');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_EXECUTABLE ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE } : process.env.PERF_BROWSER_CHANNEL && process.env.PERF_BROWSER_CHANNEL !== 'chromium' ? { channel: process.env.PERF_BROWSER_CHANNEL } : {}), headless: true });

async function makePage(width, capability = 'enabled', role = 'admin') {
  const height = width === 768 ? 1024 : width < 640 ? 844 : 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const calls = [], errors = [];
  const control = { answer: 'short', release: null, currentResult: aggregate, lastBody: null };
  // Keep localhost's development HMR transport; only the synthetic Supabase
  // realtime transport is closed. Production mode does not require HMR.
  await context.routeWebSocket(/^wss:\/\/example\.supabase\.co/, ws => ws.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    calls.push({ path: url.pathname, method: request.method(), action: body?.action });
    const json = data => route.fulfill({ json: data });
    if (url.origin === new URL(base).origin) {
      if (url.pathname === '/api/intelligence/query/capabilities') return capability === 'error'
        ? route.fulfill({ status: 503, json: { error: 'synthetic capability unavailable' } })
        : json({ enabled: capability === 'enabled', permissionRevision: 'synthetic-visual-v1', examples: capability === 'enabled' ? examples : [], internalExport: true });
      if (url.pathname === '/api/intelligence/query/history') {
        if (body.action === 'list') return json({ status: 'ready', page: { entries: historyEntries.filter(entry => entry.title.includes(body.search || '') || entry.latestQuestion.includes(body.search || '')), hasMore: false, indexing: false, unavailable: 0 } });
        if (body.action === 'open') return json({ status: 'ready', opened: { conversation: { id: body.conversationId, parentRequestId: requestId, resumeToken: 'synthetic-resume' }, title: historyEntries[0].title, turns: [{ requestId, question: '2026Q3 CBD 净有效租金是多少？', submittedAt: '2026-11-17T02:30:00Z', state: 'ready' }], selected: { requestId, question: '2026Q3 CBD 净有效租金是多少？', submittedAt: '2026-11-17T02:30:00Z', state: 'ready', reply: { requestId, status: 'ready', result: aggregate } }, hasMore: false } });
        return json({ status: 'saved' });
      }
      if (url.pathname === '/api/intelligence/query/artifact') {
        if (body.action === 'chart') return json({ status: 'ready', chart: buildResultChart(control.currentResult, body.chart) });
        if (body.action === 'copy') return json({ status: 'ready', requestId: body.requestId, resultId: body.resultId, format: body.format, text: '合成视觉夹具的研究结论。', resultDigest: 'a'.repeat(64) });
        return route.fulfill({ status: 503, json: { error: 'Visual fixture does not implement file export; original export regressions remain required.' } });
      }
      if (url.pathname === '/api/intelligence/query/receipt') return json({ status: 'recorded' });
      if (url.pathname === '/api/intelligence/query') {
        control.lastBody = body;
        if (control.answer === 'waiting') await new Promise(done => { control.release = done; });
        const shared = { requestId, conversation: body.conversation, options: [] };
        if (control.answer === 'failure') return json({ ...shared, status: 'unavailable' });
        if (control.answer === 'clarification') return json({ ...shared, status: 'clarification', reason: 'period_required', message: '你想查看哪个季度的净有效租金？选择季度后，我会按当前获权样本继续查询。', options: [{ id: 'quarter', label: '2026 年第三季度', question: '2026Q3 CBD 净有效租金' }] });
        if (control.answer === 'aggregate' || control.answer === 'complex') {
          control.currentResult = control.answer === 'aggregate' ? aggregate : trend;
          return json({ ...shared, status: 'ready', historySaved: true, result: control.currentResult });
        }
        return json({ ...shared, status: 'clarification', reason: 'assistant_help', message: '你好！我可以帮你查找北京办公楼，分析市场租金、空置率和季度变化。你可以从一个项目或区域开始。' });
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
  page.on('pageerror', error => errors.push(error.message));
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
    return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth, surface: rect(document.querySelector('#colliers-ai')), input: rect(input), composer: rect(composer), dialog: rect(dialog), inputCount: document.querySelectorAll('#home-query').length, nav: rect(document.querySelector('[aria-label="业务入口"]')), activeElement: document.activeElement?.id, colors: { page: getComputedStyle(document.querySelector('main')).backgroundColor, workspace: getComputedStyle(document.querySelector('#colliers-ai') || document.body).backgroundColor, composer: composer ? getComputedStyle(composer).backgroundColor : null } };
  });
  const checks = { pageOverflow: metrics.scrollWidth <= width, singleInput: role !== 'admin' ? metrics.inputCount === 0 : metrics.inputCount === 1, expandedInputWithinViewport: !metrics.dialog || !metrics.input || (metrics.input.y >= -1 && metrics.input.bottom <= height + 1) };
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
  await writeFile(`${out}/${variant}-browser.json`, JSON.stringify({ variant, baseline, sourceRoot, sourceDiffSha256, fixtureDigest, browser: browser.version(), recordCount: records.length, screenshots: 'Full page; fonts ready and at least two animation frames after scrolling; Playwright animations disabled for stable finite animation endpoints; no CSS injection', environment: `Next ${buildMode} server; real React DOM; synthetic session and intercepted HTTP; no production writes`, limitations: ['Not a real authentication/DB test', 'Not physical iOS/Android; no real soft keyboard or file handling', 'No quantitative production performance claim', 'Chart geometry and raster ink checks supplement, rather than replace, independent visual review'], records }, null, 2));
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
    }, trend.table.rows.length, { timeout: 10000 });
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
  await session.page.getByRole('button', { name: '发送问题', exact: true }).click();
  if (kind === 'waiting') await session.page.getByRole('button', { name: '停止等待', exact: true }).waitFor();
  else await session.page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
}
async function expanded(page, open) {
  await page.getByRole('button', { name: open ? '展开 Colliers AI 工作空间' : '收起 Colliers AI 工作空间', exact: true }).click();
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
      const active = await focusedControl(page);
      if (!active.visible || !active.withinDialog) issues.push({ direction, step, active });
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
    await capture(session, 'welcome');
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
    session.interactionChecks = { continuousInputAndCursor: true, syntheticCompositionEnterGuard: true };
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
    await page.getByText('你好！我可以帮你查找北京办公楼，分析市场租金、空置率和季度变化。你可以从一个项目或区域开始。', { exact: true }).waitFor();
    await capture(session, 'short-answer');
    await send(session, '查看 CBD 的净有效租金', 'clarification');
    await page.getByRole('button', { name: '2026 年第三季度', exact: true }).waitFor();
    await capture(session, 'clarification');
    await send(session, '2026Q3 CBD 净有效租金', 'aggregate');
    await page.getByRole('region', { name: '核心指标', exact: true }).waitFor();
    await capture(session, 'data-result');
    await page.getByRole('region', { name: '查询结果', exact: true }).last().evaluate(node => node.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await capture(session, 'data-summary');
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
    await checkLongResultFocus(session);
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
    await page.getByRole('button', { name: '研究资料', exact: true }).click();
    await page.getByRole('region', { name: '对话记录', exact: true }).evaluate(node => { node.scrollTop = 0; });
    await capture(session, 'expanded-multiturn');
    await expanded(page, false);
    await send(session, '查看新的分析', 'failure');
    await page.getByRole('button', { name: '重试本次请求', exact: true }).waitFor();
    await capture(session, 'failure');
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
  for (const role of ['editor', 'viewer']) {
    const restricted = await makePage(390, 'disabled', role);
    await capture(restricted, `role-${role}`);
    assert.equal(await restricted.page.locator('#home-query').count(), 0);
    assert.ok(!restricted.calls.some(call => call.path.startsWith('/api/intelligence/query')), 'ordinary accounts must not probe AI');
    await restricted.context.close();
  }
} finally { await browser.close(); }
assert.ok(records.every(record => Object.values(record.checks).every(Boolean)), 'One or more observed visual/layout checks failed; screenshots and report retain the evidence.');
if (variant === 'after') {
  assert.ok(records.every(record => record.interactionChecks.shortViewportTabCycle?.passed !== false), 'Short viewport keyboard focus reached an invisible control; retained in evidence.');
  assert.ok(records.every(record => record.interactionChecks.longResultTabCycle?.passed !== false), 'Long result keyboard focus did not reveal a control inside its scrollport, escaped the dialog, or scrolled the background; retained in evidence.');
}
