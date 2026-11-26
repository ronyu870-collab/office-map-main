import { describe, expect, it, vi } from 'vitest';
import { resolveBusinessQuestion } from '../query/question';
import { parseAgentToolArguments } from './toolRegistry';
import { runAgentLoop } from './agentOrchestrator';
import { ModelProviderError } from './modelProvider';
import { buildAggregateResult } from '../query/result';
import { fixture } from '../query/__tests__/fixtures';

// Uses pre-existing public interfaces so the same file can run against the
// frozen base commit and demonstrate the original failures, without stubs for
// routing, planning, result construction or exception handling.
describe('AI6 original production failure regressions', () => {
  it('preserves all-authorized population instead of narrowing it to tracked', () => {
    expect(resolveBusinessQuestion('2026Q2全部获权楼宇净有效租金按子市场比较'))
      .toMatchObject({ kind: 'plan', plan: { scope: { inventory: 'all_authorized' }, metric: 'rent', groupBy: 'submarket' } });
  });
  it('can express all authorized submarkets without guessing an enumerated list', () => {
    expect(parseAgentToolArguments('compare_market_segments', { period: { year: 2026, quarter: 2 }, metric: 'rent', inventory: 'all_authorized' }))
      .toMatchObject({ inventory: 'all_authorized', metric: 'rent' });
  });
  it('delivers the formal query result after the optional synthesis budget fails', async () => {
    const result = buildAggregateResult(fixture(), 'rent');
    const invoke = vi.fn().mockResolvedValueOnce({ provider: 'deepseek', model: 'deepseek-flash', inputTokens: 100, outputTokens: 20,
      message: { role: 'assistant', content: null, calls: [{ id: 'query', name: 'query_quarterly_metrics', arguments: JSON.stringify({
        scope: { inventory: 'tracked', submarkets: ['CBD'] }, period: { year: 2026, quarter: 3 }, metric: 'rent' }) }] } })
      .mockRejectedValueOnce(new ModelProviderError('budget_exceeded'));
    const response = await runAgentLoop({ question: '综合核对CBD季度数据', invoke, signal: new AbortController().signal,
      runTool: async () => ({ result, content: '{"status":"ready"}' }) });
    expect(response.result).toEqual(result); expect(response.executionStatus).toBe('partial');
  });
});
