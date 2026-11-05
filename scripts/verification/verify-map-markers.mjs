/** Real map source + CSS in Chromium with isolated SDK geometry and synthetic data.
 * MAP_MARKER_BASE_REF enables identical before/after captures from Git.
 * MAP_MARKER_EXPECT_BASELINE_FAILURE=1 verifies these assertions catch the old defects.
 * This does not claim live AMap integration or physical iOS/Android verification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const output = path.resolve('verification/map-markers');
fs.mkdirSync(output, { recursive: true });
const baseRef = process.env.MAP_MARKER_BASE_REF;
const readSource = (file, ref) => ref ? execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }) : fs.readFileSync(file, 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;

function bundle(ref) {
  const modules = {};
  function add(file, source = readSource(file, ref)) {
    if (modules[file]) return;
    const entry = modules[file] = { code: compile(source), imports: {} };
    for (const [, specifier] of entry.code.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const resolved = specifier.startsWith('@/') ? specifier.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      assert.ok(specifier.startsWith('@/') || specifier.startsWith('.'), `Unexpected external import: ${specifier}`);
      const dependency = `${resolved}.ts`; entry.imports[specifier] = dependency; add(dependency);
    }
  }
  for (const file of ['mapVisualHierarchyV3', 'mapSubmarketCollisionAvoidance']) add(`src/app/map/runtime/${file}.ts`);
  // Execute the actual controller methods without importing its network/auth
  // dependencies. AST extraction fails loudly if their source contract changes.
  const source = readSource('src/services/MapController.ts', ref);
  const ast = ts.createSourceFile('MapController.ts', source, ts.ScriptTarget.Latest, true);
  const functions = ['toNullableFiniteNumber', 'getMarkerStyle'].map(name => {
    const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, `Controller function missing: ${name}`); return node.getText(ast);
  });
  const controller = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'MapController');
  assert.ok(controller, 'MapController class is required');
  const names = ['renderFutureMarkers', 'clearFutureMarkers'];
  if (source.includes('private removeFutureMarkerOverlays')) names.push('removeFutureMarkerOverlays');
  const methods = names.map(name => {
    const node = controller.members.find(node => ts.isMethodDeclaration(node) && node.name?.getText(ast) === name);
    assert.ok(node, `Controller method missing: ${name}`); return node.getText(ast);
  });
  const helperImport = source.includes('import { createFutureSupplyMarker }') ? "import { createFutureSupplyMarker } from './map/futureSupplyMarker';" : '';
  const zoomImport = source.includes('import { MAP_BUILDING_TIER_MIN_ZOOM }')
    ? "import { MAP_BUILDING_TIER_MIN_ZOOM } from '@/src/app/map/runtime/mapMarkerZoom';" : '';
  add('src/services/fixtureFutureMethods.ts', `${helperImport}\n${zoomImport}\n${functions.join('\n')}\nexport class FutureMethods { ${methods.join('\n')} }`);
  return modules;
}

const versions = { after: { ref: null, modules: bundle(null) } };
if (baseRef && !/^0+$/.test(baseRef)) versions.before = { ref: baseRef, modules: bundle(baseRef) };
const fixture = fs.readFileSync('scripts/verification/fixtures/map-markers.js', 'utf8');
const fixtureCss = `*{box-sizing:border-box}body{margin:0;font-family:Arial,"Noto Sans CJK SC",sans-serif;color:#25364a;background:#f3f6f8}header{height:86px;padding:15px 20px;background:#fff;border-bottom:1px solid #dce3e9}h1{font-size:16px;margin:0 0 8px}header p{margin:0;font-size:12px;color:#667085}#map-container{position:relative;width:100%;height:calc(100vh - 86px);overflow:hidden;background-color:#edf1ef;background-image:linear-gradient(90deg,transparent 48%,#fafbf9 48%,#fafbf9 52%,transparent 52%),linear-gradient(0deg,transparent 48%,#fafbf9 48%,#fafbf9 52%,transparent 52%);background-size:148px 112px}.fixture-layer{position:absolute;inset:0;pointer-events:none}.fixture-marker,.fixture-label,.fixture-dot{position:absolute;pointer-events:auto;white-space:nowrap;line-height:1}.fixture-label img{display:block;max-width:none}.fixture-label:not(.fixture-label-icon){text-shadow:0 1px 2px white}.fixture-marker{width:max-content}button{font:inherit}`;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.local'); const version = url.searchParams.get('version') || 'after';
  const entry = versions[version]; if (!entry) { response.statusCode = 404; return response.end('Unknown source version'); }
  if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(`window.fixtureModules=${JSON.stringify(entry.modules)};\n${fixture}`); }
  const css = ['src/app/map/map-workbench.css', 'src/app/map/map-native-overlays.css'].map(file => readSource(file, entry.ref)).join('\n');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Map marker regression</title><style>:root{--cd-header-height:86px}${fixtureCss}\n${css}</style><body><header><h1>地图标记 / ${version === 'before' ? '改动前' : '第一轮'}</h1><p>隔离合成数据 · 固定位置 · <span data-state></span></p></header><main><div id="map-container"></div></main><script src="/fixture.js?version=${version}"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

function failuresFor(snapshot, scene) {
  const failures = []; const check = (pass, message) => { if (!pass) failures.push(message); };
  check(!snapshot.overflow, 'viewport has no horizontal overflow');
  if (scene === 'selected') {
    check(Boolean(snapshot.selected?.source) && snapshot.selected.source === snapshot.details[0]?.source, 'selected artwork preserves the current metric and color');
    check(snapshot.selected?.animation === 'none' && snapshot.selected?.ringAnimation === 'none', 'selection has a static outline');
  } else if (scene === 'submarket') {
    check(snapshot.cards.length === 3, 'all three submarkets are visible');
    check(snapshot.futures.length === 0, 'future points stay hidden at overview zoom');
    for (const card of snapshot.cards) {
      check(card.box.width >= card.box.height * 1.4, `${card.name}: compact rectangle, not a large circle`);
      check(card.tag === 'BUTTON', `${card.name}: keyboard-operable button`);
      check(card.box.x >= snapshot.map.x + 6 && card.box.right <= snapshot.map.right - 6, `${card.name}: contained inside map`);
      if (card.name.length > 12) check(card.heading.height >= 30 && card.box.height > 64, 'long submarket name uses two lines without shrinking metrics');
      for (const metric of card.metrics) {
        check(metric.font >= 12, `${card.name}: readable metric type`);
        check(metric.box.x >= card.box.x && metric.box.right <= card.box.right, `${card.name}: metric fits card`);
      }
    }
    for (let a = 0; a < snapshot.cards.length; a++) for (let b = a + 1; b < snapshot.cards.length; b++) {
      const x = snapshot.cards[a].box; const y = snapshot.cards[b].box;
      check(x.right <= y.x + 1 || y.right <= x.x + 1 || x.bottom <= y.y + 1 || y.bottom <= x.y + 1, 'card rectangles do not overlap');
    }
  } else if (scene === 'building') {
    check(snapshot.cards.length === 0, 'overview cards hidden in building tier');
    check(snapshot.details.length === 3, 'three native metric badges');
    for (const badge of snapshot.details) {
      check(badge.font >= 12, `${badge.text}: metric font is readable`);
      check(badge.width > badge.height && badge.rectangles > 0, `${badge.text}: rectangular metric badge`);
    }
    check(snapshot.futures.length === 2, 'future markers have semantic DOM content');
    for (const marker of snapshot.futures) {
      check(marker.box.width >= 44 && marker.box.height >= 44, 'future touch target >= 44px');
      check(marker.outline === 'dashed', 'future outline remains dashed in every mode');
      check(marker.timeVisible && marker.font >= 12, 'future time readable at detail zoom');
    }
  } else {
    check(snapshot.cards.length === 0, 'overview cards hidden in dot tier');
    check(snapshot.futures.length === 0, 'future points stay hidden at dot zoom');
  }
  return failures;
}

const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
let browser;
const results = { fixture: 'Actual V3/collision/controller methods/helper/CSS; synthetic data and SDK geometry', baseRef: baseRef || null, physicalDevices: 'not tested', liveAMap: 'not tested', browser: null, cases: [], interactions: [] };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PERF_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
  results.browser = browser.version();
  for (const version of Object.keys(versions).reverse()) for (const [width, height] of [[1280, 800], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 640, hasTouch: width < 640 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?version=${version}`);
    await page.waitForFunction(() => window.markerFixture);
    for (const [scene, zoom] of [['submarket', 11.2], ['dot', 12.2], ['building', 14.4]]) {
      const mode = scene === 'submarket' ? 'default' : 'rent';
      await page.evaluate(([m, z]) => window.markerFixture.set(m, z), [mode, zoom]);
      const snapshot = await page.evaluate(() => window.markerFixture.inspect());
      const failures = failuresFor(snapshot, scene);
      results.cases.push({ version, width, scene, mode, failures, snapshot });
      await page.screenshot({ path: path.join(output, `${version}-${width}-${scene}.png`) });
      if (version === 'after') assert.deepEqual(failures, [], `${width}px ${scene}`);
    }
    // Identical activation and selected-state captures for both source versions.
    const stock = page.locator('.fixture-label-icon[data-id="stock-a"]');
    if (width < 640) await stock.tap(); else await stock.click();
    const selectedSnapshot = await page.evaluate(() => window.markerFixture.inspect());
    const selectionFailures = failuresFor(selectedSnapshot, 'selected');
    results.cases.push({ version, width, scene: 'selected', mode: 'rent', failures: selectionFailures, snapshot: selectedSnapshot });
    await page.screenshot({ path: path.join(output, `${version}-${width}-selected.png`) });
    if (version === 'after') {
      // Actual DOM activation -> SDK click bridge -> production selection.
      assert.deepEqual(selectionFailures, []);
      let selected = await page.evaluate(() => window.markerFixture.inspect());
      assert.equal(selected.selected.source, selected.details[0].source, 'selected artwork preserves the current metric and color');
      assert.equal(selected.selected.animation, 'none'); assert.equal(selected.selected.ringAnimation, 'none');
      const selectedBox = selected.selected.box;
      await page.waitForTimeout(230);
      assert.deepEqual((await page.evaluate(() => window.markerFixture.inspect())).selected.box, selectedBox, 'selection stays still');
      for (const mode of ['default', 'vacancy', 'leed']) {
        await page.evaluate(m => window.markerFixture.set(m, 14.4), mode);
        selected = await page.evaluate(() => window.markerFixture.inspect());
        assert.deepEqual(failuresFor(selected, 'building'), []);
        assert.equal(selected.selected.source, selected.details[0].source, 'selection updates when the metric mode changes');
        assert.equal(selected.futures.find(item => item.id === 'future-quarter').glyph, mode === 'leed' ? 'G' : 'F');
        assert.equal(selected.futures.find(item => item.id === 'future-pending').time, '待核实');
      }
      const future = page.getByRole('button', { name: /查看合成未来项目/ });
      await future.focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => window.markerFixture.calls.future), ['future-quarter'], 'keyboard opens future project once');
      if (width < 640) await future.tap(); else await future.click();
      assert.deepEqual(await page.evaluate(() => window.markerFixture.calls.future), ['future-quarter', 'future-quarter'], 'pointer opens future project once');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.map-selected-marker__ring').evaluate(element => getComputedStyle(element).animationName), 'none');
      await page.evaluate(() => window.markerFixture.set('default', 11.2));
      const card = page.getByRole('button', { name: /查看CBD/ });
      await card.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.markerFixture.calls.zoom.length), 1, 'keyboard overview activation navigates once');
      assert.equal(await page.locator('#map-container').getAttribute('data-marker-tier'), 'dot');
      results.interactions.push({ width, input: width < 640 ? 'emulated touch and keyboard' : 'mouse and keyboard', staticSelection: true, selectionFollowsMode: true, futureIdentityInAllModes: true, futureActivationOncePerAction: true, overviewKeyboardNavigation: true, reducedMotion: true });
    }
    assert.deepEqual(errors, [], 'no browser runtime errors'); await page.close();
  }
  if (process.env.MAP_MARKER_EXPECT_BASELINE_FAILURE === '1') assert.ok(results.cases.some(item => item.version === 'before' && item.failures.length > 0), 'same regression must catch the old implementation');
  console.log(JSON.stringify({ status: 'passed', browser: results.browser, viewports: [1280, 390, 320], baselineFailures: results.cases.filter(item => item.version === 'before').reduce((sum, item) => sum + item.failures.length, 0), actualSourceRegression: true, output }, null, 2));
} finally {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
