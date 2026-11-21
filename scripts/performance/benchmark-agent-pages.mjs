// Isolated CPU/payload measurement. No identities, credentials, network or private data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { rolldown } from 'rolldown';

const root = process.cwd(), relative = 'src/lib/intelligence/agent/resultWorkset.ts';
const revision = execFileSync('git', ['rev-parse', '--verify', process.argv[2] ?? 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(revision, /^[0-9a-f]{40}$/);
const original = execFileSync('git', ['show', revision + ':' + relative], { encoding: 'utf8' });
const directory = await mkdtemp(path.join(tmpdir(), 'ai5-page-benchmark-'));
const require = createRequire(import.meta.url);
async function load(baseline) {
  const filename = path.join(directory, baseline ? 'baseline.cjs' : 'candidate.cjs');
  const bundle = await rolldown({ input: 'virtual:benchmark', platform: 'node', plugins: [{ name: 'benchmark-fixture',
    resolveId(id) { if (id === 'virtual:benchmark') return id; },
    load(id) {
      if (baseline && id === path.join(root, relative)) return original;
      if (id === 'virtual:benchmark') return `export { AuthorizedResultWorkset } from ${JSON.stringify(path.join(root, relative))};
        export { buildListResult } from ${JSON.stringify(path.join(root, 'src/lib/intelligence/query/result.ts'))};
        export { fixture } from ${JSON.stringify(path.join(root, 'src/lib/intelligence/query/__tests__/fixtures.ts'))};`;
    } }] });
  try { await bundle.write({ file: filename, format: 'cjs', codeSplitting: false }); } finally { await bundle.close(); }
  return require(filename);
}
try {
  const variants = [await load(true), await load(false)], output = [];
  for (const [label, name] of [['short', '合成楼宇'], ['wide-ascii', 'x'.repeat(900)], ['wide-chinese', '中文资料'.repeat(100)]]) {
    const identity = { requestId: 'benchmark', actorId: 'synthetic', effectiveUserId: 'synthetic', sessionId: 'session', permissionRevision: 'revision', policyVersion: 'test' };
    const worksets = variants.map(({ AuthorizedResultWorkset, buildListResult, fixture }) => {
      const result = buildListResult(fixture(), ['height']);
      const raw = { ...result, table: { ...result.table, rows: Array.from({ length: 50000 }, (_, i) => ({ ...result.table.rows[i % 4], entityId: 'building-' + i,
        cells: { ...result.table.rows[i % 4].cells, name: { kind: 'text', value: name, sourceIds: [] } } })) } };
      const workset = new AuthorizedResultWorkset(identity); workset.register(raw, identity);
      return { workset, input: { resultId: raw.resultId, offset: 1234, limit: 100 } };
    });
    const samples = [[], []], serializations = [[], []], pages = [];
    function sample(index, measured) {
      const { workset, input } = worksets[index], stringify = JSON.stringify;
      let calls = 0;
      JSON.stringify = (...args) => { calls++; return stringify(...args); };
      const start = performance.now();
      try { pages[index] = workset.page(input, identity); }
      finally { const duration = performance.now() - start; JSON.stringify = stringify;
        if (measured) { samples[index].push(duration); serializations[index].push(calls); } }
    }
    for (let i = 0; i < 6; i++) { sample(0, false); sample(1, false); }
    for (let i = 0; i < 20; i++) { sample(i % 2, true); sample(1 - i % 2, true); }
    const percentile = (a, p) => [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1];
    const stats = index => ({ p50Ms: percentile(samples[index], .5), p95Ms: percentile(samples[index], .95),
      serializations: Math.max(...serializations[index]), rows: pages[index].returnedRows, bytes: Buffer.byteLength(JSON.stringify(pages[index])) });
    assert.equal(pages[1].totalMatched, 50000); assert.ok(stats(1).bytes <= 9500); assert.ok(stats(1).serializations <= 9);
    output.push({ fixture: label, tableRows: 50000, pairs: 20, baseline: stats(0), candidate: stats(1) });
  }
  const result = { baseline: revision, scope: 'request-local page CPU only; no database/auth/model/download latency claims', output };
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
