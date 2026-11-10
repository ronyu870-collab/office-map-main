import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { observeNavigation } from './readiness.mjs';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PERF_PLAYWRIGHT_MODULE
  ? require(process.env.PERF_PLAYWRIGHT_MODULE) : require('playwright-core');
const browser = await chromium.launch({
  ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true,
});
const run = promisify(execFile);

async function verifyDocumentCollector() {
  const dir = await mkdtemp(join(tmpdir(), 'colliers-perf-capture-'));
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/measure' });
      return res.end();
    }
    if (req.url.startsWith('/api/private-case')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end('{"items":[1]}');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<div id="shell">外框</div><div id="tiles" hidden>瓦片</div>
      <div id="records" hidden>真实结果</div><div id="markers" hidden>可点标记</div>
      <script>
      const probe = window.__colliersNavigationProbe;
      probe?.recordMapStage?.('authorized');
      probe?.recordMapStage?.('private-business-value');
      fetch('/api/private-case?secret=fixture-secret').then(r => r.json()).then(() => {
        requestAnimationFrame(() => {
          probe?.recordMapStage?.('authorized');
          probe?.recordMapStage?.('tiles_complete');
          document.querySelector('#tiles').hidden = false;
          document.querySelector('#records').hidden = false;
          setTimeout(() => { document.querySelector('#markers').hidden = false }, 60);
        });
      });
      </script>`);
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const input = join(dir, 'contract.json'), output = join(dir, 'result.json');
    const base = { source_url: origin, action: 'open', prepare: 'none', resource_cache: 'disabled',
      timeout_ms: 2000, shell: '#shell', content: '#records', map_tiles: '#tiles', map_markers: '#markers',
      scenario: 'document-calibration', environment: 'fixture', commit: 'fixture', role_class: 'anonymous',
      device: 'desktop', network: 'loopback', cache_state: 'document' };
    const capture = async (pathname, extra = {}) => {
      await writeFile(input, JSON.stringify({ ...base, destination_url: origin + pathname, ...extra }));
      await run(process.execPath, [fileURLToPath(new URL('./capture-navigation.mjs', import.meta.url)), input, output],
        { env: { ...process.env, PERF_CAPTURE_HEADLESS: '1' }, timeout: 20_000 });
      const raw = await readFile(output, 'utf8');
      assert.ok(!raw.includes('fixture-secret') && !raw.includes('private-case') && !raw.includes('private-business-value'), '非白名单内容不能进入样本');
      return JSON.parse(raw);
    };
    const sample = await capture('/measure');
    assert.equal(sample.status, 'success');
    assert.equal(sample.document_requests, 1);
    assert.equal(sample.start, 0, '文档采样从 Navigation Timing 起点开始');
    assert.ok(sample.shell_ms <= sample.content_usable_ms);
    assert.ok(sample.map_tiles_ms <= sample.map_markers_ms);
    assert.ok(sample.map_markers_ms > sample.content_usable_ms, '业务列表出现不代表地图标记已可点');
    assert.ok(sample.requests.some(r => r.category === 'api:other' && r.encoded_body_bytes > 0));
    assert.equal(sample.map_stages_ms, undefined, '地图阶段须主动启用');
    const mapSample = await capture('/map', { map_stages: true });
    assert.equal(mapSample.status, 'success');
    assert.ok(mapSample.map_stages_ms.authorized < mapSample.map_stages_ms.tiles_complete, '不以重复事件覆盖首次阶段');
    assert.equal(mapSample.map_stages_ms.sdk_ready, null, '缺少阶段必须保留为缺测');
    const redirected = await capture('/redirect');
    assert.equal(redirected.status, 'document_replaced');
    assert.equal(redirected.document_requests, 2);
    assert.equal(redirected.content_usable_ms, undefined, '不得记录重定向后文档的局部时间');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

try {
  const page = await browser.newPage();
  const contract = { trigger: '#go', shell: '#shell', content: '#records', fresh: '#fresh', timeout_ms: 3000 };
  await page.setContent('<button id="go">进入模块</button><div id="shell" hidden>外框</div><div id="records" hidden>真实记录</div><div id="fresh" hidden>回读完成</div>');
  await page.evaluate(() => document.querySelector('#go').addEventListener('click', () => {
    document.querySelector('#shell').hidden = false;
  }));
  await page.evaluate(observeNavigation, contract);
  await page.click('#go');
  await page.waitForFunction(() => window.__colliersNavigationProbe.result.shell_ms !== null);
  let result = await page.evaluate(() => window.__colliersNavigationProbe.result);
  assert.equal(result.content_usable_ms, null, '外框不能计为业务内容可用');
  assert.equal(result.fresh_data_ms, null);
  await page.evaluate(() => { document.querySelector('#records').hidden = false; });
  await page.waitForFunction(() => window.__colliersNavigationProbe.result.content_usable_ms !== null);
  result = await page.evaluate(() => window.__colliersNavigationProbe.result);
  assert.equal(result.status, 'running', '缓存内容可用不能冒充新鲜回读');
  await page.evaluate(() => { document.querySelector('#fresh').hidden = false; });
  await page.waitForFunction(() => window.__colliersNavigationProbe.result.status === 'success');
  result = await page.evaluate(() => window.__colliersNavigationProbe.result);
  assert.ok(result.shell_ms <= result.content_usable_ms);
  assert.ok(result.content_usable_ms <= result.fresh_data_ms);
  assert.equal(result.feedback_ms, null, '未定义指标不能补零');
  await page.evaluate(() => window.__colliersNavigationProbe.stop());

  await page.setContent('<button id="go">进入模块</button><div id="error" hidden>拒绝访问</div>');
  await page.evaluate(() => document.querySelector('#go').addEventListener('click', () => {
    document.querySelector('#error').hidden = false;
  }));
  await page.evaluate(observeNavigation, { ...contract, error: '#error' });
  await page.click('#go');
  await page.waitForFunction(() => window.__colliersNavigationProbe.result.status === 'application_error');
  result = await page.evaluate(() => window.__colliersNavigationProbe.result);
  assert.equal(result.content_usable_ms, null);
  await page.evaluate(() => window.__colliersNavigationProbe.stop());

  await page.setContent('<button id="go">进入模块</button>');
  await page.evaluate(observeNavigation, { ...contract, timeout_ms: 50 });
  await page.click('#go');
  await page.waitForFunction(() => window.__colliersNavigationProbe.result.status === 'timeout');
  result = await page.evaluate(() => window.__colliersNavigationProbe.result);
  assert.equal(result.content_usable_ms, null, '超时必须保留为空并计失败');

  await page.setContent('<button id="go">刷新</button><div id="records">点击前已存在</div>');
  await page.evaluate(observeNavigation, { ...contract, require_content_transition: true });
  await page.click('#go');
  result = await page.evaluate(() => window.__colliersNavigationProbe.result);
  assert.equal(result.status, 'preexisting_content');
  assert.equal(result.content_usable_ms, null, '已有内容不能当作本次操作的可用时刻');
  await verifyDocumentCollector();
  console.log(JSON.stringify({ status: 'pass', browser: await browser.version(),
    coverage: ['shell_vs_content', 'cached_vs_fresh', 'missing_metric', 'application_error', 'timeout',
      'preexisting_content', 'document_start', 'map_readiness', 'redirect_boundary', 'request_privacy'] }));
} finally {
  await browser.close();
}
