import { describe, expect, it } from 'vitest';
import { buildTrendResult, buildCompareResult } from '../result';
import { resultViewSchema } from '../presentation';
import { quarterlyAnswerIssues } from '../answerCompleteness';
import { fixture } from './fixtures';

describe('quarterly answer completion', () => {
  const base = fixture({year: 2026, quarter: 2}), current = fixture();
  it('recognizes the requested per-period samples from source-bound cells', () => {
    const result = resultViewSchema.parse(buildTrendResult([base, current], 'rent', 'per_period'));
    expect(quarterlyAnswerIssues('各期样本数量', result)).toEqual([]);
    result.table.rows[1].cells.usedCount = { kind: 'unknown', state: 'missing', reason: 'absent', sourceIds: [] };
    expect(quarterlyAnswerIssues('各期样本数量', result)).toHaveLength(1);
  });
  it('does not falsely complete an explicit request for every quarterly value', () => {
    const result = resultViewSchema.parse(buildTrendResult([base, current], 'rent', 'per_period'));
    result.table.rows[1].cells.value = { kind: 'unknown', state: 'missing', reason: 'absent', sourceIds: [] };
    expect(quarterlyAnswerIssues('提供每季度数据', result)).toHaveLength(1);
    expect(quarterlyAnswerIssues('观察趋势', result)).toEqual([]);
  });
  it('reads comparison sample counts from authorized analysis', () => {
    const result = resultViewSchema.parse(buildCompareResult(base, current, 'rent', 'per_period'));
    expect(quarterlyAnswerIssues('各期样本', result)).toEqual([]);
  });
});
