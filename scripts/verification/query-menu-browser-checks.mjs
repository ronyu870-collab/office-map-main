import assert from 'node:assert/strict';
export const menuRecords = [];

// Real component geometry and hit testing. A top-layer popover escapes physical
// ancestor clipping, but still belongs to the workspace's DOM and inert scope.
export async function menuGeometry(panel) {
  return panel.evaluate(node => {
    const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const style = getComputedStyle(node), workspace = node.closest('#colliers-ai');
    const trigger = document.getElementById(node.getAttribute('aria-labelledby')) ?? node.parentElement.querySelector('summary, button');
    const viewport = window.visualViewport;
    let bounds = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth), bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) };
    const clipping = [];
    let topLayer = false;
    try { topLayer = node.matches(':popover-open'); } catch {}
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), box = rect(parent);
      if (/(auto|scroll|hidden|clip)/.test(`${css.overflowX} ${css.overflowY}`)) {
        clipping.push({ tag: parent.tagName, className: parent.className, box, x: css.overflowX, y: css.overflowY });
        if (!topLayer) {
          if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { bounds.left = Math.max(bounds.left, box.left); bounds.right = Math.min(bounds.right, box.right); }
          if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { bounds.top = Math.max(bounds.top, box.top); bounds.bottom = Math.min(bounds.bottom, box.bottom); }
        }
      }
      if (parent === workspace) break;
    }
    if (workspace) { const box = rect(workspace); bounds = { left: Math.max(bounds.left, box.left), right: Math.min(bounds.right, box.right), top: Math.max(bounds.top, box.top), bottom: Math.min(bounds.bottom, box.bottom) }; }
    const box = rect(node);
    const items = [...node.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [role="menuitem"]')];
    const item = element => {
      const r = rect(element), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      return { rect: r, visible: r.width > 0 && r.height > 0 && x >= bounds.left && x <= bounds.right && y >= Math.max(bounds.top, box.top) && y <= Math.min(bounds.bottom, box.bottom), hit: element === hit || element.contains(hit), actualHit: hit?.outerHTML.slice(0, 350) };
    };
    return { viewport: { width: innerWidth, height: innerHeight, scale: viewport?.scale }, mode: workspace?.dataset.mode, trigger: trigger && rect(trigger), menu: box, bounds, top: style.top, bottom: style.bottom, height: style.height, maxHeight: style.maxHeight, overflowX: style.overflowX, overflowY: style.overflowY, clipping, topLayer, activeOverlays: [...document.querySelectorAll('[data-query-menu-panel]:not([hidden]), details[open]')].map(n => n.id || n.className), items: items.map(item), horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
}

async function visibleMenu(page, trigger) {
  const id = await trigger.getAttribute('aria-controls');
  return id ? page.locator(`[id="${id}"]`) : trigger.locator('..').locator(':scope > div').first();
}
export async function assertMenu(page, trigger, label) {
  const panel = await visibleMenu(page, trigger);
  await panel.waitFor({ state: 'visible' });
  const facts = await menuGeometry(panel);
  menuRecords.push({ label, ...facts });
  const diagnostic = `${label}\n${JSON.stringify(facts, null, 2)}`;
  assert.ok(facts.menu.height >= 40 && facts.menu.width >= 100, diagnostic);
  assert.ok(facts.menu.top >= facts.bounds.top - 1 && facts.menu.bottom <= facts.bounds.bottom + 1 && facts.menu.left >= facts.bounds.left - 1 && facts.menu.right <= facts.bounds.right + 1, diagnostic);
  assert.ok(facts.items.length && facts.items[0].visible && facts.items[0].hit, diagnostic);
  await panel.evaluate(node => { node.scrollTop = node.scrollHeight; });
  const last = await menuGeometry(panel);
  assert.ok(last.items.at(-1)?.visible && last.items.at(-1)?.hit, `${label} last option\n${JSON.stringify(last, null, 2)}`);
  assert.equal(facts.horizontalOverflow, false, diagnostic);
  await panel.evaluate(node => { node.scrollTop = 0; });
  return panel;
}

export async function checkQueryMenus(session, { send }) {
  const { page } = session;
  session.interactionChecks ??= {};
  await page.locator('#home-query').click();
  await page.waitForFunction(() => document.querySelector('#colliers-ai')?.dataset.transitioning === 'false');
  await send(session, '2026Q3 CBD 净有效租金', 'aggregate');
  const answer = page.getByRole('article', { name: '本次问答', exact: true });
  const more = answer.getByText('更多操作', { exact: true });
  await more.click();
  await assertMenu(page, more, 'answer more actions');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#colliers-ai').getAttribute('data-mode'), 'focus', 'Escape only dismisses menu');
  assert.ok(await more.evaluate(node => node === document.activeElement));
  await more.click();
  const resultDownload = answer.getByText('下载本次结果', { exact: true });
  await resultDownload.click();
  await assertMenu(page, resultDownload, 'answer download');
  assert.equal(await more.getAttribute('aria-expanded'), 'false', 'only one menu');
  await page.keyboard.press('Escape');
  // A command closes; a revealed summary receives focus and returns to trigger.
  await more.click();
  await page.getByRole('button', { name: '生成分析摘要', exact: true }).click();
  await page.getByRole('region', { name: '市场分析摘要' }).waitFor();
  await page.getByRole('button', { name: '收起摘要', exact: true }).click();
  assert.ok(await more.evaluate(node => node === document.activeElement));
  // These paths run with the real workspace and mock HTTP. No model/DB calls.
  console.log(`menus: ${session.width}px answer geometry, hit testing and dismissal pass`);
}

async function closed(trigger) { assert.equal(await trigger.getAttribute('aria-expanded'), 'false'); }
async function exerciseMenu(page, trigger, label) {
  for (const block of ['start', 'center', 'end']) {
    console.log(`menus: ${label} ${block}`);
    await trigger.evaluate((node, block) => node.scrollIntoView({ block, inline: 'nearest' }), block);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    await trigger.click();
    await assertMenu(page, trigger, `${label} at ${block}`);
    await page.keyboard.press('Escape');
    await closed(trigger);
    assert.ok(await trigger.evaluate(node => node === document.activeElement), `${label} restores focus`);
  }
  await trigger.click();
  await trigger.click();
  await closed(trigger);
  await trigger.click();
  const surface = await page.locator('#colliers-ai').boundingBox();
  await page.mouse.click(surface.x + 2, surface.y + 2);
  await closed(trigger);
  // Only movement of this anchor's ancestors dismisses; the popup itself scrolls.
  await trigger.click();
  const moved = await trigger.evaluate(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight + 2) {
        const before = parent.scrollTop, anchorBefore = node.getBoundingClientRect();
        parent.scrollTop += before > 1 ? -1 : 1;
        const anchorAfter = node.getBoundingClientRect();
        if (Math.abs(anchorAfter.x - anchorBefore.x) > .5 || Math.abs(anchorAfter.y - anchorBefore.y) > .5) return true;
        // A fixed workspace can have a scrollable, inert background ancestor.
        // Moving that offset does not move this menu's anchor.
        parent.scrollTop = before;
      }
    }
    return false;
  });
  if (moved) await page.waitForFunction(node => node.getAttribute('aria-expanded') === 'false', await trigger.elementHandle());
  else await page.keyboard.press('Escape');
  await trigger.click();
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: size.height - 60 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  // A resize may safely dismiss if the owning workspace starts a transition.
  if (await trigger.getAttribute('aria-expanded') === 'true') {
    await assertMenu(page, trigger, `${label} after resize`);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize(size);
}

export async function checkAllQueryMenus(session, helpers) {
  await checkQueryMenus(session, helpers);
  const { page, calls, control } = session;
  const { send, expanded } = helpers;
  const answer = page.getByRole('article', { name: '本次问答', exact: true });
  const more = answer.getByRole('button', { name: '更多操作', exact: true });
  await exerciseMenu(page, more, 'more actions');
  const posts = () => calls.filter(call => call.path === '/api/intelligence/query' && call.method === 'POST').length;
  const chartCalls = () => calls.filter(call => call.action === 'chart').length;
  const download = answer.getByRole('button', { name: '下载本次结果', exact: true });
  await exerciseMenu(page, download, 'result download');
  console.log('menus: result downloads');
  control.exportFailures = 1;
  await download.click();
  await page.getByRole('button', { name: 'Excel', exact: true }).click();
  await answer.getByRole('status').filter({ hasText: /合成下载失败|下载未完成|暂不可用/ }).waitFor();
  console.log('menus: retry download');
  await download.click();
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel', exact: true }).click();
  assert.equal((await file).suggestedFilename(), 'fixture.xlsx');
  await answer.getByText(/已发起下载/).first().waitFor();
  console.log('menus: copy fallback');
  // Actual clipboard rejection preserves a manual copy path for each format.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('synthetic denial'); } } }));
  await more.click();
  await page.getByRole('button', { name: '复制关键数字', exact: true }).click();
  await answer.getByRole('textbox', { name: '可手动复制的分析内容', exact: true }).waitFor();
  await answer.getByRole('button', { name: '选择全部文字', exact: true }).click();
  assert.ok(await answer.getByRole('textbox').evaluate(node => node.selectionEnd === node.value.length));
  await answer.getByRole('button', { name: '关闭复制内容', exact: true }).click();
  assert.ok(await more.evaluate(node => node === document.activeElement));
  console.log('menus: table');
  await send(session, '列出获权楼宇并显示高度和净有效租金', 'table');
  await expanded(page, true);
  const table = answer.getByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' });
  await table.waitFor();
  const postsBefore = posts(), chartsBefore = chartCalls();
  for (const label of ['筛选', '显示字段', '导出表格']) {
    const trigger = answer.getByRole('button', { name: label, exact: true });
    await exerciseMenu(page, trigger, `table ${label}`);
  }
  console.log('menus: table continuous fields');
  const fields = answer.getByRole('button', { name: '显示字段', exact: true });
  await fields.click();
  const fieldPanel = await assertMenu(page, fields, 'continuous checkbox editing');
  const field = fieldPanel.getByRole('checkbox', { name: '建筑高度', exact: true });
  await field.uncheck(); await field.check();
  assert.equal(await fields.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  console.log('menus: table continuous filters');
  const filter = answer.getByRole('button', { name: '筛选', exact: true });
  await filter.click();
  const filterPanel = await assertMenu(page, filter, 'continuous select editing');
  const select = filterPanel.getByRole('combobox').first();
  await select.focus(); await select.dispatchEvent('compositionstart');
  await select.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  assert.equal(await filter.getAttribute('aria-expanded'), 'true');
  await select.dispatchEvent('compositionend');
  await select.selectOption({ index: 1 });
  await select.selectOption({ index: 0 });
  await page.keyboard.press('Escape');
  console.log('menus: table selected export');
  await table.getByRole('checkbox', { name: '选择合成楼01', exact: true }).check();
  const search = answer.getByRole('searchbox', { name: '搜索本次结果', exact: true });
  await search.fill('合成楼0'); await search.pressSequentially('1');
  assert.equal(await search.inputValue(), '合成楼01');
  assert.ok(await search.evaluate(node => node === document.activeElement));
  const tableExport = answer.getByRole('button', { name: '导出表格', exact: true });
  await tableExport.click();
  const exportPanel = await assertMenu(page, tableExport, 'selected table export');
  assert.equal(await exportPanel.getByRole('combobox', { name: '导出范围', exact: true }).inputValue(), 'selected');
  const selectedFile = page.waitForEvent('download');
  await exportPanel.getByRole('button', { name: 'CSV 与来源', exact: true }).click();
  assert.equal((await selectedFile).suggestedFilename(), 'fixture.zip');
  assert.deepEqual(calls.filter(call => call.action === 'export').at(-1).selection, { kind: 'selected', rowIndexes: [0] });
  console.log('menus: table detail');
  await answer.getByRole('button', { name: '展开表格', exact: true }).click();
  const detail = page.getByRole('region', { name: '数据工作区', exact: true }).or(page.getByRole('dialog', { name: '数据工作区', exact: true }));
  await detail.waitFor();
  const expandedFields = detail.getByRole('button', { name: '显示字段', exact: true });
  await expandedFields.click(); await assertMenu(page, expandedFields, 'detail table fields');
  await page.keyboard.press('Escape');
  assert.ok(await detail.isVisible(), 'Escape retains the detail panel');
  assert.equal(await detail.getByRole('searchbox').inputValue(), '合成楼01');
  assert.ok(await detail.getByRole('checkbox', { name: '选择合成楼01', exact: true }).isChecked());
  await detail.getByRole('button', { name: '返回对话', exact: true }).click();
  assert.equal(await search.inputValue(), '合成楼01');
  assert.equal(posts(), postsBefore); assert.equal(chartCalls(), chartsBefore);
  await answer.getByText('图表设置', { exact: true }).click();
  await answer.getByRole('button', { name: '查看柱状图', exact: true }).click();
  await answer.getByRole('figure', { name: '同源查询图表', exact: true }).waitFor();
  const generatedDownload = answer.getByRole('button', { name: '下载图表', exact: true });
  const generatedCount = chartCalls();
  await exerciseMenu(page, generatedDownload, 'generated chart download');
  for (const label of ['SVG 图与来源', 'PNG 图与来源']) {
    await generatedDownload.click(); const panel = await assertMenu(page, generatedDownload, label);
    const exported = page.waitForEvent('download'); await panel.getByRole('button', { name: label, exact: true }).click();
    assert.equal((await exported).suggestedFilename(), 'fixture.zip');
    await answer.getByText(/已发起下载/).first().waitFor();
  }
  assert.equal(chartCalls(), generatedCount);
  assert.equal(posts(), postsBefore);
  console.log('menus: professional chart');
  await send(session, '生成可调整的租金比较图', 'professional');
  const chart = answer.getByRole('region', { name: '专业图表工作区', exact: true });
  await chart.getByRole('button', { name: '下载图表', exact: true }).waitFor();
  await chart.locator('svg').waitFor();
  const chartDownload = chart.getByRole('button', { name: '下载图表', exact: true });
  const beforeChartMenus = chartCalls();
  await exerciseMenu(page, chartDownload, 'professional chart download');
  for (const label of ['下载 PNG 与来源', '下载 SVG 与来源']) {
    await chartDownload.click(); const panel = await assertMenu(page, chartDownload, label);
    const exported = page.waitForEvent('download');
    await panel.getByRole('button', { name: label, exact: true }).click();
    assert.equal((await exported).suggestedFilename(), 'fixture.zip');
    await chart.getByText(/已发起图片/).waitFor();
  }
  assert.equal(chartCalls(), beforeChartMenus, 'menus and exports do not regenerate charts');
  await answer.getByRole('button', { name: '展开图表', exact: true }).click();
  const chartDetail = page.locator('aside').filter({ has: page.getByRole('region', { name: '专业图表工作区', exact: true }) });
  const chartDetailDownload = chartDetail.getByRole('button', { name: '下载图表', exact: true });
  await chartDetailDownload.click(); await assertMenu(page, chartDetailDownload, 'expanded professional chart');
  await page.keyboard.press('Escape'); assert.ok(await chartDetail.isVisible());
  await chartDetail.getByRole('button', { name: '返回对话', exact: true }).click();
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  const history = page.getByRole('complementary', { name: '历史工作记录', exact: true });
  const historyActions = history.locator('[data-history-actions]');
  await historyActions.last().waitFor();
  for (const index of [0, 14, 7]) await exerciseMenu(page, historyActions.nth(index), `history row ${index}`);
  const first = historyActions.first();
  await first.click();
  await page.keyboard.press('End'); assert.equal(await page.getByRole('menuitem', { name: '归档', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Home');
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const title = history.getByRole('textbox', { name: '对话标题', exact: true });
  assert.ok(await title.evaluate(node => node === document.activeElement));
  await title.fill('合成重命名'); await history.getByRole('button', { name: '保存标题', exact: true }).click();
  const renamed = history.getByRole('button', { name: '对话操作：合成重命名', exact: true });
  await renamed.click(); await page.getByRole('menuitem', { name: '归档', exact: true }).click();
  await history.getByRole('tab', { name: '已归档', exact: true }).click();
  await renamed.click(); await assertMenu(page, renamed, 'restore archived conversation');
  await page.getByRole('menuitem', { name: '移回工作记录', exact: true }).click();
  await history.getByRole('tab', { name: '最近对话', exact: true }).click();
  await renamed.waitFor();
  await renamed.click();
  await history.getByRole('searchbox').click(); await closed(renamed);
  await historyActions.last().click();
  await history.locator('[data-history-scroll]').evaluate(node => { node.scrollTop -= 100; });
  await page.waitForFunction(() => !document.querySelector('[data-query-menu-panel]:not([hidden])'));
  await history.getByRole('button', { name: '关闭历史', exact: true }).click();
  // A viewport event can finish workspace motion while a sidebar is still
  // exiting. A hidden sidebar must stop occupying compact layout immediately.
  await page.getByRole('button', { name: '收起 Colliers AI 工作空间', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForFunction(() => document.querySelector('#colliers-ai')?.dataset.mode === 'compact'
    && document.querySelector('#colliers-ai')?.dataset.transitioning === 'false');
  const hiddenPanels = await page.locator('#query-workspace-history[hidden], #query-workspace-research[hidden]').evaluateAll(nodes => nodes
    .map(node => ({ id: node.id, display: getComputedStyle(node).display, height: node.getBoundingClientRect().height })));
  assert.equal(hiddenPanels.length, 2);
  assert.ok(hiddenPanels.every(panel => panel.height === 0), `compact hidden sidebar layout: ${JSON.stringify(hiddenPanels)}`);
  await expanded(page, false);
  await more.click(); await assertMenu(page, more, 'compact menu');
  // Nested scroll restoration can change offsets while leaving the visible
  // anchor in exactly the same place. It must not dismiss a usable menu.
  const compensated = await more.evaluate(node => {
    const parents = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight + 4) parents.push(parent);
    }
    const [inner, outer] = parents;
    if (!inner || !outer) return { available: false };
    const delta = [2, -2].find(value => inner.scrollTop + value >= 0
      && inner.scrollTop + value <= inner.scrollHeight - inner.clientHeight
      && outer.scrollTop - value >= 0 && outer.scrollTop - value <= outer.scrollHeight - outer.clientHeight);
    if (delta === undefined) return { available: false };
    const before = node.getBoundingClientRect();
    inner.scrollTop += delta; outer.scrollTop -= delta;
    const after = node.getBoundingClientRect();
    return { available: true, deltaX: after.x - before.x, deltaY: after.y - before.y };
  });
  assert.ok(compensated.available && Math.abs(compensated.deltaX) < .5 && Math.abs(compensated.deltaY) < .5,
    `compact scroll compensation: ${JSON.stringify(compensated)}`);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await assertMenu(page, more, 'compact menu after scroll compensation');
  await expanded(page, true);
  await closed(more);
  assert.equal(session.errors.length, 0, session.errors.join('\n'));
  console.log(`menus: ${session.width}px tables, exports, chart, detail, history and lifecycle pass`);
}

export async function checkResponsiveQueryMenus(session, helpers, zoom) {
  const { page } = session;
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  assert.ok(Math.abs(actual.width - 1280 / zoom) <= 1 && Math.abs(actual.dpr - zoom) < .01, `native browser zoom: ${JSON.stringify(actual)}`);
  await checkQueryMenus(session, helpers);
  await helpers.expanded(page, true);
  const more = page.getByRole('article', { name: '本次问答', exact: true }).getByRole('button', { name: '更多操作', exact: true });
  await exerciseMenu(page, more, `native zoom ${zoom}`);
  await page.setViewportSize({ width: 1280, height: 600 });
  await more.click(); await assertMenu(page, more, `native zoom ${zoom} low viewport`);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#colliers-ai').getAttribute('data-mode'), 'expanded');
  assert.equal(session.errors.length, 0, session.errors.join('\n'));
  console.log(`menus: native ${zoom * 100}% zoom and low viewport pass`);
}
