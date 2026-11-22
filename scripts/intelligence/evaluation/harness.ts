import { runAgentLoop } from '../../../src/lib/intelligence/agent/agentOrchestrator';
import { createModelRuntime } from '../../../src/lib/intelligence/agent/modelRuntime';
import { createDeepSeekAdapter } from '../../../src/lib/intelligence/agent/deepseekAdapter';
import { buildAggregateResult, type QueryResult } from '../../../src/lib/intelligence/query/result';
import { fixture } from '../../../src/lib/intelligence/query/__tests__/fixtures';
import { AuthorizedResultWorkset } from '../../../src/lib/intelligence/agent/resultWorkset';
import { queryCapabilityManifest } from '../../../src/lib/intelligence/query/capabilityManifest';
import type { ModelAdapter } from '../../../src/lib/intelligence/agent/modelProtocol';
import type { DataAuthority } from '../../../src/lib/intelligence/query/serverAuthority';
import { budgetedAdapter } from './budget.mjs';
import type { BudgetLedger } from './budget.mjs';
import { recordingAdapter, replayAdapter, hash } from './trace.mjs';

import { contract, matchesQuarterlyContract } from './contract';
export { contract } from './contract';
export async function runScenario(input: { question: string; trace: ReturnType<typeof newTrace>; ledger?: BudgetLedger; workflow?: string; attempt: string; mode: 'scripted' | 'replay' | 'live' }) {
  // Stable synthetic clock and identifiers are required for exact input replay.
  const OriginalDate = Date;
  const fixed = class extends OriginalDate {
    constructor(value?: string | number) { super(value ?? contract.clock); }
    static now() { return OriginalDate.now(); }
  };
  globalThis.Date = fixed as DateConstructor;
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const owner = { requestId: id, actorId: id, effectiveUserId: id, sessionId: id, policyVersion: 'test', permissionRevision: 'test' };
  const authority: DataAuthority = { ...owner, sessionActive: true, grants: ['query:catalog', 'query:quarter'], fields: ['totalArea', 'netEffectiveRent'],
    allSubmarkets: false, submarkets: ['CBD'], allBuildings: true, buildingIds: [] };
  const workset = new AuthorizedResultWorkset(owner);
  let toolCalls = 0, latest: QueryResult | undefined;
  const outputs: Array<{ name: string; content: unknown }> = [];
  let replay: ReturnType<typeof replayAdapter> | undefined;
  let adapter: ModelAdapter;
  if (input.mode === 'live') adapter = recordingAdapter(budgetedAdapter(createDeepSeekAdapter(), input.ledger, input.workflow, input.attempt), input.trace);
  else if (input.mode === 'replay') { replay = replayAdapter(input.trace, contract); adapter = replay.adapter; }
  else {
    let step = 0;
    adapter = recordingAdapter(async () => ({ provider: 'deepseek', model: 'deepseek-flash', inputTokens: 100, outputTokens: 20,
      message: step++ === 0 ? { role: 'assistant', content: null, calls: [{ id: 'call_1', name: 'query_quarterly_metrics',
        arguments: JSON.stringify({ scope: { inventory: 'tracked', submarkets: ['CBD'] }, period: { year: 2026, quarter: 3 }, metric: 'rent' }) }] }
        : { role: 'assistant', content: 'CBD 2026Q3 净有效租金为170 CNY/m2/month，有效样本3栋。' } }), input.trace);
  }
  const runtime = createModelRuntime({ actorId: id, question: input.question, mode: 'professional',
    adapters: { deepseek: adapter }, revalidate: async () => {}, onAttempt: async () => {} });
  try {
    const started = performance.now();
    const result = await runAgentLoop<QueryResult>({ question: input.question, signal: AbortSignal.timeout(54000),
      invoke: runtime.invoke, limits: runtime.limits,
      runTool: async (name, args) => {
        toolCalls++;
        let content: unknown;
        if (name === 'get_data_capabilities') content = { status: 'ready', authority: queryCapabilityManifest(authority) };
        else if (['query_quarterly_metrics', 'query_verified_real_estate', 'analyze_market_trends'].includes(name)) {
          // This live package has a deliberately frozen synthetic data scope.
          // Other product tasks remain visible as unsupported by this harness.
          if (!matchesQuarterlyContract(name, args)) throw Error('QUERY_DENIED');
          latest = { ...buildAggregateResult(fixture(), 'rent'), resultId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
          workset.register(latest, owner);
          content = { status: 'ready', resultId: latest.resultId, period: { year: 2026, quarter: 3 }, metric: 'rent',
            table: latest.table, unit: 'CNY/m2/month', dataVersion: 'synthetic-v1' };
        } else if (name === 'summarize_result') content = workset.summary(String(args.resultId), owner);
        else if (name === 'check_data_coverage') content = workset.coverage(String(args.resultId), owner);
        else if (name === 'select_answer_results') { const selected = workset.select(args, owner); content = { status: 'ready' }; latest = selected.results[0].result as QueryResult; }
        else throw Error('AGENT_UNREGISTERED_TOOL');
        outputs.push({ name, content }); return { content: JSON.stringify(content), ...(latest ? { result: latest } : {}) };
      } });
    replay?.finish();
    return { answer: result.answer, executionStatus: result.executionStatus, toolCalls, outputs, durationMs: Math.round(performance.now() - started),
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: result.model,
      providerRequests: input.mode === 'live' ? runtime.records.length : 0,
      protocolMatched: input.question.includes('2026Q3') ? latest?.table.rows[0].cells.value.kind === 'number' && latest.table.rows[0].cells.value.value.numeric === 170
        : input.question === '请解释空置率的含义。' ? outputs.length === 0 && !!result.answer.trim()
        : outputs.some(o => o.name === 'get_data_capabilities'),
      finalNarrativeReview: input.mode === 'live' ? 'required_before_PASS' : 'scripted_not_model_evidence' };
  } finally { globalThis.Date = OriginalDate; }
}
export function newTrace(source: 'scripted' | 'real_model') {
  return { version: 'evaluation-trace/1', environment: 'synthetic-local', source, contractHash: hash(contract), requests: [] };
}
