import assert from 'node:assert/strict';

// Observe public camera commands without replacing SDK behavior. Data and
// identity remain supplied by the caller's isolated workspace fixture.
export async function verifyRegionCamera(page, { width, base }) {
  if (base) await page.goto(new URL('/map', base).href);
  await page.waitForFunction(() => window.__workspaceMap?.getCenter() && document.querySelector('.map-live-stats')?.getAttribute('aria-busy') === 'false');
  // Let startup settle; this is a test observation boundary, not application
  // timing or a camera correction chain.
  await page.waitForTimeout(600);
  const result = await page.evaluate(async () => {
    const map = window.__workspaceMap, original = map.setZoomAndCenter;
    const commands = [];
    const start = performance.now();
    map.setZoomAndCenter = function (...args) {
      const box = map.getContainer().getBoundingClientRect();
      commands.push({ at: performance.now() - start, zoom: args[0], center: [...args[1]], immediately: args[2], duration: args[3], width: box.width, height: box.height });
      return original.apply(this, args);
    };
    try {
      window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } }));
      await new Promise(done => {
        function frame(now) { if (now - start < 800) requestAnimationFrame(frame); else done(); }
        requestAnimationFrame(frame);
      });
      const center = map.getCenter();
      return { commands, center: [center.lng ?? center[0], center.lat ?? center[1]], zoom: map.getZoom() };
    } finally { map.setZoomAndCenter = original; }
  });
  await page.getByRole('region', { name: 'CBD', exact: true }).waitFor();
  assert.ok(result.commands.length, 'the region actually issued a camera command');
  const keys = result.commands.map(command => JSON.stringify([
    ...command.center.map(value => Number(value.toFixed(6))), Number(command.zoom.toFixed(6)),
    Math.round(command.width), Math.round(command.height),
  ]));
  assert.equal(new Set(keys).size, keys.length, `restarted identical region camera at ${width}: ${JSON.stringify(result.commands)}`);
  return { width, observationMs: 800, regionCameraHasNoDuplicateTarget: true, ...result };
}
