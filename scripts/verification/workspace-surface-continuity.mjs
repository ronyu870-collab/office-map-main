import assert from 'node:assert/strict';

export function assertStableMapCanvas(traces) {
  const origin = traces[0];
  for (const frame of traces) {
    assert.ok(Math.abs(frame.canvasWidth-origin.canvasWidth)<=1 && Math.abs(frame.canvasHeight-origin.canvasHeight)<=1,
      `map canvas changed from ${origin.canvasWidth}x${origin.canvasHeight} to ${frame.canvasWidth}x${frame.canvasHeight} during ${frame.action}`);
  }
}

// Actual production layout, DOM events and Web Animations. The host supplies
// isolated authorized data and SDK transport; this does not measure live tiles.
export async function verifySurfaceContinuity(page, { width, base, frameStallMs = 0 }) {
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
  return { width, surfaceCloseAndReverse: true, frameStallMs, frameGaps, traces };
}
