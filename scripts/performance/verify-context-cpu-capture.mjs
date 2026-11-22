import assert from 'node:assert/strict';
import { cpuProfilesFromTrace, observeContextLongTasks, scopeContextTasks } from './fixtures/context-cpu-profile.mjs';
import { sanitizeCpuProfile, sanitizeMainThreadTrace, summarizeLongTasks } from './fixtures/long-task-profile.mjs';
import { beginLiveAmapSample, finishLiveAmapSample } from './fixtures/live-amap-probe.mjs';

// Real Chrome protocol calibration; no provider, business data or wall-time
// performance budget. Intentional blocking only tests that capture finds it.
export async function verifyContextCpuCapture(browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent('<main>CPU capture calibration</main>');
    await page.evaluate(observeContextLongTasks);
    const cdp = await context.newCDPSession(page), trace = [];
    await cdp.send('Performance.enable');
    cdp.on('Tracing.dataCollected', event => trace.push(...event.value));
    await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-v8.cpu_profiler'], enableSampling: true }, transferMode: 'ReportEvents' });
    let startTime, endTime;
    try {
      await page.evaluate(() => setTimeout(function outsideActionBlock() {
        window.__outsideStart = performance.now();
        const end = performance.now() + 80;
        while (performance.now() < end) Math.sqrt(Math.random());
        window.__outsideDone = true;
      }, 0));
      await page.waitForFunction(() => window.__outsideDone && window.__liveAmapContextTasks.some(task => task.startTime <= window.__outsideStart && task.startTime + task.duration >= window.__outsideStart));
      startTime = await page.evaluate(() => performance.now());
      await page.evaluate(() => setTimeout(function measuredActionBlock() {
        window.__measuredStart = performance.now();
        const end = performance.now() + 80;
        while (performance.now() < end) Math.sqrt(Math.random());
        window.__measuredDone = true;
      }, 0));
      await page.waitForFunction(() => window.__measuredDone && window.__liveAmapContextTasks.some(task => task.startTime <= window.__measuredStart && task.startTime + task.duration >= window.__measuredStart));
      endTime = await page.evaluate(() => performance.now());
    } finally {
      const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.end'); await complete;
    }
    const profiles = cpuProfilesFromTrace(trace);
    assert.equal(profiles.length, 1);
    const profile = profiles[0];
    const tasks = await page.evaluate(() => window.__liveAmapContextTasks);
    const navigationStart = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value])).NavigationStart;
    const details = summarizeLongTasks({ tasks, profile, trace, navigationStart, origin: 'http://localhost' });
    const scopes = scopeContextTasks(tasks, [{ name: 'measured', startTime, endTime }]);
    for (const [name, actions] of [['outsideActionBlock', []], ['measuredActionBlock', ['measured']]]) {
      const index = details.findIndex(task => task.topStacks.some(item => item.stack.some(frame => frame.function === name)));
      assert.ok(index >= 0, `full CPU stack required for ${name}`);
      assert.ok(details[index].duration >= 50);
      assert.deepEqual(scopes[index].actions, actions);
    }
    assert.ok(sanitizeCpuProfile(profile).samples.length > 0);
    assert.ok(sanitizeMainThreadTrace(trace).some(event => event.name === 'FunctionCall'));
    await page.addScriptTag({ content: `window.__sampleStart = ${beginLiveAmapSample.toString()}; window.__sampleStop = ${finishLiveAmapSample.toString()};` });
    await page.evaluate(() => {
      window.__liveAmapProbe = { calls: [], events: [], created: 0 };
      for (let index = 0; index < 3; index++) { window.__sampleStart(); window.__sampleStop(); }
      window.__sampleStart();
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const frames = await page.evaluate(() => { const sample = window.__liveAmapProbe.sample; window.__sampleStop(); return sample.intervals; });
    assert.ok(frames.length > 0 && frames.every(interval => interval > 0), 'ended sample callbacks must not duplicate the current RAF clock');
  } finally { await context.close(); }
}
