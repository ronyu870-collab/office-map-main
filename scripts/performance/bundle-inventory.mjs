import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const [output] = process.argv.slice(2);
if (!output) throw new Error('Usage: bundle-inventory.mjs output.json');
const routes = ['/', '/map', '/compare', '/oss', '/update', '/lease-submission', '/admin'];
const inventory = routes.map((route) => {
  const directory = route === '/' ? '.next/server/app' : `.next/server/app${route}`;
  const context = {};
  vm.runInNewContext(fs.readFileSync(`${directory}/page_client-reference-manifest.js`, 'utf8'), context);
  const manifest = context.__RSC_MANIFEST[route === '/' ? '/page' : `${route}/page`];
  const chunks = new Set(Object.values(manifest.clientModules).flatMap((entry) => entry.chunks)
    .filter((chunk) => chunk.endsWith('.js')));
  const files = [...chunks].map((file) => {
    const bytes = fs.readFileSync(path.join('.next', file));
    return { file, bytes: bytes.length, gzip_bytes: gzipSync(bytes).length,
      contains_controller_diagnostic: bytes.includes(Buffer.from('[MapController]')) };
  });
  return { route, files, unique_referenced_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    unique_referenced_gzip_bytes: files.reduce((sum, file) => sum + file.gzip_bytes, 0) };
});
const result = { schema_version: 1,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  build_id: fs.readFileSync('.next/BUILD_ID', 'utf8').trim(),
  collected_at: new Date().toISOString(), inventory,
  limitations: ['Client-reference manifest inventory, not an observed browser request waterfall',
    'Shared chunks counted once within each route, not across route totals',
    'Gzip computed locally; actual CDN encoding/transfer may differ',
    'Controller diagnostic identifies emitted code presence, not CPU cost or package byte attribution'],
};
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(inventory.map(({ route, unique_referenced_bytes, unique_referenced_gzip_bytes }) =>
  ({ route, unique_referenced_bytes, unique_referenced_gzip_bytes }))));
