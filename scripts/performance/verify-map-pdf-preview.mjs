import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { installSyntheticMap } from './fixtures/map-adapter.mjs';
const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const user = { id: '12345678-1111-4111-8111-111111111111', email: 'pdf@example.test', app_metadata: {}, user_metadata: {} };
const buildingId = '44444444-4444-4444-8444-444444444444';
const materialId = '22222222-2222-4222-8222-222222222222';
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };

function pdfFixture(pages, linesPerPage) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`];
  const filler = `%${'a'.repeat(95)}\n`.repeat(linesPerPage);
  for (let i = 0; i < pages; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents ${4 + i * 2} 0 R >>`);
    const stream = `${i % 2 ? '0 0 1' : '1 0 0'} rg 0 0 300 200 re f\n${filler}`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }
  let pdf = '%PDF-1.7\n';
  const offsets = objects.map((value, index) => { const start = pdf.length; pdf += `${index + 1} 0 obj\n${value}\nendobj\n`; return start; });
  return Buffer.from(`${pdf}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${pdf.length}\n%%EOF\n`);
}

const large = pdfFixture(18, 2600);
const short = pdfFixture(2, 2600);
const rows = [];
const asset = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const mode = url.pathname.slice(1);
  const content = mode === 'desktop' || mode === 'mobile' ? large : short;
  const record = { mode, range: request.headers.range ?? null, bytesWritten: 0, status: 0 };
  const cors = { 'Access-Control-Allow-Origin': base.origin, 'Access-Control-Allow-Headers': 'range', 'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Encoding, Content-Length' };
  if (request.method === 'OPTIONS') { response.writeHead(204, cors).end(); return; }
  if (!['desktop', 'mobile', 'fallback', 'range-error'].includes(mode) || url.searchParams.get('signed') !== 'fixture') { response.writeHead(403, cors).end(); return; }
  if (url.searchParams.get('download') === '1') {
    response.writeHead(200, { ...cors, 'Content-Type': 'application/pdf', 'Content-Length': content.length, 'Content-Disposition': 'attachment; filename=fixture.pdf' }).end(content);
    return;
  }
  rows.push(record);
  const headers = { ...cors, 'Cache-Control': 'no-store', 'Content-Type': 'application/pdf' };
  if (mode !== 'fallback') headers['Accept-Ranges'] = 'bytes';
  const match = record.range?.match(/^bytes=(\d+)-(\d+)$/);
  if (mode === 'range-error' && match) {
    record.status = 416;
    response.writeHead(416, { ...headers, 'Content-Range': `bytes */${content.length}` }).end();
    return;
  }
  if (mode !== 'fallback' && match) {
    const start = Number(match[1]), end = Math.min(content.length - 1, Number(match[2]));
    const bytes = content.subarray(start, end + 1);
    record.status = 206;
    record.bytesWritten = bytes.length;
    response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${content.length}`, 'Content-Length': bytes.length }).end(bytes);
    return;
  }
  record.status = 200;
  response.writeHead(200, { ...headers, 'Content-Length': content.length });
  response.flushHeaders();
  const send = () => {
    if (response.destroyed) return;
    const chunk = content.subarray(record.bytesWritten, record.bytesWritten + 65536);
    record.bytesWritten += chunk.length;
    if (record.bytesWritten === content.length) { response.end(chunk); return; }
    response.write(chunk);
    timer = setTimeout(send, 9);
  };
  let timer = setTimeout(send, 20);
  response.once('close', () => clearTimeout(timer));
});
asset.listen(0, '127.0.0.1');
await once(asset, 'listening');
const assetOrigin = `http://127.0.0.1:${asset.address().port}`;
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const results = [];
try {
  for (const [mode, width] of [['desktop', 1280], ['mobile', 390], ['fallback', 390], ...(!baseline ? [['range-error', 390]] : [])]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block' });
    try {
      const url = `${assetOrigin}/${mode}?signed=fixture`;
      const file = mode === 'desktop' || mode === 'mobile' ? large : short;
      const reads = [];
      const records = () => rows.filter(row => row.mode === mode);
      const transferred = () => records().reduce((bytes, row) => bytes + row.bytesWritten, 0);
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin === assetOrigin) return route.continue();
        if (target.origin === base.origin) {
          if (target.pathname === '/api/map/data') {
            return route.fulfill({ json: { display_overrides: [], future_supplies: [], buildings: target.searchParams.get('mode') === 'future' ? [] : [{
              id: buildingId, name: '隔离楼宇', grade: 'A', district: '朝阳区', submarket: '其他', location_lng: 116.46, location_lat: 39.91, building_metrics: [],
            }] } });
          }
          if (target.pathname === '/api/map/sales-materials') {
            assert.equal(request.headers().authorization, `Bearer ${token}`);
            assert.equal(target.searchParams.get('building_id'), buildingId);
            const id = target.searchParams.get('material_id');
            reads.push(id ?? 'list');
            if (!id) return route.fulfill({ json: { count: 1, records: [{ id: materialId, title: '隔离资料', document_date: null, source: '合成来源', original_name: 'fixture.pdf', mime_type: 'application/pdf', file_size: file.length, created_at: '2026-11-10T00:00:00Z' }] } });
            assert.equal(id, materialId);
            return route.fulfill({ json: { preview_url: url, download_url: `${url}&download=1`, details: [], provenance: {} } });
          }
          return target.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        }
        if (target.origin === 'https://webapi.amap.com' && target.pathname === '/maps') return route.fulfill({ contentType: 'application/javascript', body: `(${installSyntheticMap.toString()})();` });
        if (target.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS, POST', 'access-control-allow-headers': '*' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        return route.fulfill({ headers, json: target.pathname.endsWith('/user_roles') ? [{ role: 'viewer', user_id: user.id, session_id: user.id }] : [] });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      await page.goto(new URL('/map', base).href, { waitUntil: 'domcontentloaded' });
      await page.locator(`#map-container [data-building-id="${buildingId}"]`).first().click();
      assert.deepEqual(reads, []);
      await page.getByRole('button', { name: /^(销控与佣金|项目资料与佣金)$/ }).click();
      await page.getByText('暂无可租房源').waitFor();
      assert.deepEqual(reads, ['list', materialId]);
      assert.equal(transferred(), 0);
      const started = performance.now();
      await page.getByRole('button', { name: '查看原件', exact: true }).click();
      const canvas = page.locator('canvas[aria-label^="隔离资料 第"]');
      const waitPixel = (index, channel) => page.waitForFunction(([index, channel]) => {
        const canvas = document.querySelector(`canvas[aria-label="隔离资料 第${index}页"]`);
        if (!canvas || canvas.getBoundingClientRect().width <= 0) return false;
        const pixel = canvas.getContext('2d').getImageData(4, 4, 1, 1).data;
        return pixel[channel] > 200 && pixel[(channel + 1) % 3] < 30 && pixel[(channel + 2) % 3] < 30;
      }, [index, channel]);
      if (mode === 'range-error') {
        await page.getByRole('alert').filter({ hasText: /PDF .*加载失败/ }).getByRole('button', { name: '重试' }).click();
        assert.ok(records().some(row => row.status === 416));
      }
      await waitPixel(1, 0);
      const firstPaintMs = Math.round(performance.now() - started);
      await delay(950);
      const idleBytes = transferred();
      const last = file === short ? 2 : 18;
      await page.getByLabel('PDF页码').selectOption(String(last));
      await waitPixel(last, 2);
      const afterFlipBytes = transferred();
      const beforeZoom = await canvas.getAttribute('width');
      await page.getByRole('button', { name: '放大PDF' }).click();
      await page.waitForFunction(before => document.querySelector('canvas[aria-label^="隔离资料 第"]')?.getAttribute('width') !== before, beforeZoom);
      await waitPixel(last, 2);
      const downloadLink = page.getByRole('link', { name: '下载原件' });
      assert.equal(await downloadLink.getAttribute('href'), `${url}&download=1`);
      if (mode === 'fallback') {
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), downloadLink.click()]);
        assert.equal(download.suggestedFilename(), 'fixture.pdf');
        const received = [];
        for await (const bytes of await download.createReadStream()) received.push(bytes);
        assert.ok(Buffer.concat(received).equals(file), 'download must preserve the complete original bytes');
      }
      await page.getByRole('button', { name: '返回房源' }).click();
      await page.getByText('暂无可租房源').waitFor();
      assert.deepEqual(reads, ['list', materialId, materialId, materialId]);
      results.push({ mode, width, fileBytes: file.length, firstPaintMs, idleBytes, afterFlipBytes, rangeRequests: records().filter(row => row.status === 206).length });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ baseline, browser: await browser.version(), results }, null, 2));
  for (const row of results) {
    if (row.mode === 'range-error') assert.ok(row.idleBytes >= row.fileBytes, 'retry reads the original response');
    else if (row.mode === 'fallback') assert.equal(row.idleBytes, row.fileBytes);
    else if (baseline) assert.ok(row.idleBytes >= row.fileBytes * 0.8, 'baseline should reproduce speculative full PDF transfer');
    else {
      assert.ok(row.rangeRequests > 0, 'large PDF should use byte ranges');
      assert.ok(row.idleBytes < row.fileBytes * 0.35, 'the first page should not fetch the unread PDF pages');
      assert.ok(row.afterFlipBytes < row.fileBytes * 0.55, 'jumping to the last page should not fetch all intermediate pages');
    }
  }
} finally { await browser.close(); asset.closeAllConnections(); asset.close(); }
