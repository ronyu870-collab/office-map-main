import { describe, expect, it } from 'vitest';
import { buildTrendResult, buildCompareResult } from '../result';
import { resultViewSchema } from '../presentation';
import { quarterlyAnswerIssues } from '../answerCompleteness';
import { attachResearchAnalysis } from '../researchAnalysis';
import { sampleMembership, sampleMembershipRequest } from '../sampleMembership';
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
  it('requires the actual named membership, not just the sample count', () => {
    const bare = buildTrendResult([base, current], 'rent', 'per_period');
    expect(sampleMembershipRequest('各期样本数量')).toBeNull();
    expect(sampleMembershipRequest('列出共同有效样本楼宇清单')).toBe('common');
    expect(sampleMembershipRequest('提供各期样本明细')).toBe('period');
    expect(quarterlyAnswerIssues('列出共同有效样本楼宇清单', resultViewSchema.parse(bare))).toHaveLength(1);
    const result = resultViewSchema.parse(attachResearchAnalysis(bare, [base, current]));
    const membership = sampleMembership(result, 'common');
    expect(membership.complete).toBe(true);
    expect(membership.groups[0].members.length).toBe(membership.groups[0].count);
    expect(quarterlyAnswerIssues('列出共同有效样本楼宇清单', result)).toEqual([]);
    const nameSource = membership.groups[0].members[0]?.sourceIds[0];
    expect(nameSource).toBeDefined();
    result.sources = result.sources.filter(source => source.id !== nameSource);
    expect(sampleMembership(result, 'common').complete).toBe(false);
    expect(quarterlyAnswerIssues('列出共同有效样本楼宇清单', result)).toHaveLength(1);
  });
  it('reads comparison sample counts from authorized analysis', () => {
    const result = resultViewSchema.parse(buildCompareResult(base, current, 'rent', 'per_period'));
    expect(quarterlyAnswerIssues('各期样本', result)).toEqual([]);
  });
});
