import fs from 'node:fs';

const file = 'src/app/map/__tests__/MapWorkbenchView.test.tsx';
const source = fs.readFileSync(file, 'utf8');
const from = "expect(screen.getByText('MAP 2.0')).toBeInTheDocument();";
const to = "expect(screen.getByText('市场地图')).toBeInTheDocument();";
const count = source.split(from).length - 1;
if (count !== 1) {
  throw new Error(`${file}: expected exactly one legacy MAP 2.0 assertion, found ${count}`);
}
fs.writeFileSync(file, source.replace(from, to));
console.log('Updated Map presentation test to the canonical Chinese product label.');
