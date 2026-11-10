import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const samples = Number(process.env.PERF_REPORT_SAMPLES ?? 5);
assert.ok(Number.isSafeInteger(samples) && samples > 0 && samples <= 100);
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ headless: true, ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }) });
const profile = { latency: 90, downloadThroughput: 200_000, uploadThroughput: 90_000, connectionType: 'cellular4g', offline: false };
const records = [];
const screenshots = process.env.PERF_REPORT_SCREENSHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
try {
  for (let run = 0; run < samples; run++) {
    for (const width of [1280, 390]) {
      const mobile = width === 390;
      const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: mobile ? 3 : 1,
        isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', reducedMotion: 'reduce' });
      try {
        await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
        await context.addInitScript(() => {
          window.reportMeasurement = { lcp: null, longTasks: [] };
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) window.reportMeasurement.lcp = entry.startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) window.reportMeasurement.longTasks.push(entry.duration);
          }).observe({ type: 'longtask', buffered: true });
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', profile);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: mobile ? 4 : 1 });
        await page.goto(new URL('/occupier-insights', base).href, { waitUntil: 'load' });
        await page.getByRole('heading', { name: '企业选址洞察', exact: true }).waitFor();
        const metrics = await page.evaluate(async () => {
          const cover = document.querySelector('#report-top img');
          await cover.decode();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const timing = performance.getEntriesByType('navigation')[0];
          const resources = performance.getEntriesByType('resource').map(entry => ({
            path: new URL(entry.name).pathname, wireBodyBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize,
            endMs: Math.round(entry.responseEnd),
          }));
          return {
            documentWireBodyBytes: timing.encodedBodySize,
            firstPaintMs: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1),
            lcpMs: window.reportMeasurement.lcp === null ? null : Math.round(window.reportMeasurement.lcp),
            longTasksMs: window.reportMeasurement.longTasks,
            cover: resources.find(entry => entry.path === new URL(cover.currentSrc).pathname),
            initialPhotos: resources.filter(entry => entry.path.startsWith('/occupier-insights/')),
            allJsWireBodyBytes: resources.filter(entry => entry.path.endsWith('.js')).reduce((sum, entry) => sum + entry.wireBodyBytes, 0),
            logoWireBodyBytes: resources.find(entry => entry.path === '/colliers-logo.png')?.wireBodyBytes ?? 0,
            reportJs: resources.filter(entry => entry.path.includes('/chunks/app/occupier-insights/')),
          };
        });
        assert.ok(metrics.cover?.wireBodyBytes > 0, 'cover must load from the isolated build');
        assert.equal(metrics.firstPaintMs > 0, true);
        records.push({ run: run + 1, width, ...metrics });
        if (screenshots && run === 0) {
          await page.screenshot({ animations: 'disabled', path: join(screenshots, width + '-cover.png') });
        }
      } finally {
        await context.close();
      }
    }
  }
  console.log(JSON.stringify({ browser: browser.version(), profile, records }, null, 2));
} finally {
  await browser.close();
}
