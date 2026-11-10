import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { mapStartupStages, observeNavigation } from './readiness.mjs';
import { isMeasuredApi, parseServerTiming } from './server-timing.mjs';

// One explicitly prepared journey per invocation. Bulk production sampling is excluded.
const [contractFile, outputFile] = process.argv.slice(2);
if (!contractFile || !outputFile) throw new Error('Usage: capture-navigation.mjs contract.json output.json');
const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
for (const key of ['source_url', 'shell', 'content', 'scenario', 'environment', 'commit', 'role_class', 'device', 'network', 'cache_state']) {
  if (!contract[key]) throw new Error(`Missing scenario contract: ${key}`);
}
const source = new URL(contract.source_url);
if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) throw new Error('Invalid source URL');
const action = contract.action ?? 'click';
if (!['click', 'open', 'reload'].includes(action) || (action === 'click' && !contract.trigger)) {
  throw new Error('Expected click with a trigger, open, or reload');
}
const destination = new URL(contract.destination_url ?? source.href, source);
if (destination.origin !== source.origin || destination.username || destination.password) {
  throw new Error('Document destination must be on the source origin');
}
if (contract.map_stages !== undefined && (typeof contract.map_stages !== 'boolean' ||
  (contract.map_stages && destination.pathname !== '/map'))) throw new Error('Map stages require a /map destination');
const prepare = contract.prepare ?? 'manual';
if (!['manual', 'none'].includes(prepare) || (prepare === 'none' && action !== 'open')) {
  throw new Error('Skipping preparation requires an open action');
}
const resourceCache = contract.resource_cache ?? 'default';
if (!['default', 'disabled'].includes(resourceCache)) throw new Error('Invalid resource cache mode');
if (contract.server_timing !== undefined && typeof contract.server_timing !== 'boolean') throw new Error('Invalid server timing mode');
const timeout = contract.timeout_ms ?? 30_000;
if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 120_000) throw new Error('Invalid sample timeout');
const require = createRequire(import.meta.url);
const { chromium } = process.env.PERF_PLAYWRIGHT_MODULE
  ? require(process.env.PERF_PLAYWRIGHT_MODULE) : require('playwright-core');
const browser = await chromium.launch({
  ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }),
  headless: prepare === 'none' && process.env.PERF_CAPTURE_HEADLESS === '1',
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  if (prepare === 'manual') await page.goto(source.href);
  if (prepare === 'manual' && contract.ready_selector) {
    console.log('请在新窗口自行登录；检测到指定首页入口后，将自动采集一次只读导航。');
    await page.locator(contract.ready_selector).waitFor({ state: 'visible', timeout: 300_000 });
  } else if (prepare === 'manual') {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    await prompt.question('请在浏览器自行登录并准备指定场景。不要在终端输入凭据。准备好后按回车：');
    prompt.close();
  }
  if (action === 'reload' && (new URL(page.url()).origin !== destination.origin ||
    new URL(page.url()).pathname !== destination.pathname)) throw new Error('Prepare the reload on the destination page');
  if (resourceCache === 'disabled') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  const requests = [];
  const requestRecords = new Map();
  const responseReads = [];
  let documentRequests = 0;
  const publicRoutes = new Set(['/', '/map', '/compare', '/oss', '/update', '/lease-submission',
    '/lease-submission/history', '/lease-submission/monitoring', '/admin', '/admin/display-overrides',
    '/settings', '/intelligence', '/intelligence/proposal', '/login', '/occupier-insights', '/md-20260928/map']);
  const apiFamilies = new Set(['admin', 'audit-events', 'auth', 'brokers', 'health', 'intelligence',
    'lease-submission', 'lease-transactions', 'map', 'oss', 'submissions']);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (request.isNavigationRequest()) {
      try {
        if (request.frame() === page.mainFrame()) documentRequests++;
      } catch {
        // A request without a frame must not be mistaken for the main document.
      }
    }
    // No headers, credentials, query values, business paths, or response bodies.
    const family = url.pathname.split('/')[2];
    const category = url.origin === source.origin
      ? url.pathname.startsWith('/api/') ? (apiFamilies.has(family) ? 'api:' + family : 'api:other')
        : url.pathname.startsWith('/_next/') ? 'next-asset'
          : publicRoutes.has(url.pathname) ? 'route:' + url.pathname : 'same-origin-other'
      : /(^|\.)supabase\.co$/.test(url.hostname) ? 'supabase'
        : /(^|\.)amap\.com$/.test(url.hostname) ? 'amap'
          : /(^|\.)aliyuncs\.com$/.test(url.hostname) ? 'aliyun' : 'external';
    const record = { category, method: request.method(), status: null,
      resource_type: request.resourceType(), is_rsc: url.searchParams.has('_rsc'),
      timing: null, encoded_body_bytes: null, failed: false };
    requests.push(record);
    requestRecords.set(request, record);
  });
  page.on('response', (response) => {
    const record = requestRecords.get(response.request());
    if (!record) return;
    record.status = response.status();
    if (!contract.server_timing || !response.ok()) return;
    const url = new URL(response.url());
    if (url.origin !== source.origin || !isMeasuredApi(url.pathname)) return;
    responseReads.push(response.headerValue('server-timing').then(header => {
      record.server_timing_ms = parseServerTiming(url.pathname, header);
    }).catch(() => { record.server_timing_ms = null; }));
  });
  page.on('requestfinished', (request) => {
    const record = requestRecords.get(request);
    if (record) {
      record.timing = request.timing();
      responseReads.push(request.sizes().then(sizes => {
        if (sizes.responseBodySize >= 0) record.encoded_body_bytes = sizes.responseBodySize;
      }).catch(() => undefined));
    }
  });
  page.on('requestfailed', (request) => {
    const record = requestRecords.get(request);
    if (record) record.failed = true;
  });
  const browserContract = { ...contract, action, timeout_ms: timeout,
    destination_origin: destination.origin, destination_pathname: destination.pathname,
    map_stage_names: contract.map_stages ? mapStartupStages : null };
  if (action === 'click') await page.evaluate(observeNavigation, browserContract);
  else await page.addInitScript(observeNavigation, browserContract);
  let failure = null;
  try {
    if (action === 'click') await page.locator(contract.trigger).click({ timeout });
    else if (action === 'open') await page.goto(destination.href, { waitUntil: 'commit', timeout });
    else await page.reload({ waitUntil: 'commit', timeout });
    await page.waitForFunction(() => ['success', 'timeout', 'application_error', 'preexisting_content'].includes(window.__colliersNavigationProbe?.result.status),
      null, { timeout: timeout + 5000 });
  } catch (error) {
    // Error messages may include page text/URLs. Store only the controlled class.
    failure = error.name;
  }
  const observed = await page.evaluate(() => {
    const probe = window.__colliersNavigationProbe;
    if (!probe) return null;
    probe.stop();
    return probe.result;
  }).catch(() => null);
  const replaced = documentRequests !== (action === 'click' ? 0 : 1);
  const measured = replaced ? null : observed;
  await Promise.all(responseReads);
  const sample = {
    schema_version: 1, collected_at: new Date().toISOString(),
    commit: contract.commit, environment: contract.environment,
    scenario: contract.scenario, role_class: contract.role_class,
    device: contract.device, browser: await browser.version(), network: contract.network,
    proxy_state: contract.proxy_state ?? null,
    cache_state: contract.cache_state, deployment: contract.deployment ?? null,
    capture_action: action, resource_cache: resourceCache, document_requests: documentRequests,
    data_origin: contract.data_origin ?? 'unverified',
    map_stages_enabled: contract.map_stages === true,
    server_timing_enabled: contract.server_timing === true,
    metric_contract: { trigger: contract.trigger ?? null, shell: contract.shell, content: contract.content,
      feedback: contract.feedback ?? null, fresh: contract.fresh ?? null,
      map_tiles: contract.map_tiles ?? null, map_markers: contract.map_markers ?? null },
    ...measured, failure,
    status: replaced && (documentRequests > 0 || !failure) ? 'document_replaced'
      : failure ? 'collector_error' : measured?.status ?? 'document_replaced',
    request_count: requests.length, requests,
    limitations: ['Click starts at the actual DOM event; open/reload starts at Navigation Timing zero; multiple documents are not a valid timing sample',
      'Disabling the browser HTTP cache does not prove cold DNS, TLS, CDN, or application storage',
      'Missing feedback/fresh selectors mean unmeasured, never zero',
      'Content selector must be calibrated against actual business readiness before acceptance',
      'In-flight requests retain null status/timing; encoded body sizes exclude headers and may be unavailable'],
  };
  fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(sample, null, 2) + '\n', { mode: 0o600 });
  console.log(`已保存一个脱敏样本，状态：${sample.status}`);
} finally {
  await browser.close();
}
