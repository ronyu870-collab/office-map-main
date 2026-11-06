import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { observeNavigation } from './readiness.mjs';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PERF_PLAYWRIGHT_MODULE
  ? require(process.env.PERF_PLAYWRIGHT_MODULE) : require('playwright-core');
const browser = await chromium.launch({
  ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true,
});
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
  console.log(JSON.stringify({ status: 'pass', browser: await browser.version(),
    coverage: ['shell_vs_content', 'cached_vs_fresh', 'missing_metric', 'application_error', 'timeout'] }));
} finally {
  await browser.close();
}
