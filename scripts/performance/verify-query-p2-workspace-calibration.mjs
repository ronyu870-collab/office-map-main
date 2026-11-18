// Collector calibration only. Controlled DOM delays below are never product
// performance evidence; the real P2 runner uses Auth/SQL/Next and no fake routes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { observeP2WorkspaceAction, summarizeP2WorkspacePerformance, p2WorkspaceErrorCode } from './verify-query-p2-workspace.mjs';

const good = { profile: 'desktop', scenario: 'history_list', status: 'success', feedback_ms: 30, content_usable_ms: 300,
  long_task_count: 1, long_task_total_ms: 70, long_task_max_ms: 70, factsVerified: true, boundedRenderingVerified: true,
  requestsVerified: true, receiptsVerified: true, longTaskObserverSupported: true, browser_validation_and_render_ms: 30 };
const rows = Array.from({ length: 20 }, () => ({ ...good }));
const summary = (values, scenario = 'history_list') => summarizeP2WorkspacePerformance(values).find(value => value.profile === 'desktop' && value.scenario === scenario);
assert.equal(summary(rows).budgetsMet, true);
assert.equal(summary(rows).metrics.long_task_max_ms.p90, 70);
assert.equal(summary(rows.slice(1)).missingSamples, 1);
assert.equal(summary(rows.slice(1)).measurementComplete, false);
assert.equal(summary([...rows.slice(1), { ...good, status: 'failed' }]).failed, 1);
assert.equal(summary([...rows.slice(1), { ...good, content_usable_ms: null }]).measurementComplete, false);
assert.equal(summary(rows.map(row => ({ ...row, receiptsVerified: false }))).measurementComplete, false);
assert.equal(summary(rows.map(row => ({ ...row, longTaskObserverSupported: false }))).measurementComplete, false);
assert.equal(summary(rows.map(row => ({ ...row, browser_validation_and_render_ms: -1 }))).measurementComplete, false);
assert.equal(summary(rows.map(row => ({ ...row, feedback_ms: 101 }))).budgetsMet, false);
assert.equal(summary(rows.map(row => ({ ...row, content_usable_ms: 2501 }))).budgetsMet, false);
assert.equal(summary(rows.map(row => ({ ...row, scenario: 'summary_reopen', content_usable_ms: 501 })), 'summary_reopen').budgetsMet, false);
assert.equal(summary(rows.map(row => ({ ...row, scenario: 'summary_reopen', content_usable_ms: 500 })), 'summary_reopen').budgetsMet, true);
assert.equal(summary(rows.map(row => ({ ...row, profile: 'mobile' }))).measurementComplete, false);
assert.equal(p2WorkspaceErrorCode(new Error('P2_HTTP_NOT_READY\n\n400 !== 200')), 'P2_HTTP_NOT_READY');
assert.equal(p2WorkspaceErrorCode(new Error('bearer credential or a business question')), 'P2_OPERATION_FAILED');
console.log('PASS P2 workspace summary calibration: all 20 samples, facts, bounds, requests, receipts, long-task support and per-path budgets are mandatory; diagnostics omit arbitrary messages');

if (!process.argv.includes('--summary-only')) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PERF_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH } : {}),
    ...(process.env.PERF_BROWSER_CHANNEL ? { channel: process.env.PERF_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    // Match the real icon-only toolbar entry: its accessible name is not textContent.
    await page.setContent('<button aria-label="历史记录"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 1 2 4M3 3v5h5" /></svg></button>');
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => {
      const loader = document.createElement('p'); loader.setAttribute('role', 'status');
      loader.textContent = '正在打开历史记录…'; document.body.append(loader);
      const aside = document.createElement('aside'); aside.setAttribute('aria-label', '历史工作记录');
      aside.innerHTML = '<p role="status">正在读取本人有权访问的工作记录…</p>';
      setTimeout(() => { loader.remove(); document.body.append(aside); }, 180);
      setTimeout(() => { aside.innerHTML = '<button disabled aria-label="打开对话：校准">校准</button>'; }, 240);
      setTimeout(() => { aside.querySelector('button').disabled = false; }, 320);
    }));
    await page.evaluate(observeP2WorkspaceAction, { mode: 'history_list', triggerAria: '历史记录', expectedCount: 1, expectedTitle: '校准' });
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    assert.equal(await page.evaluate(() => Number.isFinite(window.__colliersP2Workspace.state.start)), true,
      'The actual click on an icon-only history entry starts measurement through its accessible name');
    await page.waitForFunction(() => window.__colliersP2Workspace.state.status === 'ready');
    let measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    assert.ok(measured.feedback_ms < 150, 'The real dynamic loader before the aside mounts is visible feedback');
    assert.ok(measured.content_usable_ms >= 310, 'Module loader or disabled entries cannot substitute for usable history');
    assert.ok(measured.feedback_ms < measured.content_usable_ms);
    assert.equal(measured.mounted.historyEntries, 1);
    await page.evaluate(() => window.__colliersP2Workspace.stop());

    await page.setContent('<button aria-label="打开对话：校准">打开</button><aside aria-label="历史工作记录"><button aria-label="查看记录：校准">记录</button></aside><section aria-label="查询结果"><section aria-label="核心指标"><button>旧值</button></section></section>');
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => {
      setTimeout(() => {
        document.querySelector('section[aria-label="查询结果"]').remove();
        const section = document.createElement('section'); section.setAttribute('aria-label', '查询结果');
        section.innerHTML = '<section aria-label="核心指标"><button disabled>原始快照</button></section>'; document.body.append(section);
        setTimeout(() => { section.querySelector('button').disabled = false; }, 120);
      }, 140);
    }));
    await page.evaluate(observeP2WorkspaceAction, { mode: 'history_snapshot', triggerAria: '打开对话：校准', expectedCount: 1 });
    await page.getByRole('button', { name: '打开对话：校准', exact: true }).click();
    await page.waitForFunction(() => window.__colliersP2Workspace.state.status === 'ready');
    measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    assert.ok(measured.content_usable_ms >= 250, 'Stale result or new disabled numeric control cannot complete snapshot open');
    await page.evaluate(() => window.__colliersP2Workspace.stop());

    await page.setContent('<button>复制结论</button><p role="status"></p>');
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => {
      const button = document.querySelector('button'), message = document.querySelector('[role="status"]');
      button.disabled = true; message.textContent = '正在核对复制权限…';
      setTimeout(() => { const until = performance.now() + 65; while (performance.now() < until) { /* Long-task collector calibration. */ } }, 70);
      setTimeout(() => { message.textContent = '已复制，包含必要口径。'; }, 170);
      setTimeout(() => { button.disabled = false; }, 260);
    }));
    await page.evaluate(observeP2WorkspaceAction, { mode: 'copy', triggerText: '复制结论' });
    await page.getByRole('button', { name: '复制结论', exact: true }).click();
    await page.waitForFunction(() => window.__colliersP2Workspace.state.status === 'ready');
    measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    assert.ok(measured.content_usable_ms >= 250, 'Authorization feedback cannot substitute for completed usable copy');
    assert.ok(measured.long_task_count >= 1 && measured.long_task_max_ms >= 60);
    await page.evaluate(() => window.__colliersP2Workspace.stop());

    await page.setContent('<button>下一组楼宇</button><section aria-label="查询楼宇信息"><article aria-label="旧项目楼宇卡片"><p>CBD · A （当前目录）</p><a href="/map?old">详情</a></article></section>');
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => {
      const section = document.querySelector('section');
      // Reproduce the observed old-page-context transient: correct new row
      // identity can paint while its current directory is still unconfirmed.
      section.innerHTML = '<article aria-label="目标项目楼宇卡片"><p>子市场未知 · 等级未知 （当前目录）</p><a href="/map?new">详情</a></article>';
      setTimeout(() => { section.innerHTML = '<p role="status">正在核对楼宇访问权限…</p>'; }, 90);
      setTimeout(() => { section.innerHTML = '<article aria-label="目标项目楼宇卡片"><p>CBD · A （当前目录）</p><a href="/map?new">详情</a></article>'; }, 240);
    }));
    await page.evaluate(observeP2WorkspaceAction, { mode: 'buildings_page', triggerText: '下一组楼宇', expectedCount: 1,
      expectedNames: ['目标项目'], expectedMetadata: { submarket: 'CBD', grade: 'A' } });
    await page.getByRole('button', { name: '下一组楼宇', exact: true }).click();
    await page.waitForFunction(() => window.__colliersP2Workspace.state.status === 'ready');
    measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    assert.ok(measured.content_usable_ms >= 230, 'Old metadata, transient new names or loading rows cannot complete a page');
    assert.equal(measured.mounted.buildingCards, 1);
    await page.evaluate(() => window.__colliersP2Workspace.stop());

    await page.setContent('<button>生成分析摘要</button>');
    await page.evaluate(observeP2WorkspaceAction, { mode: 'summary', triggerText: '生成分析摘要', timeoutMs: 60 });
    await page.getByRole('button', { name: '生成分析摘要', exact: true }).click();
    await page.waitForFunction(() => window.__colliersP2Workspace.state.status === 'timeout');
    measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    assert.equal(measured.content_usable_ms, null); assert.equal(measured.feedback_ms, null);
    await page.evaluate(() => window.__colliersP2Workspace.stop());
    await page.close();
    console.log('PASS P2 paint collector calibration: disabled/stale content excluded, bounded cards confirmed, genuine Long Tasks collected, absent readiness retained as timeout; calibration timings are not product evidence');
  } finally { await browser.close(); }
}
