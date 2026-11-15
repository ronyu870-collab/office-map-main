import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseServerTiming } from './server-timing.mjs';

const baseline = process.argv.includes('--baseline');
const versioned = !baseline && !process.argv.includes('--uncached-catalog');
const require = createRequire(import.meta.url);
const admin = '22222222-2222-4222-8222-222222222222';
const viewer = '33333333-3333-4333-8333-333333333333';
const peer = '44444444-4444-4444-8444-444444444444';
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const browserToken = id => `${encode({ alg: 'HS256' })}.${encode({ sub: id, exp: expires_at, aud: 'authenticated', session_id: id })}.fixture`;
const project = '11111111-1111-4111-8111-111111111111';
const text = '隔离客户需要北京望京写字楼，交通便利';
const buildings = [{ id: project, name: '隔离望京中心', grade: 'A', district: '朝阳区', submarket: '望京' },
  { id: '11111111-1111-4111-8111-111111111112', name: '隔离海淀大厦', grade: 'B', district: '海淀区', submarket: '中关村' }];
for (let i = 0; i < 620; i++) buildings.push({
  id: `11111111-1111-4111-8112-${String(i + 1).padStart(12, '0')}`,
  name: `隔离海淀项目 ${i + 1}`, grade: 'B', district: '海淀区', submarket: '中关村',
});
const metric = { building_id: project, record_year: 2026, record_quarter: 3, asking_rent: 180, net_effective_rent: 155, vacancy_rate: 0.08 };
const brochure = { building_id: project, address: '隔离示例地址', metro_access: '距地铁300米', standard_floor_area: 2000 };
const metricRows = buildings.map(({ id }) => ({ ...metric, building_id: id }));
const brochureRows = buildings.slice(0, 370).map(({ id }) => ({ ...brochure, building_id: id }));
const parsed = {
  city: '北京', locations: [{ raw: '望京', kind: 'submarket', normalizedDistrict: null, normalizedSubmarket: '望京' }],
  area: { minSqm: null, maxSqm: null }, rent: { minDailyRmbSqm: null, maxDailyRmbSqm: null, basis: 'unspecified' },
  moveInMonth: null, grades: [], metro: { preferred: true, maxDistanceMeters: null },
  greenCertifications: [], otherPreferences: [], unresolved: [],
};
const modelResult = { status: 'completed', model: 'fixture-model', usage: { input_tokens: 400, output_tokens: 160 },
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(parsed) }] }] };
const probes = [];
let probe;
let options = {};
let closedModel = 0;
const fixture = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://127.0.0.1');
  const send = (status, payload) => {
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  async function body() {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  if (pathname === '/auth/v1/user') {
    const id = [admin, viewer].find(id => req.headers.authorization === `Bearer ${browserToken(id)}`) ??
      ({ 'Bearer synthetic-admin': admin, 'Bearer synthetic-admin-refresh': admin,
        'Bearer synthetic-peer': peer, 'Bearer synthetic-viewer': viewer })[req.headers.authorization];
    return id ? send(200, { id, email: 'fixture@example.test', aud: 'authenticated' }) : send(401, {});
  }
  if (pathname === '/rest/v1/user_roles') {
    const user = [admin, peer, viewer].find(id => searchParams.get('user_id') === `eq.${id}`);
    return send(200, user ? [{ user_id: user, role: user === viewer ? 'viewer' : 'admin', email: 'fixture@example.test' }] : []);
  }
  const current = probe;
  const runOptions = options;
  if (pathname === '/rest/v1/rpc/intelligence_recommendation_catalog') {
    const input = await body();
    assert.deepEqual(Object.keys(input), ['p_known_version']);
    const known = input.p_known_version;
    current.catalogs.push(known);
    if (runOptions.missingCatalog) return send(404, { code: 'PGRST202', message: 'fixture migration not applied' });
    if (runOptions.failBuildings) return send(500, { message: 'fixture catalog unavailable' });
    if (runOptions.invalidCatalog) return send(200, { version: '0'.repeat(64), rows: null });
    const rows = runOptions.rename ? [{ ...buildings[0], name: runOptions.rename }, ...buildings.slice(1)] : buildings;
    const version = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    const response = { version, rows: known === version ? null : rows };
    current.catalogBytes += Buffer.byteLength(JSON.stringify(response));
    return send(200, response);
  }
  if (pathname === '/rest/v1/buildings') {
    const offset = Number(searchParams.get('offset') ?? 0);
    const select = searchParams.get('select');
    current.buildings.push({ offset, select });
    if (runOptions.failBuildings) return send(500, { message: 'fixture catalog unavailable' });
    const rows = buildings.slice(offset, offset + (runOptions.cap ?? 1000));
    if (req.headers.prefer?.includes('count=exact')) res.setHeader('Content-Range', `${offset}-${offset + rows.length - 1}/${buildings.length}`);
    const payload = select === 'district,submarket,grade' ? rows.map(({ district, submarket, grade }) => ({ district, submarket, grade })) : rows;
    current.catalogBytes += Buffer.byteLength(JSON.stringify(payload));
    return send(200, payload);
  }
  if (pathname === '/rest/v1/building_metrics') {
    const period = searchParams.get('select') === 'record_year,record_quarter';
    current.metrics.push(period ? 'period' : 'evidence');
    if (period) return send(200, [{ record_year: metric.record_year, record_quarter: runOptions.quarter ?? metric.record_quarter }]);
    await delay(430);
    current.evidenceReady++;
    return send(200, runOptions.quarter ? metricRows.map(row => ({ ...row, record_quarter: runOptions.quarter })) : metricRows);
  }
  if (pathname === '/rest/v1/building_brochure_data') {
    current.brochure++;
    await delay(370);
    current.evidenceReady++;
    return send(200, brochureRows);
  }
  if (pathname === '/responses') {
    const input = await body();
    current.models.push({ model: input.model, vocabularyOk: input.input.includes('Allowed submarkets: ["望京","中关村"]'),
      requirementMatched: input.input.endsWith(runOptions.text ?? text), evidenceReady: current.evidenceReady });
    res.once('close', () => { if (!res.writableFinished) closedModel++; });
    if (runOptions.rejectModels) return send(403, { error: { message: runOptions.text ?? text } });
    if (runOptions.tryFallback && current.models.length === 1) return send(502, { error: { message: 'fixture transient' } });
    await delay(runOptions.modelMs ?? 560);
    if (runOptions.parseBudget) {
      return send(200, { ...modelResult, output: [{ type: 'message', content: [{ type: 'output_text',
        text: JSON.stringify({ ...parsed, rent: { minDailyRmbSqm: 5, maxDailyRmbSqm: null, basis: 'net_effective' } }),
      }] }] });
    }
    return send(200, modelResult);
  }
  if (pathname === '/rest/v1/audit_logs' && req.method === 'POST') {
    const row = await body();
    current.audits.push(row);
    return send(201, {});
  }
  return send(404, {});
});
function reset(next = {}) {
  options = next;
  probe = { buildings: [], catalogs: [], catalogBytes: 0, metrics: [], brochure: 0, evidenceReady: 0, models: [], audits: [] };
  return probe;
}
async function portFor(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
function close(server) { return new Promise(resolve => server.close(resolve)); }

async function verifyBrowser(origin, path) {
  const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
  const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
  const observations = [];
  try {
    for (const [width, id] of [[1280, admin], [390, admin], ...baseline ? [] : [[390, viewer]]]) {
      const role = id === admin ? 'admin' : 'viewer';
      const user = { id, email: 'fixture@example.test', app_metadata: {}, user_metadata: {} };
      const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: browserToken(id) };
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390, serviceWorkers: 'block' });
      const first = reset();
      try {
        await context.routeWebSocket(/.*/, socket => socket.close());
        await context.route('**/*', async route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin === origin) return url.pathname !== path && url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
          if (url.origin !== 'https://example.supabase.co') return route.abort();
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': '*' };
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
          if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ user_id: id, role, session_id: id }] });
          if (url.pathname === '/rest/v1/buildings') return route.fulfill({ headers, json: buildings });
          if (url.pathname === '/rest/v1/building_metrics') return route.fulfill({ headers, json: [metric] });
          if (url.pathname === '/rest/v1/building_brochure_data') return route.fulfill({ headers, json: [brochure] });
          return route.fulfill({ headers, json: [] });
        });
        await context.addInitScript(({ origin, session }) => {
          if (location.origin !== origin) return;
          localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
          localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
        }, { origin, session });
        const page = await context.newPage();
        page.setDefaultTimeout(8500);
        await page.goto(origin + '/intelligence', { waitUntil: 'domcontentloaded' });
        const input = page.locator('textarea');
        const leaseExpiry = page.getByRole('link', { name: '预计到期线索（管理员试点）' });
        if (id === viewer) {
          await page.getByText('业务智能正在内部验证').waitFor();
          assert.equal(await leaseExpiry.count(), 0, 'viewers never see the F6 pilot entry');
          assert.equal(await input.count() + first.models.length + first.buildings.length + first.catalogs.length, 0);
          observations.push({ width, role, protectedReads: 0 });
          continue;
        }
        await input.waitFor();
        if (baseline && process.env.PERF_EXPECT_F6_ENTRY === '1') {
          await leaseExpiry.waitFor();
          assert.equal(await leaseExpiry.getAttribute('href'), '/intelligence/lease-expiry');
        } else if (!baseline) {
          assert.equal(await leaseExpiry.count(), 0, 'expiry has moved out of business intelligence');
          assert.equal(await page.locator('a[href="/lease-submission/expiry"]').count(), 0, 'the new leasing entry is not duplicated in AI');
        }
        await input.fill(text);
        assert.equal(first.models.length + first.buildings.length + first.catalogs.length, 0, 'editing alone never starts the recommendation');
        await page.getByRole('button', { name: '开始推荐' }).click();
        const cancel = page.getByRole('button', { name: '取消推荐' });
        if (baseline) assert.equal(await cancel.count(), 0);
        else {
          await cancel.waitFor();
          if (width === 390) assert.ok((await cancel.boundingBox()).height >= 44);
        }
        const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: buildings[0].name }) });
        await card.waitFor();
        await card.getByText('8.0%', { exact: true }).waitFor();
        assert.equal(first.audits.length, 1);
        await card.getByRole('button', { name: '展开分析' }).click();
        await card.getByText('评分构成').waitFor();
        const preselected = card.getByRole('button', { name: 'AI 预选' });
        await preselected.click();
        await card.getByRole('button', { name: '加入方案' }).click();
        await card.getByRole('button', { name: '已确认' }).waitFor();
        if (process.env.PERF_INTELLIGENCE_SCREENSHOT_DIR) await page.screenshot({
          path: join(process.env.PERF_INTELLIGENCE_SCREENSHOT_DIR, `intelligence-result-${baseline ? 'before' : 'after'}-${width}.png`),
        });
        if (!baseline) {
          const updated = `${text}，客户补充意见`;
          const slow = reset({ modelMs: 5000, text: updated });
          await input.fill(updated);
          await page.getByRole('button', { name: '重新推荐' }).click();
          await page.getByText('正在生成新推荐，下方仍是上一轮结果。').waitFor();
          for (let i = 0; i < 80 && !slow.models.length; i++) await delay(25);
          assert.equal(slow.models.length, 1);
          const before = closedModel;
          await cancel.click();
          await page.getByText('已取消推荐，需求文字已保留。').waitFor();
          for (let i = 0; i < 80 && closedModel === before; i++) await delay(25);
          assert.ok(closedModel > before);
          assert.equal(slow.audits.length, 0);
          assert.equal(await input.inputValue(), updated);
          await card.getByRole('button', { name: '已确认' }).waitFor();
          const failed = reset({ rejectModels: true, text: updated });
          await page.getByRole('button', { name: '重新推荐' }).click();
          await page.getByRole('alert').filter({ hasText: 'DeepSeek 请求失败' }).waitFor();
          assert.equal(failed.audits.length, 0);
          await card.getByRole('button', { name: '已确认' }).waitFor();
        }
        await page.evaluate(() => {
          window.__fixtureProposalWrites = 0;
          window.addEventListener('intelligence-proposal-draft-changed', () => window.__fixtureProposalWrites++);
        });
        await page.getByRole('button', { name: '生成方案（1个）' }).click();
        await page.waitForURL(origin + '/intelligence/proposal');
        const draft = await page.evaluate(oldStorage => {
          const record = JSON.parse(sessionStorage.getItem(`colliers:intelligence-proposal-draft:${oldStorage ? 'v1' : 'v2'}`));
          return oldStorage ? record : record?.draft;
        }, baseline);
        assert.deepEqual(draft.items.map(row => row.buildingId), [project]);
        assert.equal(draft.requirement.parsed.locations[0].normalizedSubmarket, '望京');
        await page.getByRole('heading', { name: buildings[0].name }).waitFor();
        assert.equal(await page.evaluate(() => window.__fixtureProposalWrites), baseline ? 2 : 1);
        observations.push({ width, role, cancelAvailable: !baseline, priorSelectionKept: true, proposalSelection: draft.items.length });
      } finally { await context.close(); }
    }
    return { browser: browser.version(), observations };
  } finally { await browser.close(); }
}
let child;
try {
  const fixturePort = await portFor(fixture);
  const reserve = createServer();
  const port = await portFor(reserve);
  await close(reserve);
  const upstream = `http://127.0.0.1:${fixturePort}`;
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: upstream, SUPABASE_SECRET_KEY: 'synthetic',
    DEEPSEEK_API_BASE_URL: upstream, DEEPSEEK_API_KEY: 'synthetic', DEEPSEEK_MODEL: 'fixture-primary',
    DEEPSEEK_FALLBACK_MODEL: 'fixture-fallback', PERF_ISOLATED_SERVER_TIMING: 'local' };
  delete env.VERCEL;
  delete env.VERCEL_ENV;
  child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-3000); });
  const path = '/api/intelligence/recommend';
  const parsePath = '/api/intelligence/parse-requirement';
  const submit = (route = path, token = 'synthetic-admin', requirement = text, signal = AbortSignal.timeout(7000), extra = {}) => fetch(origin + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: JSON.stringify({ requirement }), signal,
  });
  reset();
  let denied;
  for (let i = 0; i < 40 && child.exitCode === null; i++) {
    denied = await submit(path, '').catch(() => null);
    if (denied) break;
    await delay(150);
  }
  assert.equal(denied?.status, 401, logs);
  assert.equal((await submit(path, 'synthetic-viewer')).status, 403, 'preview off must deny viewers');
  assert.equal((await submit(path, 'synthetic-admin', text, undefined, { 'x-colliers-impersonate-user': viewer })).status, 403);
  assert.equal((await submit(path, 'synthetic-admin', 'x')).status, 400);
  assert.equal(probe.buildings.length + probe.catalogs.length + probe.models.length + probe.audits.length, 0);
  for (let round = 0; round < 5; round++) {
    const measured = reset();
    const before = performance.now();
    const response = await submit();
    assert.equal(response.status, 200, logs);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    const stages = parseServerTiming(path, response.headers.get('server-timing'));
    assert.ok(stages && stages.model > 0 && stages.candidates > 0 && stages.audit >= 0);
    assert.equal(result.meta.latestMetricPeriod, '2026 Q3');
    assert.equal(result.meta.universeCount, buildings.length);
    assert.equal(result.plan.candidateCount, 1);
    assert.deepEqual(result.plan.recommendations.map(row => [row.id, row.metricPeriod, row.brochure.address]), [[project, '2026 Q3', brochure.address]]);
    assert.equal(measured.buildings.length, baseline ? 2 : versioned ? 0 : 1);
    assert.equal(measured.catalogs.length, versioned ? 1 : 0);
    if (versioned) {
      if (round === 0) assert.equal(measured.catalogs[0], null);
      else {
        assert.match(measured.catalogs[0], /^[a-f0-9]{64}$/);
        assert.ok(measured.catalogBytes < probes[0].catalogBytes / 100);
      }
    }
    assert.deepEqual(measured.metrics.sort(), baseline ? ['evidence', 'period'] : ['evidence']);
    assert.equal(measured.models.length, 1);
    assert.equal(measured.models[0].vocabularyOk, true);
    assert.equal(measured.models[0].requirementMatched, true);
    assert.equal(measured.models[0].evidenceReady, baseline ? 2 : 0, 'the model can start before independent evidence is ready');
    assert.equal(measured.audits.length, 1);
    assert.equal(measured.audits[0].user_id, admin);
    assert.equal(measured.audits[0].action_type, 'AI_RECOMMENDATION');
    assert.ok(!JSON.stringify(measured.audits).includes(text));
    const buildingReads = measured.buildings.length + measured.catalogs.length;
    probes.push({ totalMs: Math.round(performance.now() - before), stages, buildingReads, catalogBytes: measured.catalogBytes,
      totalSourceReads: buildingReads + measured.metrics.length + measured.brochure, modelStartedBeforeEvidence: measured.models[0].evidenceReady === 0 });
  }
  if (versioned) {
    const previous = reset({ rename: '隔离望京中心新版', quarter: 4, modelMs: 10 });
    const response = await submit();
    assert.equal(response.status, 200, logs);
    const result = await response.json();
    assert.match(previous.catalogs[0], /^[a-f0-9]{64}$/);
    assert.equal(result.plan.recommendations[0].name, options.rename);
    assert.equal(result.meta.latestMetricPeriod, '2026 Q4');
    const latest = reset({ rename: '隔离望京中心新版', quarter: 3, modelMs: 10 });
    const newer = await submit();
    assert.equal(newer.status, 200, logs);
    assert.equal((await newer.json()).meta.latestMetricPeriod, '2026 Q3', 'the catalog hit must never cache evidence or periods');
    assert.notEqual(latest.catalogs[0], previous.catalogs[0]);
    assert.ok(latest.catalogBytes < 120);
    for (const [token, extra] of [['synthetic-peer', {}], ['synthetic-admin-refresh', {}],
      ['synthetic-admin', { 'x-colliers-impersonate-user': peer }]]) {
      const isolated = reset({ modelMs: 10 });
      const response = await submit(path, token, text, undefined, extra);
      assert.equal(response.status, 200, logs);
      assert.deepEqual(isolated.catalogs, [null], 'account, login and effective identity scopes must start cold');
      assert.equal(isolated.models.length, 1);
      assert.equal(isolated.audits[0].user_id, token === 'synthetic-peer' ? peer : admin);
    }
    const invalid = reset({ invalidCatalog: true });
    assert.equal((await submit()).status, 500);
    assert.equal(invalid.models.length + invalid.audits.length, 0);
  }
  const failure = reset({ failBuildings: true });
  assert.equal((await submit()).status, 500);
  assert.equal(failure.models.length + failure.audits.length, 0, 'catalog failure must not send the private text to the model');
  if (!baseline) {
    const capped = reset({ cap: 400, missingCatalog: true, tryFallback: true, text: `${text}；只用于隔离回归` });
    const capResponse = await submit(path, 'synthetic-admin', options.text);
    assert.equal(capResponse.status, 200, logs);
    assert.equal((await capResponse.json()).meta.universeCount, buildings.length);
    assert.deepEqual(capped.buildings.map(row => row.offset), [0, 400]);
    assert.deepEqual(capped.models.map(row => [row.model, row.requirementMatched]), [['fixture-primary', true], ['fixture-fallback', true]]);
    assert.equal(capped.audits.length, 1);
    const rejected = reset({ rejectModels: true, text: `${text}；不应回显` });
    const rejectedResponse = await submit(path, 'synthetic-admin', options.text);
    assert.equal(rejectedResponse.status, 503);
    assert.ok(!(await rejectedResponse.text()).includes(options.text));
    assert.equal(rejected.models.length, 1);
    assert.equal(rejected.audits.length, 0);
    const cancel = reset({ modelMs: 5000 });
    const controller = new AbortController();
    const canceled = submit(path, 'synthetic-admin', text, controller.signal);
    const outcome = assert.rejects(canceled, { name: 'AbortError' });
    for (let i = 0; i < 80 && !cancel.models.length; i++) await delay(25);
    assert.equal(cancel.models.length, 1, logs);
    controller.abort();
    await outcome;
    for (let i = 0; i < 80 && !closedModel; i++) await delay(25);
    assert.ok(closedModel > 0, 'client cancellation reaches the active model request');
    assert.equal(cancel.audits.length, 0);
  }
  const parse = reset({ modelMs: 10, quarter: 4, parseBudget: true });
  const parseResponse = await submit(parsePath);
  assert.equal(parseResponse.status, 200, logs);
  const parseResult = await parseResponse.json();
  assert.deepEqual(parseResult.parsed.locations, parsed.locations);
  assert.deepEqual(parse.metrics, ['period']);
  if (versioned) {
    assert.match(parse.catalogs[0], /^[a-f0-9]{64}$/);
    assert.ok(parse.catalogBytes < 120);
    assert.equal(parseResult.capabilities.find(row => row.key === 'rent')?.dataBasis, 'building_metrics.net_effective_rent · 2026 Q4');
  }
  assert.equal(parse.audits[0].action_type, 'AI_REQUIREMENT_PARSE');
  const sorted = probes.map(row => row.totalMs).sort((a, b) => a - b);
  const browser = await verifyBrowser(origin, path);
  console.log(JSON.stringify({ status: 'pass', baseline, versioned, scenario: 'isolated production Next route, held evidence and synthetic model',
    fixtureRows: { buildings: buildings.length, metrics: metricRows.length, brochures: brochureRows.length },
    medianMs: sorted[Math.floor(sorted.length / 2)], probes, browser, rejectionProtected: true, modelCancelReachedProvider: !baseline }, null, 2));
} finally {
  if (child && child.exitCode === null) {
    const done = once(child, 'exit');
    child.kill('SIGTERM');
    await done;
  }
  fixture.closeAllConnections();
  await close(fixture);
}
