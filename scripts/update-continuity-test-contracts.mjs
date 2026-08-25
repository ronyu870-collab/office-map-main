import fs from 'node:fs';

function replaceExact(file, from, to, expected = 1) {
  const source = fs.readFileSync(file, 'utf8');
  const count = source.split(from).length - 1;
  if (count !== expected) {
    throw new Error(`${file}: expected ${expected} occurrence(s) of ${JSON.stringify(from)}, found ${count}`);
  }
  fs.writeFileSync(file, source.split(from).join(to));
}

replaceExact(
  'src/app/map/__tests__/MapWorkbenchView.test.tsx',
  "expect(screen.getByText('MAP 2.0')).toBeInTheDocument();",
  "expect(screen.getByText('市场地图')).toBeInTheDocument();",
);

// Chinese product naming intentionally creates repeated visible labels in some
// shells (e.g. sidebar item + page heading, sr-only route label + page heading).
// These preservation tests are about scrolling topology, not text uniqueness.
replaceExact(
  'src/__tests__/page-scroll-layout-preservation.test.tsx',
  "expect(screen.queryByText('数据库管理')).toBeInTheDocument();",
  "expect(screen.queryAllByText('数据库管理').length).toBeGreaterThan(0);",
);
replaceExact(
  'src/__tests__/page-scroll-layout-preservation.test.tsx',
  "expect(screen.queryByText('季度数据填报')).toBeInTheDocument();",
  "expect(screen.queryAllByText('季度数据填报').length).toBeGreaterThan(0);",
);

console.log('Updated intentional presentation-only test contracts.');
