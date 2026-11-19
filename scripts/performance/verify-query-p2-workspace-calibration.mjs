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
assert.equal(summary(rows.map(row => ({ ...row, scenario: 'history_earlier_turns' })), 'history_earlier_turns').measurementComplete, false);
assert.equal(summary(rows.map(row => ({ ...row, scenario: 'history_earlier_turns', timelinePresentationVerified: true })), 'history_earlier_turns').measurementComplete, true);
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

    await page.setContent('<button aria-label="打开对话：校准">打开</button><aside aria-label="历史工作记录"><button aria-label="查看记录：校准">记录</button></aside><article aria-label="本次问答" data-query-turn="old"><section aria-label="查询结果"><section aria-label="核心指标"><button>旧值</button></section></section></article>');
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => {
      setTimeout(() => {
        document.querySelector('section[aria-label="查询结果"]').remove();
        const section = document.createElement('section'); section.setAttribute('aria-label', '查询结果');
        section.innerHTML = '<section aria-label="核心指标"><button disabled>原始快照</button></section>'; document.querySelector('article').append(section);
        setTimeout(() => { section.querySelector('button').disabled = false; }, 120);
      }, 140);
    }));
    await page.evaluate(observeP2WorkspaceAction, { mode: 'history_snapshot', triggerAria: '打开对话：校准', expectedCount: 1, expectedTranscriptCount: 1 });
    await page.getByRole('button', { name: '打开对话：校准', exact: true }).click();
    await page.waitForFunction(() => window.__colliersP2Workspace.state.status === 'ready');
    measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    assert.ok(measured.content_usable_ms >= 250, 'Stale result or new disabled numeric control cannot complete snapshot open');
    await page.evaluate(() => window.__colliersP2Workspace.stop());

    await page.setContent('<button>加载更早问答</button><aside aria-label="历史工作记录"><button aria-label="查看记录：校准">记录</button></aside><article aria-label="本次问答" data-query-turn="current"><section aria-label="查询结果"><section aria-label="核心指标"><button>当前值</button></section></section></article>');
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => {
      const button = document.querySelector('button'); button.disabled = true; button.textContent = '正在加载更早问答…';
      setTimeout(() => {
        const earlier = document.createElement('article'); earlier.setAttribute('aria-label', '此前问答'); earlier.dataset.queryTurn = 'earlier';
        earlier.innerHTML = '<p>已授权的更早回答</p><button data-query-result-disclosure="earlier" disabled>展开数据与来源</button>';
        document.querySelector('article').before(earlier);
        setTimeout(() => { earlier.querySelector('button').disabled = false; button.disabled = false; button.textContent = '加载更早问答'; }, 120);
      }, 140);
    }));
    await page.evaluate(observeP2WorkspaceAction, { mode: 'history_turns', triggerText: '加载更早问答', expectedCount: 1, expectedTranscriptCount: 2 });
    await page.getByRole('button', { name: '加载更早问答', exact: true }).click();
    await page.waitForFunction(() => window.__colliersP2Workspace.state.status === 'ready');
    measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    assert.ok(measured.content_usable_ms >= 250, 'A disabled earlier-result control cannot complete timeline prepending');
    assert.ok(measured.feedback_ms < measured.content_usable_ms);
    assert.equal(measured.mounted.transcriptTurns, 2); assert.equal(measured.mounted.results, 1);
    await page.evaluate(() => window.__colliersP2Workspace.stop());

    await page.setContent('<button>复制结论</button><p role="status"></p>');
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => {
      const button = document.querySelector('button'), message = document.querySelector('[role="status"]');
      button.disabled = true; message.textContent = '正在复制…';
      setTimeout(() => { const until = performance.now() + 65; while (performance.now() < until) { /* Long-task collector calibration. */ } }, 70);
      setTimeout(() => { message.textContent = '已复制结论。'; }, 170);
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

    // Opening a saved building result first paints the history panel's busy state.
    // Stage each DOM change after a real click; none of these fixture timings is
    // a performance sample, and neither a loader nor a stale result is usable.
    const buildingNames = Array.from({ length: 5 }, (_, index) => `校准楼宇${index + 1}`);
    const buildingMarkup = ({ count = 5, metadata = 'CBD · A （当前目录）', omitLastMap = false } = {}) => buildingNames.slice(0, count)
      .map((name, index) => `<article aria-label="${name}楼宇卡片"><p>${metadata}</p>${omitLastMap && index === count - 1 ? '' : `<a href="/map?building=${index}">详情</a>`}</article>`).join('');
    const readAfterPaint = () => page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.__colliersP2Workspace.read();
    });
    const setBuildingMarkup = async markup => {
      await page.evaluate(html => { document.querySelector('section[aria-label="查询楼宇信息"]').innerHTML = html; }, markup);
      return readAfterPaint();
    };
    await page.setContent(`<button aria-label="打开对话：楼宇校准">打开</button><p id="outside-history-status" role="status"></p><aside aria-label="历史工作记录"><p role="status"></p></aside><section aria-label="查询结果"><section aria-label="查询楼宇信息">${buildingMarkup()}</section></section>`);
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => {
      document.getElementById('outside-history-status').textContent = '正在读取历史记录…';
    }));
    await page.evaluate(observeP2WorkspaceAction, { mode: 'buildings_snapshot', triggerAria: '打开对话：楼宇校准', expectedCount: 5,
      expectedNames: buildingNames, expectedMetadata: { submarket: 'CBD', grade: 'A' } });
    await page.getByRole('button', { name: '打开对话：楼宇校准', exact: true }).click();
    measured = await readAfterPaint();
    assert.ok(Number.isFinite(measured.start), 'The actual history entry click starts building-snapshot measurement');
    const snapshotStart = measured.start;
    assert.equal(measured.feedback_ms, null, 'The same history loading text outside its panel is not building-snapshot feedback');
    assert.equal(measured.content_usable_ms, null, 'Five correct cards in the old result cannot complete snapshot open');

    await page.evaluate(() => {
      document.querySelector('aside[aria-label="历史工作记录"] [role="status"]').textContent = '正在读取历史记录…';
    });
    measured = await readAfterPaint();
    assert.ok(Number.isFinite(measured.feedback_ms), 'The visible history panel busy state after the click is genuine feedback');
    assert.equal(measured.content_usable_ms, null, 'History loading feedback cannot substitute for a new usable result');

    await page.evaluate(markup => {
      document.querySelector('aside[aria-label="历史工作记录"] [role="status"]').textContent = '';
      const next = document.createElement('section'); next.setAttribute('aria-label', '查询结果');
      next.innerHTML = `<section aria-label="查询楼宇信息">${markup}</section>`;
      document.querySelector('section[aria-label="查询结果"]').replaceWith(next);
    }, buildingMarkup({ metadata: '子市场未知 · 等级未知 （当前目录）' }));
    measured = await readAfterPaint();
    assert.equal(measured.content_usable_ms, null, 'New names without confirmed current-directory metadata cannot complete snapshot open');
    measured = await setBuildingMarkup(`${buildingMarkup()}<p role="status">正在核对楼宇访问权限…</p>`);
    assert.equal(measured.content_usable_ms, null, 'Complete cards with authorization still loading are not usable');
    measured = await setBuildingMarkup(buildingMarkup({ count: 4 }));
    assert.equal(measured.content_usable_ms, null, 'An incomplete building-card page is not usable');
    measured = await setBuildingMarkup(buildingMarkup({ omitLastMap: true }));
    assert.equal(measured.content_usable_ms, null, 'Every building card must retain its actual map link');
    await setBuildingMarkup(buildingMarkup());
    await page.waitForFunction(() => window.__colliersP2Workspace.state.status === 'ready');
    measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    assert.equal(measured.start, snapshotStart, 'DOM stages never restart the actual click measurement');
    assert.ok(measured.feedback_ms < measured.content_usable_ms);
    assert.equal(measured.mounted.buildingCards, 5);
    await page.evaluate(() => window.__colliersP2Workspace.stop());

    await page.setContent('<button>生成分析摘要</button>');
    await page.evaluate(observeP2WorkspaceAction, { mode: 'summary', triggerText: '生成分析摘要', timeoutMs: 60 });
    await page.getByRole('button', { name: '生成分析摘要', exact: true }).click();
    await page.waitForFunction(() => window.__colliersP2Workspace.state.status === 'timeout');
    measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    assert.equal(measured.content_usable_ms, null); assert.equal(measured.feedback_ms, null);
    await page.evaluate(() => window.__colliersP2Workspace.stop());
    await page.close();
    console.log('PASS P2 paint collector calibration: icon-only click and scoped history feedback observed, disabled/stale/unauthorized/incomplete content excluded, bounded cards confirmed, genuine Long Tasks collected, absent readiness retained as timeout; calibration timings are not product evidence');
  } finally { await browser.close(); }
}
