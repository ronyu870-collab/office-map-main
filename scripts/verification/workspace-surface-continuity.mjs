import assert from 'node:assert/strict';
import { clickWorkspaceAction } from './workspace-actions.mjs';

export function assertStableMapCanvas(traces) {
  const origin = traces[0];
  for (const frame of traces) {
    assert.ok(Math.abs(frame.canvasWidth-origin.canvasWidth)<=1 && Math.abs(frame.canvasHeight-origin.canvasHeight)<=1,
      `map canvas changed from ${origin.canvasWidth}x${origin.canvasHeight} to ${frame.canvasWidth}x${frame.canvasHeight} during ${frame.action}`);
  }
}

// Actual production layout, DOM events and Web Animations. The host supplies
// isolated authorized data and SDK transport; this does not measure live tiles.
export async function verifySurfaceContinuity(page, { width, base, frameStallMs = 0, readingPaths = false }) {
  if (base) {
    await page.goto(new URL('/map', base).href);
    await page.locator('#map-container [data-building-id="10000000-1111-4111-8111-111111111111"]').first().waitFor();
  }
  await page.getByRole('button', { name: '项目列表', exact: true }).click();
  await page.getByRole('region', { name: '项目列表', exact: true }).getByRole('button', { name: /^CBD甲楼/ }).waitFor();
  await page.waitForFunction(() => document.querySelector('.map-workspace-layout').dataset.mapLayoutReady === 'true' && !document.querySelector('.map-workspace-right').getAnimations().some(a => a.playState === 'running' || a.pending));
  const traces = await page.evaluate(async frameStallMs => {
    const samples = [];
    const pane = document.querySelector('.map-workspace-right');
    function sample(action, time) {
      const box = pane.getBoundingClientRect(), canvas = document.querySelector('#map-container').getBoundingClientRect();
      const style = getComputedStyle(pane);
      const map=window.__workspaceMap, point=map?.lngLatToContainer?.([116.46,39.91]);
      const anchor=point?[point.getX?.()??point.x,point.getY?.()??point.y]:null;
      samples.push({ action, time, anchor, x: box.x, y: box.y, width: box.width, height: box.height,
        opacity: Number(style.opacity), open: pane.hasAttribute('data-open'), exiting: pane.hasAttribute('data-exiting'),
        canvasWidth: canvas.width, canvasHeight: canvas.height, clip: style.clipPath });
    }
    const open = () => document.querySelector('[aria-label="项目列表"]').click();
    const close = () => document.querySelector('[aria-label="关闭列表"]').click();
    async function record(action, change) {
      sample(action, -1);
      change();
      const start = performance.now();
      await new Promise(done => {
        function frame(now) {
          sample(action, Math.max(0, now - start));
          if (now - start < 420) requestAnimationFrame(frame); else done();
        }
        requestAnimationFrame(frame);
      });
    }
    let busyFrame = 0, busy = true;
    const blockFrame = () => {
      if (!busy) return;
      const start = performance.now();
      while (performance.now() - start < frameStallMs) { /* explicit bounded test load */ }
      busyFrame = requestAnimationFrame(blockFrame);
    };
    if (frameStallMs > 0) busyFrame = requestAnimationFrame(blockFrame);
    try {
      await record('close', close);
      await record('reverse', () => { open(); setTimeout(close, 50); setTimeout(open, 100); });
      return samples;
    } finally { busy = false; cancelAnimationFrame(busyFrame); }
  }, frameStallMs);
  const origin = traces[0];
  assertStableMapCanvas(traces);
  if(origin.anchor)for(const frame of traces)assert.ok(frame.anchor?.every((value,index)=>Math.abs(value-origin.anchor[index])<=1),`map world anchor moved while closing list at ${width}: ${JSON.stringify(frame)}`);
  // A pane may travel its intended 20px while fading. A whole-track relocation
  // is a layout fault, independently of the exact frame timing of the machine.
  const visible = traces.filter(frame => frame.time >= 0 && frame.opacity > .05 && (frame.open || frame.exiting));
  assert.ok(visible.length > 2, 'observed visible frames during close and reversal');
  for (const frame of visible) {
    assert.ok(Math.abs(frame.x - origin.x) <= 24 && Math.abs(frame.y - origin.y) <= 24,
      `surface jumped from (${origin.x},${origin.y}) to (${frame.x},${frame.y}) in ${frame.action} at ${width}`);
  }
  const end = traces.at(-1);
  assert.equal(end.open, true, 'last open intent remains active');
  assert.equal(end.exiting, false, 'no stale exit layer');
  assert.ok(end.opacity > .99, 'final surface is opaque');
  assert.ok(Math.abs(end.x - origin.x) <= 1 && Math.abs(end.y - origin.y) <= 1, 'final surface returns to its reading position');
  assert.equal(await page.locator('.map-workspace-right').getAttribute('aria-hidden'), 'false');
  const times=traces.filter(frame=>frame.action==='reverse' && frame.time>=0).map(frame=>frame.time);
  const frameGaps=times.slice(1).map((time,index)=>time-times[index]);
  if(frameStallMs>0)assert.ok(frameGaps.some(gap=>gap>=frameStallMs*.75),'artificial low-frame test must actually observe delayed frames');
  const paths = readingPaths ? await verifyReadingSurfacePaths(page) : [];
  const fullscreenReading = readingPaths && width < 640 ? await verifyFullscreenReading(page) : null;
  return { width, surfaceCloseAndReverse: true, frameStallMs, frameGaps, traces, paths, fullscreenReading };
}

// Public UI handlers plus actual Web Animations and frame geometry. Capture
// reversals on the same surface in research, project and fullscreen modes.
async function verifyReadingSurfacePaths(page) {
  const project = '10000000-1111-4111-8111-111111111111';
  const paths = [];
  for (const kind of ['research', 'project', 'fullscreen']) {
    await page.evaluate(({ kind, project }) => {
      if (kind === 'research') window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } }));
      else document.querySelector(`#map-container [data-building-id="${project}"]`).click();
    }, { kind, project });
    const content = kind === 'research' ? page.getByRole('region', { name: 'CBD', exact: true }) : page.getByRole('region', { name: 'CBD甲楼楼宇详情', exact: true });
    await content.waitFor();
    await page.waitForFunction(() => document.querySelector('.map-workspace-layout').dataset.mapLayoutReady === 'true' && !document.querySelector('.map-workspace-right').getAnimations().some(a => a.playState === 'running' || a.pending));
    const frames = await page.evaluate(async ({ kind, project }) => {
      const pane = document.querySelector('.map-workspace-right');
      const frames = [];
      const button = async name => {
        let found = [...pane.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === name || node.textContent.trim() === name);
        if (!found) {
          const summary = pane.querySelector('.workspace-mobile-tools > summary');
          if (summary && summary.getAttribute('aria-expanded') !== 'true') summary.click();
          await new Promise(requestAnimationFrame);
          const portal = summary && document.getElementById(summary.getAttribute('aria-controls'));
          found = [...(portal?.querySelectorAll('button') ?? [])].find(node => node.textContent.trim() === name);
        }
        if (!found) throw new Error(`Missing surface action ${name}`);
        found.click();
      };
      const close = () => button(kind === 'research' ? '关闭子市场介绍' : '关闭楼宇详情');
      const reopen = () => kind === 'research'
        ? window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } }))
        : document.querySelector(`#map-container [data-building-id="${project}"]`).click();
      const change = phase => kind === 'fullscreen'
        ? button(phase === 1 ? '返回地图分屏' : '全屏阅读工作区')
        : phase === 1 ? close() : reopen();
      const sample = phase => {
        const box = pane.getBoundingClientRect(), canvas = document.querySelector('#map-container').getBoundingClientRect(), style = getComputedStyle(pane);
        frames.push({ phase, time: performance.now(), x: box.x, y: box.y, width: box.width, height: box.height, opacity: Number(style.opacity), clip: style.clipPath,
          canvasWidth: canvas.width, canvasHeight: canvas.height, open: pane.hasAttribute('data-open'), exiting: pane.hasAttribute('data-exiting'), expanded: !!pane.closest('[data-expanded]'),
          project: pane.querySelector('.building-popup')?.dataset.buildingId ?? null, region: pane.querySelector('[role="region"]')?.getAttribute('aria-label'), animations: pane.getAnimations().filter(a => a.playState === 'running' || a.pending).length });
      };
      sample('initial');
      await change(kind === 'fullscreen' ? 0 : 1);
      let phase = 0;
      const start = performance.now();
      await new Promise(resolve => {
        async function frame(now) {
          const elapsed = now - start;
          if (phase === 0 && elapsed >= 50) { sample('before-first-reversal'); await change(kind === 'fullscreen' ? 1 : 0); phase = 1; }
          if (phase === 1 && elapsed >= 100) { sample('before-second-reversal'); await change(kind === 'fullscreen' ? 0 : 1); phase = 2; }
          if (phase === 2 && elapsed >= 150 && kind !== 'fullscreen') { sample('before-final-open'); reopen(); phase = 3; }
          sample('frame');
          if (elapsed < 600) requestAnimationFrame(frame); else resolve();
        }
        requestAnimationFrame(frame);
      });
      return frames;
    }, { kind, project });
    assertStableMapCanvas(frames);
    for (const frame of frames.filter(frame => frame.opacity > .05 && (frame.open || frame.exiting))) {
      const insets = frame.clip.match(/^inset\(([^)]+)\)/)?.[1].split(/\s+/).map(parseFloat) ?? [0];
      const [top, right = top, bottom = top, left = right] = insets;
      assert.ok(top + bottom < frame.height - 1 && left + right < frame.width - 1, `${kind} visible surface was clipped away: ${JSON.stringify(frame)}`);
    }
    const end = frames.at(-1);
    assert.equal(end.open, true, `${kind} final surface is open`);
    assert.equal(end.exiting, false, `${kind} has no stale exit layer`);
    assert.ok(end.opacity > .99 && end.animations === 0, `${kind} final surface is opaque and settled`);
    const inset = end.clip.match(/^inset\(([^)]+)\)/)?.[1].split(/\s+/).map(parseFloat) ?? [0];
    assert.ok(inset.every(value => Math.abs(value) < 1), `${kind} final surface has no residual clipping`);
    assert.equal(await page.locator('.map-workspace-right').getAttribute('aria-hidden'), 'false');
    if (kind !== 'fullscreen') for (const frame of frames.filter(frame => frame.open || frame.exiting)) {
      assert.ok(Math.abs(frame.x - frames[0].x) <= 24 && Math.abs(frame.y - frames[0].y) <= 24, `${kind} surface relocated during reversal: ${JSON.stringify(frame)}`);
    }
    if (kind !== 'research') assert.equal(end.project, project, 'reversal preserves current project identity');
    if (kind === 'fullscreen') {
      assert.equal(end.expanded, true, 'final fullscreen intent wins');
      // Return through the visible header action before the next scenario.
      await clickWorkspaceAction(page, '返回地图分屏');
      await page.waitForFunction(() => !document.querySelector('.map-workspace-layout').hasAttribute('data-expanded') && !document.querySelector('.map-workspace-right').getAnimations().some(a => a.playState === 'running' || a.pending));
    }
    paths.push({ kind, reversals: kind === 'fullscreen' ? 2 : 3, frames });
  }
  return paths;
}

async function verifyFullscreenReading(page) {
  const detail = page.getByRole('region', { name: 'CBD甲楼楼宇详情', exact: true });
  await detail.getByRole('tab', { name: '成交与资料', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.map-workspace-right').getAnimations().some(a => a.playState === 'running' || a.pending));
  const scroll = detail.locator('.workspace-scroll');
  const box = await scroll.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 900);
  await page.waitForFunction(() => document.querySelector('.workspace-building-scroll').scrollTop > 30);
  const geometry = () => {
    const el = document.querySelector('.workspace-building-scroll');
    return { top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight };
  };
  const before = await page.evaluate(geometry);
  await page.evaluate(() => {
    const el = document.querySelector('.workspace-building-scroll');
    window.__fullscreenReadingBoundaries = [];
    window.__fullscreenReadingObserver = new ResizeObserver(() => {
      window.__fullscreenReadingBoundaries.push({ top:el.scrollTop, height:el.clientHeight, total:el.scrollHeight, expanded:!!document.querySelector('.map-workspace-layout[data-expanded]') });
    });
    window.__fullscreenReadingObserver.observe(el);
  });
  await clickWorkspaceAction(page, '全屏阅读工作区');
  await page.waitForFunction(() => document.querySelector('.map-workspace-layout').hasAttribute('data-expanded') && !document.querySelector('.map-workspace-right').getAnimations().some(a => a.playState === 'running' || a.pending));
  await page.waitForFunction(() => window.__fullscreenReadingBoundaries.some(frame => frame.expanded));
  const full = await page.evaluate(geometry);
  assert.ok(full.top < before.top, 'fullscreen actually reduces the available scroll range');
  await clickWorkspaceAction(page, '返回地图分屏');
  await page.waitForFunction(() => !document.querySelector('.map-workspace-layout').hasAttribute('data-expanded') && !document.querySelector('.map-workspace-right').getAnimations().some(a => a.playState === 'running' || a.pending));
  await page.waitForFunction(() => {
    const rows = window.__fullscreenReadingBoundaries, expanded = rows.findIndex(frame => frame.expanded);
    return expanded >= 0 && rows.slice(expanded + 1).some(frame => !frame.expanded);
  });
  const boundaries = await page.evaluate(() => { window.__fullscreenReadingObserver.disconnect(); return window.__fullscreenReadingBoundaries; });
  const firstReturn = boundaries.slice(boundaries.findIndex(frame => frame.expanded) + 1).find(frame => !frame.expanded);
  assert.ok(Math.abs(firstReturn.top - before.top) < 2, 'the first resize delivery after the application observer already retains the reading position');
  const after = await page.evaluate(geometry);
  assert.ok(Math.abs(after.top - before.top) < 2, `fullscreen lost reading: ${JSON.stringify({ before, full, after })}`);
  // A real user gesture in fullscreen establishes the new reading intent.
  await clickWorkspaceAction(page, '全屏阅读工作区');
  await page.waitForFunction(() => !document.querySelector('.map-workspace-right').getAnimations().some(a => a.playState === 'running' || a.pending));
  const fullBox = await scroll.boundingBox();
  await page.mouse.move(fullBox.x + fullBox.width / 2, fullBox.y + fullBox.height / 2);
  await scroll.evaluate(el => { window.__fullscreenUserWheel = false; el.addEventListener('wheel', () => { window.__fullscreenUserWheel = true; }, { once:true }); });
  await page.mouse.wheel(0, -900);
  await page.waitForFunction(() => window.__fullscreenUserWheel);
  await page.waitForFunction(() => document.querySelector('.workspace-building-scroll').scrollTop === 0);
  await clickWorkspaceAction(page, '返回地图分屏');
  await page.waitForFunction(() => !document.querySelector('.map-workspace-layout').hasAttribute('data-expanded') && !document.querySelector('.map-workspace-right').getAnimations().some(a => a.playState === 'running' || a.pending));
  const userAfter = await page.evaluate(geometry);
  assert.equal(userAfter.top, 0, 'the newer fullscreen user gesture supersedes the earlier compact position');
  return { before, full, after, userAfter, boundaries, actualWheelTakeover: true };
}
