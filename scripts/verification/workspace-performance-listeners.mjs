import assert from 'node:assert/strict';

// Inspect browser-owned listeners without retaining their callback handles.
export async function verifyPerformanceListeners(page, width) {
  const cdp = await page.context().newCDPSession(page);
  const count = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {expression:'document',objectGroup:'vitals-listener-check'});
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {objectId:result.objectId});
    const handles = new Set(listeners.flatMap(listener => [listener.handler?.objectId,listener.originalHandler?.objectId]).filter(Boolean));
    for (const objectId of handles) await cdp.send('Runtime.releaseObject', {objectId});
    await cdp.send('Runtime.releaseObjectGroup', {objectGroup:'vitals-listener-check'});
    return listeners.filter(listener => listener.type==='visibilitychange').length;
  };
  try {
    // Modifier input finalizes LCP without changing the current reading layer.
    await page.keyboard.press('Shift'); await page.waitForTimeout(250);
    const before = await count();
    for (let i=0;i<20;i++) await page.keyboard.press('Shift');
    await page.waitForTimeout(250);
    const after = await count();
    assert.equal(after,before,'repeated input must not accumulate document visibility listeners');
    return {name:'bounded performance listeners after repeated keyboard input',width,inputs:20,before,after};
  } finally { await cdp.detach(); }
}
