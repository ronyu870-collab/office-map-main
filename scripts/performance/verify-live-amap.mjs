import { clickWorkspaceAction } from '../verification/workspace-actions.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { user, session, stock, project, stacking } from './fixtures/workspace-data.mjs';
import { installLiveAmapProbe, waitForLiveAmapTiles, beginLiveAmapSample, finishLiveAmapSample } from './fixtures/live-amap-probe.mjs';
import { summarizeLongTasks, sanitizeCpuProfile, sanitizeMainThreadTrace, sanitizeErrorStack } from './fixtures/long-task-profile.mjs';
import { cpuProfilesFromTrace, observeContextLongTasks, scopeContextTasks } from './fixtures/context-cpu-profile.mjs';

const profileCPU = process.env.PERF_PROFILE_CPU === '1';
const profileMode = process.env.PERF_PROFILE_MODE ?? 'profiler';
assert.ok(['profiler', 'timeline'].includes(profileMode), 'PERF_PROFILE_MODE must be profiler or timeline');
const contextProfile = profileMode === 'timeline';
if (contextProfile && !profileCPU) throw new Error('Timeline CPU capture requires PERF_PROFILE_CPU=1');
const rounds = Number(process.env.PERF_ACTION_ROUNDS ?? 3);
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20, 'PERF_ACTION_ROUNDS must be an integer from 1 to 20');
const screenshotDirectory = process.env.PERF_SCREENSHOT_DIR;
if (screenshotDirectory) fs.mkdirSync(screenshotDirectory, { recursive: true, mode: 0o700 });
const profileDirectory = process.env.PERF_PROFILE_DIR;
if (profileDirectory && !profileCPU) throw new Error('PERF_PROFILE_DIR requires PERF_PROFILE_CPU=1');
if (profileDirectory) fs.mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });

// Real SDK + real provider tiles. Business/auth responses remain isolated fixtures.
// Run only against a local production build with valid NEXT_PUBLIC_AMAP_* config.
const [url, output] = process.argv.slice(2);
if (!url || !output) throw new Error('Usage: verify-live-amap.mjs http://127.0.0.1:3211 /tmp/result.json');
const base = new URL(url);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'local fixture server required');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const provider = host => /(^|\.)(amap\.com|amap\.cn|autonavi\.com|autonavi\.cn|gaode\.com)$/.test(host);
// Spread 601 located projects over Beijing, retaining the two primary focus targets.
const buildings = [...stock, ...Array.from({ length: 598 }, (_, i) => ({
  ...stock[0], id: `load-${i}`, name: `性能样本${String(i).padStart(3, '0')}`, submarket: '其他',
  location_lng: 116.22 + (i % 30) * .012, location_lat: 39.78 + Math.floor(i / 30) * .012,
}))];
const results = { cpuProfilingEnabled: profileCPU, profileMode: profileCPU ? profileMode : null, actionRounds: rounds, timingScope: profileCPU ? 'diagnostic sampling; not comparable to unprofiled benchmark' : 'unprofiled benchmark', schema: 1, environment: 'production React + real AMap 2.0/tiles + isolated business/auth fixtures',
  collectedAt: new Date().toISOString(), applicationCommit: process.env.PERF_COMMIT ?? 'unrecorded',
  browser: await browser.version(), locatedProjects: 601, scenarios: [], limitations: [
    'Mobile is a desktop Chrome viewport, not an iOS/Android device.',
    'No production authentication, database, business records or writes are exercised.',
    'Frame intervals describe this machine/sample; CPU paint trace time is not GPU execution time.',
    'Each route transition creates its own map; panel transitions must retain that route map.',
  ] };
let phase = 'gpu-configuration';
let activeNetwork = null;
try {
  const system = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  results.gpu = { renderer: system.gpu.auxAttributes?.glRenderer, features: system.gpu.featureStatus };
  for (const [width, height, reduced] of [[1536,900,false], [390,560,false], [390,560,true]]) {
    phase = `${width}/${reduced ? 'reduced' : 'motion'}/startup`;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
    const network = { sdkOK: 0, tileOK: 0, providerHTTPFailures: 0, failedRequests: 0, abortedRequests: 0, blockedHosts: [] };
    activeNetwork = network;
    const errors = [];
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (target.origin === base.origin) {
        if (target.pathname === '/api/map/data') return route.fulfill({ json: { buildings, display_overrides: [] } });
        if (target.pathname === `/api/stacking-plan/${project}`) return route.fulfill({ json: stacking });
        if (target.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
        return route.continue();
      }
      if (target.origin === 'https://example.supabase.co') return route.fulfill({ headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' }, json: target.pathname === '/rest/v1/user_roles' ? [{ role: 'admin', session_id: user.id }] : [] });
      if (provider(target.hostname)) return route.continue();
      if (!network.blockedHosts.includes(target.hostname)) network.blockedHosts.push(target.hostname);
      return route.abort();
    });
    await context.addInitScript(({ origin, session }) => {
      if (location.origin !== origin) return;
      localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86400000));
      localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
    }, { origin: base.origin, session });
    await context.addInitScript(installLiveAmapProbe);
    if (contextProfile) await context.addInitScript(observeContextLongTasks);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(10000);
    // Error classes only: SDK errors may contain credentials or query strings.
    page.on('pageerror', error => errors.push(sanitizeErrorStack(error)));
    page.on('response', response => {
      const target = new URL(response.url());
      if (!provider(target.hostname)) return;
      if (response.status() >= 400) network.providerHTTPFailures++;
      if (response.ok() && target.hostname === 'webapi.amap.com' && target.pathname === '/maps') network.sdkOK++;
      if (response.ok() && /\/tile\/|\/get_tile$/.test(target.pathname)) network.tileOK++;
    });
    page.on('requestfailed', request => {
      if (!provider(new URL(request.url()).hostname)) return;
      if (request.failure()?.errorText === 'net::ERR_ABORTED') network.abortedRequests++;
      else network.failedRequests++;
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    if (profileCPU && !contextProfile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    }
    const trace = [];
    cdp.on('Tracing.dataCollected', event => trace.push(...event.value));
    const contextScenarios = [];
    if (contextProfile) await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-v8.cpu_profiler'], enableSampling: true }, transferMode: 'ReportEvents' });
    try {
      const detail = page.getByRole('region', { name: 'CBD甲楼楼宇详情' });
      const list = page.getByRole('region', { name: '项目列表', exact: true });
      const camera = () => page.evaluate(() => { const m = window.__workspaceMap, c = m.getCenter(); return { zoom: m.getZoom(), center: [c.lng, c.lat] }; });
      const focus = async (center = [116.46, 39.91]) => {
        await page.waitForFunction(target => { const m = window.__workspaceMap, c = m?.getCenter(); return c && m.getZoom() >= 13.99 && Math.abs(c.lng - target[0]) < .00001 && Math.abs(c.lat - target[1]) < .00001; }, center);
      };
      const measure = async (name, action) => {
        phase = `${width}/${reduced ? 'reduced' : 'motion'}/${name}`;
        const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
        await page.evaluate(beginLiveAmapSample);
        if (!contextProfile) {
          trace.length = 0;
          if (profileCPU) await cdp.send('Profiler.start');
          await cdp.send('Tracing.start', { categories: profileCPU ? 'devtools.timeline,v8,disabled-by-default-v8.gc' : 'devtools.timeline', transferMode: 'ReportEvents' });
        }
        await action();
        await page.waitForTimeout(1200);
        const sample = await page.evaluate(finishLiveAmapSample);
        sample.navigationStart = before.NavigationStart;
        if (!contextProfile) {
          const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
          await cdp.send('Tracing.end'); await complete;
          const profile = profileCPU ? (await cdp.send('Profiler.stop')).profile : null;
          if (profile) sample.longTaskDetails = summarizeLongTasks({ tasks: sample.longTasksMs, profile, trace, navigationStart: before.NavigationStart, origin: base.origin });
          if (profile && profileDirectory && sample.longTasksMs.length) {
            const stem = `${width}-${reduced ? 'reduced' : 'motion'}-${name}`;
            fs.writeFileSync(path.join(profileDirectory, `${stem}.cpuprofile`), JSON.stringify(sanitizeCpuProfile(profile)), { mode: 0o600 });
            fs.writeFileSync(path.join(profileDirectory, `${stem}.trace.json`), JSON.stringify({ traceEvents: sanitizeMainThreadTrace(trace), navigationStart: before.NavigationStart, tasks: sample.longTasksMs }), { mode: 0o600 });
            sample.profileFile = `${stem}.cpuprofile`;
            sample.traceFile = `${stem}.trace.json`;
          }
          sample.longTasksMs = sample.longTasksMs.map(task => task.duration);
        }
        const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
        sample.cpuMs = Object.fromEntries(['LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration'].map(name=>[name,(after[name]-before[name])*1000]));
        if (!contextProfile) sample.paintTraceMs = trace.filter(x=>x.name==='Paint' && x.ph==='X').reduce((sum,x)=>sum+(x.dur??0)/1000,0);
        sample.camera = await camera();
        const scenario = { width, height, reduced, name, ...sample };
        results.scenarios.push(scenario); contextScenarios.push(scenario);
        console.log(`completed ${width}/${reduced ? 'reduced' : 'motion'} ${name}`);
        return sample;
      };
      await page.goto(new URL(`/map?building=${project}`, base).href);
      await detail.waitFor(); await focus();
      await page.waitForFunction(() => window.__liveAmapProbe.events.some(e=>e.name==='complete'));
      // SDK complete/target camera can precede the first response in a warm or
      // small viewport. Require real transport success without an early race.
      await waitForLiveAmapTiles(page, network);
      assert.ok(network.tileOK > 0 && network.sdkOK > 0, 'real provider SDK and tile responses required');
      const startup = await page.evaluate(() => window.__liveAmapProbe.stages);
      await page.getByRole('tab', { name: '成交与资料', exact: true }).click();
      if (width === 390) await clickWorkspaceAction(page, '展开到阅读高度');
      const link = page.getByRole('link', { name: 'Stacking Plan', exact: true });
      await link.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
      const top = await detail.locator('.workspace-scroll').evaluate(e => e.scrollTop);
      const beforeCamera = await camera();
      for (let round = 0; round < rounds; round++) {
        await link.click(); await page.waitForURL(u => u.pathname === `/stacking-plan/${project}`);
        await page.getByRole('button', { name: /A 座 60层 连续性租户599/ }).waitFor();
        await measure(`stack-return-${round}`, async () => {
          await page.getByRole('link', { name: '返回项目详情', exact: true }).click(); await detail.waitFor(); await focus();
          assert.equal(await page.getByRole('tab', { name: '成交与资料', exact: true }).getAttribute('aria-selected'), 'true');
          await page.waitForFunction(top => Math.abs(document.querySelector('.workspace-building-scroll')?.scrollTop - top) < 2, top);
          assert.equal(await page.locator('.map-selected-marker').count(), 1);
        });
        const afterCamera = await camera();
        const initialCamera = await page.evaluate(() => window.__liveAmapProbe.initialCameras.at(-1));
        assert.ok(Math.abs(initialCamera.zoom - beforeCamera.zoom) < .01, 'return must construct at saved zoom');
        assert.ok(initialCamera.center.every((v,i)=>Math.abs(v-beforeCamera.center[i])<.00001), 'return must construct at saved center');
        assert.ok(Math.abs(afterCamera.zoom - beforeCamera.zoom) < .01);
        assert.ok(afterCamera.center.every((v,i)=>Math.abs(v-beforeCamera.center[i])<.00001));
      }
      await link.click(); await page.waitForURL(u => u.pathname === `/stacking-plan/${project}`);
        await page.getByRole('button', { name: /A 座 60层 连续性租户599/ }).waitFor();
      await page.goBack({waitUntil:'commit'}); await detail.waitFor(); await focus();
      await page.goForward({waitUntil:'commit'}); await page.waitForURL(u => u.pathname === `/stacking-plan/${project}`);
      await page.getByRole('button', { name: /A 座 60层 连续性租户599/ }).waitFor();
      await measure('history-return', async () => { await page.goBack({waitUntil:'commit'}); await detail.waitFor(); await focus(); });
      for (let round = 0; round < rounds; round++) {
        const filter = await measure(`filter-toggle-${round}`, async () => {
          await page.getByRole('button', { name: '筛选', exact: true }).click();
          await page.waitForTimeout(70);
          await page.getByRole('button', { name: '筛选', exact: true }).click();
        });
        assert.equal(filter.newMapInstances, 0, 'filter reversal must retain map');
        const close = await measure(`panel-close-${round}`, async () => { await page.getByRole('button', { name: '关闭楼宇详情' }).click(); });
        assert.equal(close.newMapInstances, 0, 'panel close must retain map');
        assert.ok(close.resizeCalls <= 2, `coalesced resize expected, got ${close.resizeCalls}`);
        const open = await measure(`panel-open-${round}`, async () => {
          await page.getByRole('button', { name: '项目列表', exact: true }).click(); await list.waitFor();
          await list.getByRole('button', { name: /^CBD甲楼/ }).click(); await detail.waitFor(); await focus();
        });
        assert.equal(open.newMapInstances, 0, 'panel open must retain map');
        await measure(`rapid-switch-${round}`, async () => {
          await page.getByRole('button', { name: '项目列表', exact: true }).click(); await list.waitFor();
          await list.getByRole('button', { name: /^CBD乙楼/ }).click();
          await page.getByRole('button', { name: '关闭楼宇详情' }).click();
          await page.getByRole('button', { name: '项目列表', exact: true }).click();
          await list.getByRole('button', { name: /^CBD甲楼/ }).click(); await detail.waitFor(); await focus();
        });
        await focus(); assert.equal(await page.locator('.map-selected-marker').count(),1);
      }
      if (screenshotDirectory && width === 1536) {
        for (const mode of ['租金', '空置', 'LEED', '项目']) {
          await measure(`display-mode-${mode}`, async () => {
            await page.getByRole('button', { name: mode, exact: true }).click();
            await focus();
            assert.equal(await page.locator('.map-selected-marker').count(), 1);
            await page.waitForFunction(() => document.querySelector('.map-selected-marker img')?.naturalWidth > 0);
          });
          await page.screenshot({ path: path.join(screenshotDirectory, `selected-${mode}.png`) });
        }
      }
      results.scenarios.push({width,height,reduced,name:'startup-and-network',startup,network,errors,readingScroll:top});
      assert.deepEqual(errors, []);
      assert.equal(network.providerHTTPFailures, 0);
      assert.equal(network.failedRequests, 0);
    } finally {
      if (contextProfile) {
        const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end'); await complete;
        const profiles = cpuProfilesFromTrace(trace);
        const stem = `${width}-${reduced ? 'reduced' : 'motion'}-context`;
        const navigationStart = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value])).NavigationStart;
        const tasks = await page.evaluate(() => window.__liveAmapContextTasks ?? []);
        const scopes = scopeContextTasks(tasks, contextScenarios);
        if (profileDirectory) {
          for (const [index, profile] of profiles.entries()) fs.writeFileSync(path.join(profileDirectory, `${stem}-${index}.cpuprofile`), JSON.stringify(sanitizeCpuProfile(profile)), { mode: 0o600 });
          fs.writeFileSync(path.join(profileDirectory, `${stem}.trace.json`), JSON.stringify({ traceEvents: sanitizeMainThreadTrace(trace), navigationStart, tasks: scopes }), { mode: 0o600 });
        }
        // Never silently attribute a different renderer's CPU or a reset clock.
        assert.equal(profiles.length, 1, 'one renderer-main CPU profile required');
        assert.ok(contextScenarios.every(sample => sample.navigationStart === navigationStart), 'context navigation clock must remain stable');
        const profile = profiles[0];
        for (const sample of contextScenarios) {
          sample.longTaskDetails = summarizeLongTasks({ tasks: sample.longTasksMs, profile, trace, navigationStart, origin: base.origin });
          sample.longTasksMs = sample.longTasksMs.map(task => task.duration);
          sample.profileFile = `${stem}-0.cpuprofile`; sample.traceFile = `${stem}.trace.json`;
        }
        results.scenarios.push({ width, height, reduced, name: 'context-cpu-capture',
          profileFile: `${stem}-0.cpuprofile`, traceFile: `${stem}.trace.json`,
          profileStats: { nodes: profile.nodes.length, samples: profile.samples.length },
          tasks: scopes, longTaskDetails: summarizeLongTasks({ tasks, profile, trace, navigationStart, origin: base.origin }) });
      }
      await context.close();
    }
  }
  results.status = 'passed';
} catch (error) {
  results.status = 'failed'; results.failure = { name: error.name, phase, code: error.code ?? null, network: activeNetwork };
  const page=browser.contexts().at(-1)?.pages().at(-1);
  if(page){
    results.failure.state=await page.evaluate(()=>({path:location.pathname})).catch(()=>null);
  }
  // Do not emit raw browser/SDK error messages with URLs/configuration values.
  console.error(`Live AMap validation failed: ${error.name}; see sanitized result and scenario logs.`);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(output, JSON.stringify(results, null, 2)+'\n', {mode:0o600});
  await browser.close();
}
