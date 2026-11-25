// Offline wire-byte comparison. No provider request and no fabricated tokens.
// Pass a frozen source tree (e.g. git archive of the PR base) for a true source
// comparison; the output explicitly separates potential context from usage.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';
const root = process.cwd(), base = process.argv[2];
assert.ok(base && path.isAbsolute(base), 'Provide a frozen, absolute baseline source path');
const temp = await mkdtemp(path.join(tmpdir(), 'colliers-ai6-context-'));
async function api(source, name, current = false) {
  const entry = [
    `export {agentInstructions} from ${JSON.stringify(source + '/src/lib/intelligence/agent/agentOrchestrator.ts')};`,
    `export {modelToolCatalogue} from ${JSON.stringify(source + '/src/lib/intelligence/agent/modelRuntime.ts')};`,
    ...(current ? [`export {modelContextEnvelope} from ${JSON.stringify(source + '/src/lib/intelligence/agent/modelContext.ts')};`,
      `export {routeTask} from ${JSON.stringify(source + '/src/lib/intelligence/agent/taskRouting.ts')};`] : []),
  ].join('\n');
  const bundle = await rolldown({ input: '\0ai6-benchmark', platform: 'node', resolve: { alias: { '@': source } }, external: ['openai'],
    plugins: [{ name: 'offline-context', resolveId(id) { if (id === '\0ai6-benchmark') return id; }, load(id) { if (id === '\0ai6-benchmark') return entry; } }] });
  const file = path.join(temp, name + '.cjs');
  try { await bundle.write({ file, format: 'cjs' }); } finally { await bundle.close(); }
  return createRequire(import.meta.url)(file);
}
try {
  const before = await api(base, 'before'), after = await api(root, 'after', true);
  const questions = ['什么是净有效租金', '2026Q2 CBD净有效租金', '2026Q2全部获权楼宇净有效租金按子市场比较', '把CBD在2026Q2净有效租金最高的10栋楼导出Excel'];
  const cases = questions.map(question => {
    const measure = source => {
      const messages = [{ role: 'system', content: source.agentInstructions(question) }, { role: 'user', content: question }];
      return after.modelContextEnvelope('deepseek', messages, source.modelToolCatalogue(question, 'professional', messages));
    };
    const old = measure(before), revised = measure(after), route = after.routeTask(question).route;
    const actualPlannedBytes = ['direct_response', 'deterministic_query'].includes(route) ? 0 : revised.messageBytes + revised.toolBytes;
    const oldBytes = old.messageBytes + old.toolBytes;
    return { question, route, beforeOfferedBytes: oldBytes, afterOfferedBytes: revised.messageBytes + revised.toolBytes,
      afterPlannedProviderBytes: actualPlannedBytes, plannedByteReduction: 1 - actualPlannedBytes / oldBytes,
      beforeToolCount: old.toolCount, afterToolCount: revised.toolCount, supplierTokens: null, actualBilledUsd: null };
  });
  console.log(JSON.stringify({ protocol: 'ai6-offline-context/1', baseline: base, providerRequests: 0,
    measurement: 'UTF-8 serialized messages plus tool schemas; potential baseline input, not provider-reported usage or latency', cases }, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
