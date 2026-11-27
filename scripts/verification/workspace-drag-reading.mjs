import assert from 'node:assert/strict';

// The full workspace fixture owns the SDK and business transport. Observe the
// actual chart host after application ResizeObservers, before the same paint.
export async function verifyDragReading(page, { base, reducedMotion = false }) {
  const project = '10000000-1111-4111-8111-111111111111';
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.route('**/api/map/submarket?*', route => route.fulfill({ json: {
    submarket: 'CBD', stockCount: 3, profileAvailable: true, profilePublished: true,
    profile: { submarket: 'CBD', headline: '国际商务集聚区', overview: '超长区域介绍与产业结构、企业分布和交通联系。'.repeat(25), industries: '金融服务与国际企业总部'.repeat(20), transport: '轨道交通与步行联系'.repeat(20), demographics: [], policies: [], insights: [], updatedAt: '2026-11-18T00:00:00Z', updatedBy: null },
    trends: { all: [1, 2, 3, 4].map(quarter => ({ period: `2026Q${quarter}`, year: 2026, quarter, rent: 180 + quarter, vacancyPct: 12, rentSamples: 2, vacancySamples: 2, rentArea: 100, vacancyArea: 100 })), a: [], b: [] },
    trendError: false, quarterMethod: 'same quarter', source: 'building_metrics',
  } }));
  await page.goto(new URL(`/map?building=${project}`, base).href);
  const pane = page.locator('.map-workspace-right');
  const projectPanel = page.getByRole('region', { name: 'CBD甲楼楼宇详情', exact: true });
  await projectPanel.getByText('北京国际商务中心资产管理与城市更新投资集团有限公司', { exact: true }).waitFor();
  const paths = [];
  async function measure(name) {
    const separator = page.getByRole('separator', { name: '调整业务工作区宽度', exact: true });
    await separator.press('Home');
    await page.waitForFunction(() => !document.querySelector('.map-workspace-right').getAnimations().some(animation => animation.playState === 'running' || animation.pending));
    const edge = await separator.boundingBox();
    const pointerY = edge.y + Math.min(100, edge.height / 2);
    const min = Number(await separator.getAttribute('aria-valuemin'));
    const max = Number(await separator.getAttribute('aria-valuemax'));
    assert.ok(max > min, 'exercise a nonzero supported drag range');
    await page.evaluate(() => {
      const element = document.querySelector('.map-workspace-right');
      const samples = [];
      let active = true, frame = 0;
      const sample = phase => {
        if (!active) return;
        const rect = element.getBoundingClientRect(), map = document.querySelector('#map-container').getBoundingClientRect();
        samples.push({ phase: typeof phase === 'string' ? phase : 'raf', at: performance.now(), dragging: !!element.closest('[data-dragging]'), x: rect.x, width: rect.width,
          animations: element.getAnimations().filter(animation => animation.playState === 'running' || animation.pending).length,
          overflow: [...element.querySelectorAll('.workspace-scroll,.workspace-building-facts dd,.workspace-title-expanded')].filter(node => node.getBoundingClientRect().width > 0).map(node => ({ kind: node.className, client: node.clientWidth, scroll: node.scrollWidth })),
          charts: [...element.querySelectorAll('canvas')].filter(canvas => canvas.getBoundingClientRect().width > 0).map(canvas => ({ canvas: canvas.getBoundingClientRect().width, host: (canvas.closest('#info-chart-container,[role="img"]') || canvas.parentElement).getBoundingClientRect().width })),
          mapWidth: map.width, mapHeight: map.height });
        if (typeof phase !== 'string') frame = requestAnimationFrame(sample);
      };
      const observer = new ResizeObserver(() => sample('post-application-resize-observer'));
      for (const node of document.querySelectorAll('.map-workspace-right,#info-chart-container,.map-workspace-right [role="img"]')) observer.observe(node);
      frame = requestAnimationFrame(sample);
      window.__dragReadingCapture = { stop() { active = false; cancelAnimationFrame(frame); observer.disconnect(); return samples; } };
    });
    let frames, releasedAt;
    try {
      await page.mouse.move(edge.x + 3, pointerY);
      await page.mouse.down();
      for (const fraction of [.25, .5, .75, 1, .75, .5, .25, 0]) {
        await page.mouse.move(edge.x + 3 - (max - min) * fraction, pointerY);
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await page.mouse.up();
      releasedAt = await page.evaluate(() => performance.now());
      await page.evaluate(() => new Promise(resolve => {
        const start = performance.now();
        const record = now => now - start >= 500 ? resolve() : requestAnimationFrame(record);
        requestAnimationFrame(record);
      }));
    } finally {
      await page.mouse.up();
      frames = await page.evaluate(() => window.__dragReadingCapture.stop());
    }
    const first = frames[0], observed = frames.filter(frame => frame.phase === 'post-application-resize-observer');
    assert.ok(observed.length >= 5, `${name}: observe distinct drag sizes after application resize delivery`);
    assert.ok(frames.some(frame => frame.width >= max - 1) && frames.some(frame => frame.width <= min + 1), `${name}: pointer reaches both supported widths`);
    for (const frame of frames) {
      assert.ok(Math.abs(frame.mapWidth - first.mapWidth) <= 1 && Math.abs(frame.mapHeight - first.mapHeight) <= 1, `${name}: stable SDK canvas`);
      if (frame.dragging) assert.equal(frame.animations, 0, `${name}: no competing pane animation`);
    }
    for (const frame of observed) {
      assert.ok(frame.overflow.every(node => node.scroll <= node.client + 1), `${name}: text/chart overflow after resize ${JSON.stringify(frame)}`);
      assert.ok(frame.charts.every(chart => Math.abs(chart.canvas - chart.host) <= 2), `${name}: chart fits its actual host after resize`);
    }
    const after = frames.filter(frame => frame.at >= releasedAt);
    assert.ok(after.length >= 5, `${name}: observe the post-release reading state`);
    for (const frame of after) {
      assert.ok(Math.abs(frame.width - min) <= 1 && Math.abs(frame.x - after[0].x) <= 1, `${name}: no late pane relocation`);
      assert.ok(frame.charts.every(chart => Math.abs(chart.canvas - chart.host) <= 2), `${name}: no delayed chart-size correction after release`);
    }
    assert.equal(await pane.getAttribute('aria-hidden'), 'false');
    paths.push({ name, min, max, releasedAt, frames });
  }
  await measure('project-long-owner-and-property');
  await projectPanel.getByRole('tab', { name: '行情', exact: true }).click();
  await projectPanel.getByRole('button', { name: '季度趋势', exact: true }).click();
  await projectPanel.locator('#info-chart-container canvas').waitFor();
  await measure('project-trend');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
  const research = page.getByRole('region', { name: 'CBD', exact: true });
  const overview = research.getByRole('tabpanel', { name: '市场概览', exact: true });
  await overview.waitFor();
  assert.equal(await overview.locator('canvas').count(), 0, 'overview does not duplicate the charts');
  await research.getByRole('tab', { name: '区域画像', exact: true }).click();
  const profile = research.getByRole('tabpanel', { name: '区域画像', exact: true });
  await profile.getByText(/超长区域介绍与产业结构、企业分布和交通联系/).waitFor();
  await measure('research-profile-long-text');
  await research.getByRole('tab', { name: '行情趋势', exact: true }).click();
  await research.locator('canvas').first().waitFor();
  await measure('research-trend');
  await page.locator('#map-container [data-building-id="cbd-b"]').first().evaluate(element => element.click());
  await page.getByTitle('展开完整名称', { exact: true }).click();
  await pane.locator('.workspace-title-expanded').waitFor();
  await measure('project-expanded-long-name');
  await page.getByTitle('收起完整名称', { exact: true }).focus();
  await page.keyboard.press('Tab');
  const title = pane.locator('.workspace-title-expanded');
  assert.ok(await title.evaluate(element => document.activeElement === element), 'expanded title has a native keyboard reading stop');
  const titleBefore = await title.evaluate(element => ({ top: element.scrollTop, client: element.clientHeight, total: element.scrollHeight }));
  assert.ok(titleBefore.total > titleBefore.client, 'long title actually needs its reading scroll');
  await page.keyboard.press('End');
  await page.waitForFunction(() => {
    const element = document.querySelector('.workspace-title-expanded');
    return element && element.scrollTop >= element.scrollHeight - element.clientHeight - 1;
  }, undefined, { timeout: 1500 });
  const titleAfter = await title.evaluate(element => ({ top: element.scrollTop, client: element.clientHeight, total: element.scrollHeight }));
  await page.screenshot({ path: `/tmp/map-drag-reading-${reducedMotion ? 'reduced' : 'normal'}-1536.png` });
  return { width: page.viewportSize().width, reducedMotion, dragReading: true, paths, titleKeyboardReading: { before: titleBefore, after: titleAfter } };
}
