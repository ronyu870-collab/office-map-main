/** Actual gallery/client/CSS in an isolated browser fixture; no production login or business records. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const output = path.resolve('verification/building-photos');
fs.mkdirSync(output, { recursive: true });
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const modules = {
  '@/src/lib/building-photos/model': compile('src/lib/building-photos/model.ts'),
  '../buildingPhotosClient': compile('src/services/buildingPhotosClient.ts'),
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
const photos = [
  {id:'22222222-2222-4222-8222-222222222222',caption:'建筑外观'},
  {id:'33333333-3333-4333-8333-333333333333',caption:'室内空间'},
];
const root = document.querySelector('[data-fixture]');
root.innerHTML = '<div class="building-pilot-title-row"><h2 class="building-pilot-name">用于验证窄屏的超长楼宇名称与真实图片来源说明</h2>'+gallery.buildPhotoTrigger('photos')+'</div>'+gallery.buildPhotoGallery('photos','合成楼宇',photos);
gallery.bindBuildingPhotoGallery(root,'11111111-1111-4111-8111-111111111111',photos);
`;
const css = fs.readFileSync('src/app/map/map-building-popup.css', 'utf8');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>楼宇图片隔离验证</title><style>*{box-sizing:border-box}body{margin:0;padding:16px;font-family:system-ui;background:#edf2f7}h2{margin:0;font-size:16px}button{font:inherit}[data-fixture]{padding:12px;background:white;border-radius:8px;width:min(340px,100%)}${css}</style><body><section data-fixture></section><script src="/fixture.js"></script></body></html>`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#e2e8f0"/><rect x="300" y="150" width="600" height="650" fill="#0b446e"/><path d="M400 150V800M600 150V800M800 150V800" stroke="#7dd3fc" stroke-width="20"/></svg>';
let reads = [];
let imageReads = 0;
let failSecond = false;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.local');
  if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(bootstrap); }
  if (url.pathname === '/image.svg') { imageReads++; response.setHeader('Content-Type', 'image/svg+xml'); return response.end(svg); }
  if (url.pathname === '/api/map/building-photos') {
    assert.equal(request.headers.authorization, 'Bearer synthetic-browser-token');
    const id = url.searchParams.get('photo_id');
    reads.push(id);
    if (id.startsWith('3333') && failSecond) { failSecond = false; response.statusCode = 502; return response.end(JSON.stringify({ error: 'synthetic retry' })); }
    response.setHeader('Content-Type', 'application/json');
    const provenance = id.startsWith('2222')
      ? { source_url: 'https://www.example.com/building', source_name: '项目报道', attribution_text: '摄影者与商用授权未确认。', license_url: null }
      : { source_url: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg', source_name: 'Wikimedia Commons', attribution_text: '摄影者署名与原作品名称 Photograph by Example Photographer / CC BY-SA 4.0（合成验证）', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
    return response.end(JSON.stringify({ url: '/image.svg?id='+id, ...provenance }));
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
});
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
    reads = []; imageReads = 0; failSecond = true;
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
    if (mobile) await enlarge.tap();
    else { await enlarge.focus(); await page.keyboard.press('Enter'); }
    const viewer = page.getByRole('dialog', { name: '合成楼宇' });
    await viewer.waitFor({ state: 'visible' });
    assert.equal(await viewer.evaluate(dialog => dialog.matches(':modal')), true);
    const closeViewer = viewer.getByRole('button', { name: '关闭大图' });
    assert.equal(await closeViewer.evaluate(button => button === document.activeElement), true);
    assert.ok((await images.nth(0).boundingBox()).height > previewHeight);
    assert.equal(reads.length, 1);
    assert.equal(imageReads, 1);
    await assertCaptionOnly();
    await page.screenshot({ path: path.join(output, `${width}-enlarged.png`) });
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
    if (mobile) await closeViewer.tap();
    else await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'hidden' });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await enlarge.evaluate(button => button === document.activeElement), true);
    assert.equal(await description.locator('[data-building-photo-caption]').innerText(), '室内空间');
    assert.ok(await images.nth(1).isVisible());
    assert.equal(reads.length, 3);
    assert.equal(imageReads, 2);
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
    assert.deepEqual(errors, []);
    results.push({ width, height, touch: mobile, idleRequests: 0, lazyReadRetryAndReuse: true, captionOnlyWithoutLicense: true, enlargedViewReusesImage: true, enlargedViewRestoresPhotoAndFocus: true, attributionAndLicense: true, escapeReturnsFocus: true, horizontalOverflow: false });
    await page.close();
  }
  console.log(JSON.stringify({ status: 'passed', fixtures: 'synthetic only', results }, null, 2));
} finally {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
