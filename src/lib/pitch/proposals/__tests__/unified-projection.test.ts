import { expect, it } from 'vitest';
import type { QueryResult } from '@/src/lib/intelligence/query/result';
import { STUDIO_THEME } from '../../design/theme';
import { buildProposal, projectUnifiedProposalContext } from '..';
import type { UnifiedProposalContext } from '../unified-projection';
import { id, proposalFixture } from './fixture';

it('从统一数据上下文投影正式楼宇、原始凭据和真实零值，并拒绝季度漂移', () => {
  const template = proposalFixture('building-promotion').snapshot;
  const buildingId = template.brief.buildingIds[0];
  const binding = { domain: 'quarter' as const, permissionRevision: 'strict', policyVersion: '1', dataVersion: 'typed-fixture', dataAsOf: '2026-06-30' };
  const selected: QueryResult = { resultId: id(333), createdAt: '2026-07-01T00:00:00Z', snapshotId: 'fixture', dataVersion: binding.dataVersion,
    scopeFingerprint: 'fixture', registryVersion: '1', operation: 'list', parameters: {}, table: { id: 'fixture', columns: [], rows: [] },
    analysis: null, sources: [], limitations: [] };
  const field = (value: string | number, unit: string | null = null) => ({ value, unit, state: 'valid', permission: 'authorized', disclosure: 'internal' });
  const context: UnifiedProposalContext = { protocol: 'unified-pitch-context/1', request: { city: template.brief.city, submarkets: [] },
    period: { year: 2026, quarter: 2 }, disclosure: 'internal', isTestData: false, capturedAt: '2026-07-01T00:00:00Z', fingerprint: 'typed-isolated-fixture',
    bindings: [binding], buildings: [{ buildingId, name: '隔离结构样本', static: { name: field('隔离结构样本'), metro: field('样本站'), standardFloorArea: field(1000, 'm2') },
      quarter: { vacancy: field(0, 'ratio'), netEffectiveRent: { ...field(888, 'CNY/m2/month'), state: 'unauthorized' } } }],
    results: [{ id: 'selected-buildings', entityId: template.brief.city, binding: { ...binding, disclosure: 'internal' }, result: selected }] };
  const { snapshot, data } = projectUnifiedProposalContext(context, { ...template.brief, period: null }, template.scope);
  const { pages, plan } = buildProposal({ ...snapshot, isTestData: true }, data, { theme: STUDIO_THEME });
  const leasing = pages.find(page => page.pageKind === 'leasing-evidence')!;
  expect(leasing.content.blocks).toEqual([{ kind: 'metric', label: '空置率', value: 0, unit: '%', sourceIds: [selected.resultId] }]);
  expect(plan.slides.find(slide => slide.pageKind === 'leasing-evidence')?.data).toEqual([binding]);
  expect(pages.find(page => page.pageKind === 'arrival')?.content.blocks[0]).toMatchObject({ kind: 'paragraph', text: '隔离结构样本 · 样本站' });
  expect(() => projectUnifiedProposalContext(context, { ...template.brief, period: '2026-Q3' }, template.scope)).toThrow('PITCH_PROPOSAL_PERIOD_REQUIRED');
});
