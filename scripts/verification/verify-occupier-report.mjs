/**
 * Browser verification of the actual report component/CSS/controller in an isolated
 * authenticated-content fixture. Platform auth is mocked here, never in the app.
 * Optional argv[2] checks public reading and protected routes on the real build.
 * Artifacts contain only the static public-research report, never business data.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const cwd = process.cwd();
const directory = path.join(cwd, 'src/app/occupier-insights');
const output = path.join(cwd, 'verification/occupier-report');
fs.mkdirSync(output, { recursive: true });
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function load(file, resolver = nodeRequire) {
  const evaluatedModule = { exports: {} };
  new Function('require', 'module', 'exports', compile(file))(resolver, evaluatedModule, evaluatedModule.exports);
  return evaluatedModule.exports;
}
function inlineImage(src) {
  if (src.startsWith('data:')) return src;
  assert.ok(src === '/colliers-logo.png' || /^\/occupier-insights\/[a-z-]+\.(?:webp|avif)$/.test(src), `Unexpected fixture image: ${src}`);
  return `data:image/${src.split('.').at(-1)};base64,${fs.readFileSync(path.join(cwd, 'public', src)).toString('base64')}`;
}
const report = load(path.join(directory, 'OccupierInsightsReport.tsx'), name => {
  if (name === 'next/image') return { __esModule: true, default: ({ src, fill, ...input }) => {
    const props = { ...input };
    delete props.unoptimized;
    delete props.fetchPriority;
    delete props.loading;
    return React.createElement('img', { ...props, src: inlineImage(src), loading: 'eager', style: fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : props.style });
  } };
  if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', props) };
  if (name === 'next/navigation') return { useRouter: () => ({ replace() {} }) };
  if (name.includes('SessionProvider')) return { useAppSession: () => ({ status: 'authenticated', session: { user: { id: 'synthetic-reader' } } }) };
  if (name === './reportNavigation') return { mountReportNavigation() {} };
  if (name === './reportContent') return load(path.join(directory, 'reportContent.ts'));
  if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
  return nodeRequire(name);
});
const css = fs.readFileSync(path.join(directory, 'report.module.css'), 'utf8').replaceAll(':global(html)', 'html');
const markup = renderToStaticMarkup(React.createElement(report.OccupierInsightsReport))
  .replace(/srcSet="(\/occupier-insights\/[a-z-]+\.avif)"/gi, (_, src) => `srcset="${inlineImage(src)}"`);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>企业选址洞察 · 隔离验证</title><style>*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%}html{--cd-header-height:54px;scroll-padding-top:54px}body{display:flex;flex-direction:column}img{max-width:100%;height:auto}${css}</style><body>${markup}<script>const exports={};${compile(path.join(directory, 'reportNavigation.ts'))};exports.mountReportNavigation(document.querySelector('[data-report-header]').parentElement);</script></body></html>`;
fs.writeFileSync(path.join(output, 'report.html'), html);
const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const { chromium } = nodeRequire(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PERF_BROWSER_CHANNEL || undefined });
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720], [1024, 700], [768, 1024], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    const photos = await page.locator('[data-scene-kind] img').evaluateAll(images => images.map(img => ({
      width: img.naturalWidth, sourceRatio: img.naturalWidth / img.naturalHeight,
      frameRatio: img.parentElement.clientWidth / img.parentElement.clientHeight,
      fit: getComputedStyle(img).objectFit,
    })));
    assert.equal(photos.length, 4);
    assert.ok(photos.every(photo => photo.width >= 2000 && Math.abs(photo.sourceRatio - photo.frameRatio) < .04 && photo.fit === 'contain'), 'All scene photographs must be high-resolution and displayed without cropping');
    assert.equal(await page.locator('main section').count(), 18);
    assert.equal(await page.locator('figure[data-study]').count(), 11);
    assert.equal(await page.locator('[data-survey-value]').count(), 62);
    assert.equal(await page.locator('h4').count(), 0);
    assert.equal(await page.locator('details').count(), 0);
    const content = await page.locator('body').innerText();
    assert.ok(!/AI\s*生成|戴德梁行/.test(content));
    for (const value of ['86.4', '69.1', '60.5', '54.3', '35.8', '7.4', '67.9']) assert.ok(content.includes(value));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}`);
    if (width >= 1000) {
      const sizes = await page.evaluate(() => [...document.querySelectorAll('main section')].map(el => ({
        id: el.id, height: el.getBoundingClientRect().height,
        available: innerHeight - document.querySelector('[data-report-header]').getBoundingClientRect().height,
      })));
      assert.deepEqual(sizes.filter(s => s.height > s.available + 2), [], 'Every desktop scene must fit the available viewport');
      await page.mouse.move(width / 2, height / 2);
      await page.mouse.wheel(0, 180);
      await page.waitForFunction(() => Math.abs(document.querySelector('#factors').getBoundingClientRect().top - document.querySelector('[data-report-header]').getBoundingClientRect().height) < 3, null, { timeout: 5000 });
      await page.mouse.wheel(0, -180);
      await page.waitForFunction(() => scrollY < 3);
    }
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 700);
    await page.waitForFunction(() => scrollY > 100);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, 0); });
    for (const [id, chapter] of [['report-top', 'cover'], ['factors', 'factors'], ['priorities', 'factors'], ['industry', 'industry'], ['checklist', 'checklist'], ['options', 'options']]) {
      await page.evaluate(id => {
        const header = document.querySelector('[data-report-header]').getBoundingClientRect().height;
        scrollTo(0, Math.max(0, document.getElementById(id).getBoundingClientRect().top + scrollY - header));
      }, id);
      await page.waitForFunction(chapter => document.querySelector('[data-report-header]').parentElement.dataset.activeChapter === chapter, chapter);
      assert.equal(await page.locator('nav [aria-current]').count(), chapter === 'cover' ? 0 : 1);
      assert.ok(await page.evaluate(() => Math.abs(document.querySelector('[data-report-header]').getBoundingClientRect().top) < 1));
      await page.evaluate(async () => { await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); });
      if (width === 1440 || width === 390) await page.screenshot({ animations: 'disabled', path: path.join(output, `${width}-${id}.png`) });
    }
    if (width === 1280) {
      for (const id of await page.locator('main section').evaluateAll(els=>els.map(el=>el.id))) {
        await page.evaluate(id=>document.getElementById(id).scrollIntoView({block:'start',behavior:'instant'}),id);
        await page.waitForFunction(id => [...document.querySelectorAll('#'+id+' [data-reveal]')].every(el=>el.dataset.visible==='true'), id);
        if (id === 'priorities') {
          assert.ok((await page.locator('#priorities [data-survey-value] dd').nth(0).evaluate(el=>getComputedStyle(el).animationName)).includes('value-rise'));
        }
        if (id === 'ecosystem') {
          assert.ok((await page.locator('#ecosystem figure > div > span').first().evaluate(el=>getComputedStyle(el).animationName)).includes('segment-arrive'));
        }
        await page.screenshot({animations:'disabled',path:path.join(output, 'laptop-'+id+'.png')});
      }
    }
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = ''; });
    await page.locator('nav a[href="#factors"]').click();
    await page.waitForFunction(() => Math.abs(document.getElementById('factors').getBoundingClientRect().top - document.querySelector('[data-report-header]').getBoundingClientRect().height) < 3);
    assert.equal(new URL(page.url()).hash, '#factors');
    assert.equal(await page.locator('a[href="/map"]').count(), 1);
    assert.equal(await page.locator('a[target="_blank"][rel="noopener noreferrer"]').count(), 0);
    assert.deepEqual(errors, []);
    results.push({ width, height, continuousScroll: true, stickyNav: true, activeChapter: true, anchorClearance: true, scenes: 18, plots: 11, dataPoints: 62, notes: 0, horizontalOverflow: false, errors });
    await page.close();
  }
  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await reduced.goto(`${url}/#checklist`);
  await reduced.waitForFunction(() => document.querySelector('[aria-current]')?.getAttribute('href') === '#checklist');
  assert.equal(await reduced.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  await reduced.close();
  if (process.argv[2]) {
    const anonymous = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const app = process.argv[2].replace(/\/$/, '');
    const response = await anonymous.goto(`${app}/occupier-insights`);
    assert.equal(response?.status(), 200);
    await anonymous.getByRole('heading', { name: '企业选址洞察', exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await anonymous.locator('h4').count(), 0);
    assert.equal(await anonymous.locator('main section').count(), 18);
    assert.equal(await anonymous.locator('[data-survey-value]').count(), 62);
    assert.equal(await anonymous.locator('a[href="/"], a[href="/map"]').count(), 0);
    const cover = anonymous.locator('#report-top img');
    assert.deepEqual(await cover.evaluate(async image => {
      await image.decode();
      return [new URL(image.currentSrc).pathname, image.naturalWidth, image.naturalHeight, image.loading, image.fetchPriority, getComputedStyle(image).transform, getComputedStyle(image).objectPosition];
    }), ['/occupier-insights/office-cover.avif', 1600, 900, 'eager', 'high', 'none', '65% 50%']);
    assert.equal(await anonymous.locator('main [data-scene-kind] img[loading="lazy"]').count(), 4);
    assert.deepEqual(await anonymous.evaluate(() => performance.getEntriesByType('resource')
      .map(entry => new URL(entry.name).pathname).filter(name => name.startsWith('/occupier-insights/'))),
    ['/occupier-insights/office-cover.avif'], 'Only one cover image belongs to the initial report load');
    assert.deepEqual(await cover.evaluate(async image => {
      image.parentElement.querySelector('source').remove();
      // Wait until the picture algorithm has selected the WebP fallback.
      await new Promise(resolve => requestAnimationFrame(resolve));
      await image.decode();
      return [new URL(image.currentSrc).pathname, image.naturalWidth, image.naturalHeight];
    }), ['/occupier-insights/office-cover.webp', 1600, 900]);
    assert.ok(await anonymous.evaluate(() => {
      const assets = performance.getEntriesByType('resource');
      const avif = assets.find(entry => entry.name.endsWith('/office-cover.avif'))?.encodedBodySize;
      const webp = assets.find(entry => entry.name.endsWith('/office-cover.webp'))?.encodedBodySize;
      return avif > 0 && avif < webp;
    }), 'The selected cover is smaller than its WebP fallback');

    await anonymous.locator('nav a[href="#options"]').click();
    await anonymous.waitForURL('**/occupier-insights#options');
    await anonymous.waitForFunction(() => document.querySelector('nav [aria-current]')?.getAttribute('href') === '#options');
    await anonymous.locator('footer a[href="#report-top"]').click();
    await anonymous.waitForURL('**/occupier-insights#report-top');
    await anonymous.goto(app + '/');
    await anonymous.waitForURL('**/login', { timeout: 15000 });
    await anonymous.goto(app + '/map');
    await anonymous.waitForURL('**/login', { timeout: 15000 });
    await anonymous.close();
    results.push({ anonymousReport: true, anonymousChapterNavigation: true, anonymousInternalLinks: 0, homeAndMapRequireLogin: true, avifCover: true, webpFallback: true, initialReportPhotos: 1 });
  }
  results.push({ reducedMotionAndDeepLink: true });
  console.log(JSON.stringify({ status: 'passed', results }, null, 2));
} finally {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
