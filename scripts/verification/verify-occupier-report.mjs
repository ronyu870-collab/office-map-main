/**
 * Browser verification of the actual report component/CSS/controller in an isolated
 * authenticated-content fixture. Platform auth is mocked here, never in the app.
 * Optional argv[2] checks the anonymous boundary on the real production build.
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
const assets = load(path.join(cwd, 'src/constants/brandAssets.ts'));
function inlineImage(src) {
  if (src.startsWith('data:')) return src;
  assert.ok(/^\/occupier-insights\/[a-z-]+\.webp$/.test(src), `Unexpected fixture image: ${src}`);
  return `data:image/webp;base64,${fs.readFileSync(path.join(cwd, 'public', src)).toString('base64')}`;
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
  if (name.includes('SessionProvider')) return { useAppSession: () => ({ status: 'authenticated' }) };
  if (name.includes('brandAssets')) return assets;
  if (name === './reportNavigation') return { mountReportNavigation() {} };
  if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
  return nodeRequire(name);
});
const css = fs.readFileSync(path.join(directory, 'report.module.css'), 'utf8').replaceAll(':global(html)', 'html');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>企业选址洞察 · 隔离验证</title><style>*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%}html{--cd-header-height:54px;scroll-padding-top:54px}body{display:flex;flex-direction:column}img{max-width:100%;height:auto}${css}</style><body>${renderToStaticMarkup(React.createElement(report.OccupierInsightsReport))}<script>const exports={};${compile(path.join(directory, 'reportNavigation.ts'))};exports.mountReportNavigation(document.querySelector('[data-report-header]').parentElement);</script></body></html>`;
fs.writeFileSync(path.join(output, 'report.html'), html);
const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const { chromium } = nodeRequire(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of [[1440, 900], [1280, 800], [768, 1024], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    assert.equal(await page.locator('main section').count(), 6);
    assert.equal(await page.locator('h4').count(), 11);
    assert.equal(await page.locator('details').count(), 0);
    const content = await page.locator('body').innerText();
    assert.ok(!/AI\s*生成/.test(content));
    for (const value of ['86.4', '69.1', '60.5', '54.3', '35.8', '7.4', '67.9']) assert.ok(content.includes(value));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}`);
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 700);
    await page.waitForFunction(() => scrollY > 100);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, 0); });
    for (const [id, chapter] of [['report-top', 'cover'], ['factors', 'factors'], ['priorities', 'factors'], ['industry', 'industry'], ['checklist', 'checklist'], ['sources', 'sources']]) {
      await page.evaluate(id => {
        const header = document.querySelector('[data-report-header]').getBoundingClientRect().height;
        scrollTo(0, Math.max(0, document.getElementById(id).getBoundingClientRect().top + scrollY - header - 20));
      }, id);
      await page.waitForFunction(chapter => document.querySelector('[data-report-header]').parentElement.dataset.activeChapter === chapter, chapter);
      assert.equal(await page.locator('nav [aria-current]').count(), chapter === 'cover' ? 0 : 1);
      assert.ok(await page.evaluate(() => Math.abs(document.querySelector('[data-report-header]').getBoundingClientRect().top) < 1));
      if (width === 1440 || width === 390) await page.screenshot({ path: path.join(output, `${width}-${id}.png`) });
    }
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = ''; });
    await page.locator('nav a[href="#factors"]').click();
    await page.waitForFunction(() => Math.abs(document.getElementById('factors').getBoundingClientRect().top - document.querySelector('[data-report-header]').getBoundingClientRect().height - 20) < 3);
    assert.equal(new URL(page.url()).hash, '#factors');
    assert.equal(await page.locator('a[href="/map"]').count(), 1);
    assert.equal(await page.locator('a[target="_blank"][rel="noopener noreferrer"]').count(), 1);
    assert.deepEqual(errors, []);
    results.push({ width, height, continuousScroll: true, stickyNav: true, activeChapter: true, anchorClearance: true, notes: 11, horizontalOverflow: false, errors });
    await page.close();
  }
  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await reduced.goto(`${url}/#checklist`);
  await reduced.waitForFunction(() => document.querySelector('[aria-current]')?.getAttribute('href') === '#checklist');
  assert.equal(await reduced.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  await reduced.close();
  if (process.argv[2]) {
    const anonymous = await browser.newPage();
    await anonymous.goto(`${process.argv[2].replace(/\/$/, '')}/occupier-insights`);
    await anonymous.waitForURL('**/login', { timeout: 15000 });
    assert.equal(await anonymous.getByRole('heading', { name: '企业选址洞察', exact: true }).count(), 0);
    await anonymous.close();
    results.push({ anonymousProductionBuildRedirect: true });
  }
  results.push({ reducedMotionAndDeepLink: true });
  console.log(JSON.stringify({ status: 'passed', results }, null, 2));
} finally {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
