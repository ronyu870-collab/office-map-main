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
  const [source] = leasing.content.sources;
  expect(leasing.content.blocks).toEqual([{ kind: 'metric', label: '空置率', value: 0, unit: '%', sourceIds: [source.id] }]);
  const replay = projectUnifiedProposalContext({ ...context, results: context.results.map(item => ({ ...item,
    result: { ...item.result, resultId: id(334), snapshotId: 'another-read' },
  })) }, template.brief, template.scope);
  expect(replay.data.buildings[0].quarter?.sources).toEqual([source]);
  expect(plan.slides.find(slide => slide.pageKind === 'leasing-evidence')?.data).toEqual([binding]);
  expect(pages.find(page => page.pageKind === 'arrival')?.content.blocks[0]).toMatchObject({ kind: 'paragraph', text: '隔离结构样本 · 样本站' });
  expect(() => projectUnifiedProposalContext(context, { ...template.brief, period: '2026-Q3' }, template.scope)).toThrow('PITCH_PROPOSAL_PERIOD_REQUIRED');
});

it('仅把同一子市场已发布并带来源的区域研究编入招商提案', () => {
  const template = proposalFixture('leasing-agency').snapshot;
  const buildingId = template.brief.buildingIds[0];
  const market = '燕莎';
  const quarter = { domain: 'quarter' as const, permissionRevision: 'scoped', policyVersion: '1', dataVersion: 'formal', dataAsOf: '2026-06-30' };
  const business = { ...quarter, domain: 'business' as const, dataVersion: 'published-editorial', dataAsOf: '2026-08-06' };
  const aggregate: QueryResult = { resultId: id(330), createdAt: '2026-09-01T00:00:00Z', snapshotId: id(331), dataVersion: quarter.dataVersion,
    scopeFingerprint: 'fixture', registryVersion: '1', operation: 'aggregate', parameters: { metric: 'vacancy' },
    table: { id: 'formal-vacancy', columns: [], rows: [] }, analysis: null, sources: [], limitations: [] };
  const source = { id: 'profile-overview-v1', entityId: market, table: 'map_submarket_profiles', field: 'overview', recordId: 'Y-01',
    recordVersion: 'v1', rawValue: '样本研究描述', unit: 'text', period: null, recordedAt: '2026-08-09T00:00:00Z',
    businessAsOf: '2026-08-06', verification: 'database_only' as const, original: null };
  const editorial: QueryResult = { ...aggregate, operation: 'list', resultId: id(332), sources: [source],
    table: { id: 'query_submarket_profile', columns: [], rows: [{ entityId: market,
      cells: { overview: { kind: 'text', value: source.rawValue, sourceIds: [source.id] } },
    }] } };
  const field = (value: string) => ({ value, unit: null, state: 'valid', permission: 'authorized', disclosure: 'internal' });
  const context: UnifiedProposalContext = { protocol: 'unified-pitch-context/1', request: { city: template.brief.city, submarkets: [market] },
    period: { year: 2026, quarter: 2 }, disclosure: 'internal', isTestData: false, capturedAt: '2026-09-01T00:00:00Z', fingerprint: 'isolated-publication',
    bindings: [quarter], buildings: [{ buildingId, name: '隔离结构样本', static: { name: field('隔离结构样本'), submarket: field(market) }, quarter: {} }],
    results: [{ id: 'yansha:vacancy', entityId: market, binding: { ...quarter, disclosure: 'internal' }, result: aggregate },
      { id: 'submarket-research', entityId: template.brief.city, binding: { ...business, disclosure: 'internal' }, result: editorial }] };
  const brief = { ...template.brief, buildingIds: [buildingId], submarkets: [market] };
  const result = projectUnifiedProposalContext(context, brief, template.scope);
  const { pages } = buildProposal(result.snapshot, result.data, { theme: STUDIO_THEME });
  const research = pages.find(page => page.pageKind === 'submarket-research');
  expect(research?.content).toMatchObject({ subtitle: '已发布区域概况', dataAsOf: '2026-08-06' });
  expect(research?.content.sources[0]).toMatchObject({ recordId: 'Y-01', locator: 'map_submarket_profiles/Y-01/overview', version: 'v1' });
  expect(projectUnifiedProposalContext({ ...context, results: context.results.slice(0, 1) }, brief, template.scope).data.market?.spotlight).toBeUndefined();
});
