import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { observeNavigation } from './readiness.mjs';

// A single SPA navigation per invocation. Bulk production sampling is excluded.
const [contractFile, outputFile] = process.argv.slice(2);
if (!contractFile || !outputFile) throw new Error('Usage: capture-navigation.mjs contract.json output.json');
const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
for (const key of ['source_url', 'trigger', 'shell', 'content', 'scenario', 'environment', 'commit', 'role_class', 'device', 'network', 'cache_state']) {
  if (!contract[key]) throw new Error(`Missing scenario contract: ${key}`);
}
const source = new URL(contract.source_url);
if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) throw new Error('Invalid source URL');
const require = createRequire(import.meta.url);
const { chromium } = process.env.PERF_PLAYWRIGHT_MODULE
  ? require(process.env.PERF_PLAYWRIGHT_MODULE) : require('playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
await page.goto(source.href);
if (contract.ready_selector) {
  console.log('请在新窗口自行登录；检测到指定首页入口后，将自动采集一次只读导航。');
  await page.locator(contract.ready_selector).waitFor({ state: 'visible', timeout: 300_000 });
} else {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  await prompt.question('请在浏览器自行登录并准备指定场景。不要在终端输入凭据。准备好后按回车：');
  prompt.close();
}
const requests = [];
const requestRecords = new Map();
const publicRoutes = new Set(['/', '/map', '/compare', '/oss', '/update', '/lease-submission',
  '/lease-submission/history', '/lease-submission/monitoring', '/admin', '/settings', '/intelligence', '/login']);
page.on('request', (request) => {
  const url = new URL(request.url());
  if (!['http:', 'https:'].includes(url.protocol)) return;
  // No headers, credentials, query values, business paths, or response bodies.
  const category = url.pathname.startsWith('/api/') ? url.pathname.split('/').slice(0, 3).join('/')
    : url.pathname.includes('/_next/') ? 'next-asset'
      : url.hostname === source.hostname && publicRoutes.has(url.pathname) ? `route:${url.pathname}`
        : url.hostname === source.hostname ? 'same-origin-other' : 'external';
  const record = { category, method: request.method(), status: null,
    resource_type: request.resourceType(), is_rsc: url.searchParams.has('_rsc'),
    timing: null, failed: false };
  requests.push(record);
  requestRecords.set(request, record);
});
page.on('response', (response) => {
  const record = requestRecords.get(response.request());
  if (record) record.status = response.status();
});
page.on('requestfinished', (request) => {
  const record = requestRecords.get(request);
  if (record) record.timing = request.timing();
});
page.on('requestfailed', (request) => {
  const record = requestRecords.get(request);
  if (record) record.failed = true;
});
await page.evaluate(observeNavigation, { ...contract, timeout_ms: contract.timeout_ms ?? 30_000 });
let failure = null;
try {
  await page.locator(contract.trigger).click();
  await page.waitForFunction(() => ['success', 'timeout', 'application_error'].includes(window.__colliersNavigationProbe?.result.status),
    null, { timeout: (contract.timeout_ms ?? 30_000) + 5000 });
} catch (error) {
  // Error messages may include page text/URLs. Store only the controlled class.
  failure = error.name;
}
const measured = await page.evaluate(() => {
  const probe = window.__colliersNavigationProbe;
  if (!probe) return null;
  probe.stop();
  return probe.result;
}).catch(() => null);
const sample = {
  schema_version: 1, collected_at: new Date().toISOString(),
  commit: contract.commit, environment: contract.environment,
  scenario: contract.scenario, role_class: contract.role_class,
  device: contract.device, browser: await browser.version(), network: contract.network,
  proxy_state: contract.proxy_state ?? null,
  cache_state: contract.cache_state, deployment: contract.deployment ?? null,
  data_origin: contract.data_origin ?? 'unverified',
  metric_contract: { trigger: contract.trigger, shell: contract.shell, content: contract.content,
    feedback: contract.feedback ?? null, fresh: contract.fresh ?? null },
  ...measured, failure,
  status: failure ? 'collector_error' : measured?.status ?? 'document_replaced',
  request_count: requests.length, requests,
  limitations: ['SPA navigation only; document replacement is not a valid timing sample',
    'Missing feedback/fresh selectors mean unmeasured, never zero',
    'Content selector must be calibrated against actual business readiness before acceptance',
    'In-flight requests retain null status/timing; not a complete HAR or transferred-byte metric'],
};
fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(sample, null, 2) + '\n', { mode: 0o600 });
await browser.close();
console.log(`已保存一个脱敏样本，状态：${sample.status}`);
