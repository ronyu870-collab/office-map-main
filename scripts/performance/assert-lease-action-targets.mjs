import assert from 'node:assert/strict';

export async function assertLeaseActionTargets(page, scope, names, touch, label) {
  const targets = [];
  for (const name of names) {
    const button = scope.getByRole('button', { name, exact: true });
    await button.waitFor();
    targets.push(await button.evaluate((element, name) => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const edgesHit = [[left + 2, y], [right - 2, y], [x, top + 2], [x, bottom - 2]]
        .every(([px, py]) => element.contains(document.elementFromPoint(px, py)));
      return { name, width, height, edgesHit, left, right, top, bottom };
    }, name));
  }
  const sizes = targets.map(({ name, width, height }) => [name, width, height]);
  if (touch) assert.ok(targets.every(({ width, height }) => width >= 44 && height >= 44),
    `${label}: expected at least 44×44 CSS px for each control; got ${JSON.stringify(sizes)}`);
  const viewport = page.viewportSize();
  assert.ok(targets.every(({ left, right, top, bottom, edgesHit }) => left >= 0 && top >= 0
    && right <= viewport.width && bottom <= viewport.height && edgesHit),
  `${label}: each control must fit in the viewport and respond across its edges; got ${JSON.stringify(targets)}`);
  for (const [index, a] of targets.entries()) {
    for (const b of targets.slice(index + 1)) {
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        `${label}: ${a.name} and ${b.name} must not overlap`);
    }
  }
  return sizes;
}
