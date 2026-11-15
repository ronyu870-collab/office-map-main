/** Actual gallery/client/CSS in an isolated browser fixture; no production login or business records. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const output = path.resolve('verification/building-photos');
fs.mkdirSync(output, { recursive: true });
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const modules = {
  '@/src/lib/building-photos/model': compile('src/lib/building-photos/model.ts'),
  '../buildingPhotosClient': compile('src/services/buildingPhotosClient.ts'),
  '../salesMaterialsClient': compile('src/services/salesMaterialsClient.ts'),
  '@/src/services/impersonationHeaders': compile('src/services/impersonationHeaders.ts'),
  gallery: compile('src/services/map/buildingPhotoGallery.ts'),
};
const bootstrap = `
const modules = ${JSON.stringify(modules)};
const cache = {};
function require(name) {
  if (name === '@/src/services/Auth') return {getSessionFast: async () => ({session:{access_token:'synthetic-browser-token'}})};
  if (!cache[name]) {
    if (!modules[name]) throw new Error('Unexpected fixture import: ' + name);
    const module = {exports:{}}; cache[name] = module;
    new Function('require','module','exports',modules[name])(require,module,module.exports);
  }
  return cache[name].exports;
}
const gallery = require('gallery');
const pilot = location.search === '?pilot';
const previewFallback = location.search === '?preview-fallback';
const photos = previewFallback ? [{id:'55555555-5555-4555-8555-555555555555',caption:'小图回退夹具'}] : pilot ? [{file:'interior.webp',caption:'试点室内照片',pilotIndex:1}] : [
  {id:'22222222-2222-4222-8222-222222222222',caption:'建筑外观'},
  {id:'33333333-3333-4333-8333-333333333333',caption:'室内空间'},
  {id:'44444444-4444-4444-8444-444444444444',caption:'外链照片'},
];
const root = document.querySelector('[data-fixture]');
const title = '用于验证窄屏的超长楼宇名称与真实图片来源说明';
root.innerHTML = '<div class="building-pilot-title-row"><h2 class="building-pilot-name">'+title+'</h2>'+gallery.buildPhotoTrigger('photos')+'</div>'+gallery.buildPhotoGallery('photos',title,photos);
gallery.bindBuildingPhotoGallery(root,'11111111-1111-4111-8111-111111111111',photos);
`;
const css = fs.readFileSync('src/app/map/map-building-popup.css', 'utf8');
const tokens = fs.readFileSync('src/styles/tokens.css', 'utf8');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>楼宇图片隔离验证</title><style>*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;padding:16px;font-family:system-ui;background:#edf2f7}h2{margin:0;font-size:16px}button{font:inherit}dialog{margin:0}[data-fixture]{padding:12px;background:white;border-radius:8px;width:min(340px,100%)}${tokens}${css}</style><body><section data-fixture></section><script src="/fixture.js"></script></body></html>`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#e2e8f0"/><rect x="300" y="150" width="600" height="650" fill="#0b446e"/><path d="M400 150V800M600 150V800M800 150V800" stroke="#7dd3fc" stroke-width="20"/></svg>';
const portrait = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="#c3ccd8"/></svg>';
const externalUrl = 'https://images.archdaily.com/synthetic-fixture.svg';
const assetFor = id => id.startsWith('3333') ? portrait : svg;
const firstPreview = await sharp(Buffer.from(svg)).webp().toBuffer();
let reads = [];
let downloadReads = [];
let fallbackReads = [];
let failDownload = false;
let holdDownload = false;
let releaseDownload;
const storage = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://storage.local');
  const file = url.searchParams.get('download');
  assert.ok(file && url.searchParams.has('id'));
  response.setHeader('Content-Type', 'image/svg+xml');
  response.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(file));
  response.end(assetFor(url.searchParams.get('id')));
});
let imageReads = 0;
let failSecond = false;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.local');
  if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(bootstrap); }
  if (url.pathname === '/preview-unavailable') { response.statusCode = 503; return response.end(); }
  if (url.pathname === '/image.svg') { imageReads++; response.setHeader('Content-Type', 'image/svg+xml'); return response.end(assetFor(url.searchParams.get('id'))); }
  if (['/api/map/building-photos', '/api/map/sales-materials'].includes(url.pathname)) {
    assert.equal(request.headers.authorization, 'Bearer synthetic-browser-token');
    const pilot = url.pathname.endsWith('sales-materials');
    if (pilot) { assert.equal(url.searchParams.get('cover'), '1'); assert.equal(url.searchParams.get('photo'), '1'); }
    const id = pilot ? 'pilot' : url.searchParams.get('photo_id');
    if (url.searchParams.get('download') === '1') {
      downloadReads.push(id);
      response.setHeader('Content-Type', 'application/json');
      if (failDownload) { failDownload = false; response.statusCode = 502; return response.end('{}'); }
      const file = id === 'pilot' ? '试点室内照片.svg' : id.startsWith('2222') ? '建筑外观.svg' : '室内空间.svg';
      const downloadUrl = new URL('/attachment', `http://127.0.0.1:${storage.address().port}`);
      downloadUrl.search = new URLSearchParams({ id, download: file });
      const send = () => response.end(JSON.stringify({ url: downloadUrl.href }));
      if (holdDownload) { releaseDownload = send; return; }
      return send();
    }
    if (id.startsWith('5555')) {
      const preview = url.searchParams.get('preview') === '1';
      fallbackReads.push(preview ? 'preview' : 'original');
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({
        url: preview ? '/preview-unavailable' : '/image.svg?id='+id, can_download: true, is_preview: preview,
      }));
    }
    reads.push(id);
    if (id.startsWith('3333') && failSecond) { failSecond = false; response.statusCode = 502; return response.end(JSON.stringify({ error: 'synthetic retry' })); }
    response.setHeader('Content-Type', 'application/json');
    const provenance = id.startsWith('2222')
      ? { source_url: 'https://www.example.com/building', source_name: '项目报道', attribution_text: '摄影者与商用授权未确认。', license_url: null }
      : { source_url: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg', source_name: 'Wikimedia Commons', attribution_text: '摄影者署名与原作品名称 Photograph by Example Photographer / CC BY-SA 4.0（合成验证）', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
    const external = id.startsWith('4444');
    if (id.startsWith('2222')) {
      assert.equal(request.headers.accept, 'image/webp');
      response.setHeader('Content-Type', 'image/webp');
      response.setHeader('X-Building-Photo-Metadata', Buffer.from(JSON.stringify({ can_download: true, ...provenance })).toString('base64url'));
      return response.end(firstPreview);
    }
    return response.end(JSON.stringify({ url: external ? externalUrl : '/image.svg?id='+id, can_download: !external, ...provenance }));
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
});
await new Promise(resolve => storage.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PERF_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
  for (const [width, height] of [[1280, 800], [390, 844], [320, 740]]) {
    const mobile = width < 640;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    reads = []; imageReads = 0; failSecond = true; downloadReads = [];
    await page.context().route(externalUrl, route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'load' });
    assert.equal(reads.length, 0);
    const trigger = page.getByRole('button', { name: '看图' });
    if (mobile) { const box = await trigger.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44); await trigger.tap(); }
    else { await trigger.focus(); await page.keyboard.press('Enter'); }
    const images = page.locator('[data-building-photo]');
    await images.nth(0).waitFor({ state: 'visible' });
    assert.equal(reads.length, 1);
    const captionRow = page.locator('.building-photo-caption-row');
    const description = captionRow.locator('.building-photo-description');
    const gallery = page.locator('[data-building-photo-gallery]');
    const assertCaptionOnly = async () => {
      assert.equal(await description.innerText(), '建筑外观');
      assert.equal(await gallery.getByRole('link').count(), 0);
      assert.equal(await page.locator('[data-building-photo-attribution]').innerText(), '');
    };
    await assertCaptionOnly();
    await page.screenshot({ path: path.join(output, `${width}-expanded.png`) });
    const enlarge = page.getByRole('button', { name: '查看大图' });
    const previewHeight = (await images.nth(0).boundingBox()).height;
    const viewer = page.getByRole('dialog', { name: '用于验证窄屏的超长楼宇名称与真实图片来源说明' });
    if (!mobile) {
      await enlarge.click();
      assert.equal(await viewer.isVisible(), false, 'A single mouse click must leave the photo inline');
    }
    assert.equal(await enlarge.locator('svg').count(), 0, 'The inline photo must have no enlarge icon');
    if (mobile) await enlarge.tap();
    else await enlarge.dblclick();
    const assertCentered = async () => {
      const box = await viewer.boundingBox();
      assert.ok(Math.abs(box.x + box.width / 2 - width / 2) <= 2, 'Dialog must center horizontally with the app margin reset');
      assert.ok(Math.abs(box.y + box.height / 2 - height / 2) <= 2, 'Dialog must center vertically with the app margin reset');
    };
    const downloadButton = viewer.getByRole('button', { name: '下载原图' });
    const verifyDownload = async (button, filename, body) => {
      const [download] = await Promise.all([page.waitForEvent('download'), mobile ? button.tap() : button.click()]);
      assert.equal(download.suggestedFilename(), filename);
      assert.equal(await download.failure(), null);
      assert.equal(fs.readFileSync(await download.path(), 'utf8'), body);
      assert.ok(await viewer.isVisible(), 'Download keeps the viewer open');
    };
    await viewer.waitFor({ state: 'visible' });
    assert.equal(await viewer.evaluate(dialog => dialog.matches(':modal')), true);
    await assertCentered();
    const closeViewer = viewer.getByRole('button', { name: '关闭大图' });
    assert.equal(await closeViewer.evaluate(button => button === document.activeElement), true);
    assert.ok((await images.nth(0).boundingBox()).height > previewHeight);
    assert.equal(reads.length, 1);
    assert.equal(imageReads, 0, 'same-origin preview does not fetch a second URL');
    await assertCaptionOnly();
    await page.screenshot({ path: path.join(output, `${width}-enlarged.png`) });
    assert.equal(downloadReads.length, 0);
    failDownload = true;
    await downloadButton.click();
    await viewer.getByText('下载链接获取失败，请重试。').waitFor();
    await verifyDownload(downloadButton, '建筑外观.svg', svg);
    assert.equal(downloadReads.length, 2);
    assert.ok(downloadReads.every(id => id.startsWith('2222')));
    if (mobile) {
      await viewer.locator('.building-pilot-photo-stage').evaluate(stage => {
        const start = new Touch({ identifier: 0, target: stage, clientX: 210, clientY: 120 });
        const end = new Touch({ identifier: 0, target: stage, clientX: 120, clientY: 125 });
        stage.dispatchEvent(new TouchEvent('touchstart', { touches: [start], bubbles: true }));
        stage.dispatchEvent(new TouchEvent('touchend', { changedTouches: [end], bubbles: true }));
      });
    } else await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: '重试' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '重试' }).click();
    await images.nth(1).waitFor({ state: 'visible' });
    assert.equal(reads.length, 3);
    assert.equal(await page.locator('[data-building-photo-license]').getAttribute('href'), 'https://creativecommons.org/licenses/by-sa/4.0/');
    const credit = await page.locator('[data-building-photo-attribution]').innerText();
    assert.ok(credit.replace(/\s+/g, ' ').includes('CC BY-SA 4.0'), JSON.stringify({ credit }));
    if (mobile) for (const selector of ['[data-building-photo-source]', '[data-building-photo-license]']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, 'Source and license links need touch targets');
    }
    await assertCentered();
    await verifyDownload(downloadButton, '室内空间.svg', portrait);
    assert.ok(downloadReads.at(-1).startsWith('3333'));
    if (mobile) await closeViewer.tap();
    else await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'hidden' });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await enlarge.evaluate(button => button === document.activeElement), true);
    assert.equal(await description.locator('[data-building-photo-caption]').innerText(), '室内空间');
    assert.ok(await images.nth(1).isVisible());
    assert.equal(reads.length, 3);
    assert.equal(imageReads, 1);
    await page.getByRole('button', { name: '上一张' }).click();
    await images.nth(0).waitFor({ state: 'visible' });
    assert.equal(reads.length, 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await assertCaptionOnly();
    await trigger.click(); await trigger.click();
    assert.equal(reads.length, 3);
    await page.getByRole('button', { name: '下一张' }).focus();
    await page.keyboard.press('Escape');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.evaluate(button => button === document.activeElement), true);
    // A delayed authorization from a previous photo must never start a stale download.
    let lateDownloads = 0;
    page.on('download', () => { lateDownloads++; });
    await trigger.click();
    if (mobile) await enlarge.tap();
    else { await enlarge.focus(); await page.keyboard.press('Enter'); }
    await viewer.waitFor({ state: 'visible' });
    holdDownload = true;
    releaseDownload = undefined;
    await Promise.all([
      page.waitForRequest(request => request.url().includes('/api/map/building-photos?') && request.url().includes('download=1')),
      downloadButton.click(),
    ]);
    await viewer.getByRole('button', { name: '正在准备…' }).waitFor();
    await viewer.getByRole('button', { name: '下一张' }).click();
    await images.nth(1).waitFor({ state: 'visible' });
    await viewer.getByRole('button', { name: '下一张' }).click();
    await images.nth(2).waitFor({ state: 'visible' });
    const original = viewer.getByRole('link', { name: '打开原图' });
    assert.equal(await original.getAttribute('href'), externalUrl);
    assert.equal(await original.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(await downloadButton.count(), 0);
    assert.equal(typeof releaseDownload, 'function');
    releaseDownload();
    holdDownload = false;
    const [popup] = await Promise.all([page.waitForEvent('popup'), original.click()]);
    await popup.waitForURL(externalUrl);
    await popup.close();
    assert.equal(lateDownloads, 0);
    assert.ok(await viewer.isVisible());
    await closeViewer.click();

    await page.goto(`http://127.0.0.1:${server.address().port}/?preview-fallback`);
    fallbackReads = [];
    await trigger.click();
    await images.nth(0).waitFor({ state: 'visible' });
    assert.deepEqual(fallbackReads, ['preview', 'original']);
    assert.equal(await page.getByRole('button', { name: '重试' }).count(), 0);

    await page.goto(`http://127.0.0.1:${server.address().port}/?pilot`);
    await trigger.click();
    if (mobile) await enlarge.tap();
    else await enlarge.dblclick();
    await viewer.waitFor({ state: 'visible' });
    assert.equal(await viewer.getByRole('navigation').count(), 0);
    await verifyDownload(downloadButton, '试点室内照片.svg', svg);
    assert.equal(downloadReads.at(-1), 'pilot');
    assert.deepEqual(errors, []);
    results.push({ width, height, touch: mobile, idleRequests: 0, lazyReadRetryAndReuse: true, captionOnlyWithoutLicense: true, enlargedViewReusesImage: true, enlargedViewRestoresPhotoAndFocus: true, attributionAndLicense: true, escapeReturnsFocus: true, centeredAfterGlobalReset: true, downloadedExactOriginalBytes: true, externalFallback: true, horizontalOverflow: false });
    await page.close();
  }
  console.log(JSON.stringify({ status: 'passed', browser: browser.version(), fixtures: 'synthetic only', results }, null, 2));
} finally {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => storage.close(resolve))]);
}
