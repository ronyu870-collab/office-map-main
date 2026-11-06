import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const [baseUrl, output] = process.argv.slice(2);
const base = new URL(baseUrl);
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This regression only runs against an isolated local build');
const require = createRequire(import.meta.url);
const { chromium } = process.env.PERF_PLAYWRIGHT_MODULE
  ? require(process.env.PERF_PLAYWRIGHT_MODULE) : require('playwright-core');
const browser = await chromium.launch({
  ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true,
});
const observations = [];
try {
  for (const route of ['/', '/map', '/oss']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let mapSdkRequests = 0;
    let businessReadRequests = 0;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/^(webapi|vdata|webrd\d*)\.amap\.com$/.test(url.hostname)) mapSdkRequests++;
      if (url.pathname === '/api/map/data' || url.pathname === '/api/oss') businessReadRequests++;
    });
    await page.goto(new URL(route, base).href);
    await page.waitForURL('**/login');
    await page.getByRole('button', { name: '登录', exact: true }).waitFor();
    assert.equal(mapSdkRequests, 0, '匿名访问不能触发高德资源加载');
    assert.equal(businessReadRequests, 0, '匿名访问不能触发地图/资料业务读取');
    observations.push({ route, redirect: '/login', map_sdk_requests: mapSdkRequests,
      business_read_requests: businessReadRequests, status: 'pass' });
    await context.close();
  }
  const result = { status: 'pass', browser: await browser.version(),
    environment: 'local-production-build-without-data-credentials', observations,
    limitations: ['Anonymous fresh contexts only; not authenticated, expired-token, impersonation, or phone acceptance'] };
  if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
