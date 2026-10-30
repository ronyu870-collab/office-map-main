import { cp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
export async function preparePdfAssets() {
  const pkg = require.resolve('pdfjs-dist/package.json');
  const { version } = JSON.parse(await readFile(pkg, 'utf8'));
  const target = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/vendor/pdfjs', version);
  await mkdir(target, { recursive: true });
  await cp(join(dirname(pkg), 'build/pdf.worker.min.mjs'), join(target, 'pdf.worker.min.mjs'));
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) await cp(join(dirname(pkg), folder), join(target, folder), { recursive: true });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await preparePdfAssets();
