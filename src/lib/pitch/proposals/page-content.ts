import { PROTOCOL, slideContentSchema } from '../contracts/content';
import { PATTERN_BY_ID } from '../layout/patterns/catalog';
import type { LayoutId } from '../contracts/scene';
import type { Evidence, PageAudience, Period, ProposalBlock } from './projection';

type Unbound<B = ProposalBlock> = B extends ProposalBlock ? Omit<B, 'sourceIds'> : never;
export type BoundBlock = { block: Unbound; evidence: readonly Evidence<unknown>[] };
export type Chart = Extract<ProposalBlock, { kind: 'chart' }>;
export type Table = Extract<ProposalBlock, { kind: 'table' }>;

export function usableEvidence<T>(record: Evidence<T> | undefined, audience: PageAudience): record is Evidence<T> {
  return Boolean(record?.sources.length && record.disclosure !== 'restricted'
    && (audience === 'internal' || (record.disclosure === 'client_approved' && !record.isTestData
      && record.sources.every(source => source.kind !== 'synthetic'))));
}

export const periodLabel = (period: Period) => `${period.year} Q${period.quarter}`;
export const periodOrder = (period: Period) => period.year * 4 + period.quarter;
export const periodEnd = (period: Period) => `${period.year}-${['03-31', '06-30', '09-30', '12-31'][period.quarter - 1]}`;

export function bind(block: Unbound, evidence: readonly Evidence<unknown>[]): BoundBlock {
  return { block, evidence };
}

export const prose = (text: string, evidence: readonly Evidence<unknown>[]) => bind({ kind: 'paragraph', text }, evidence);
export const table = (columns: Table['columns'], rows: Table['rows'], evidence: readonly Evidence<unknown>[]) => bind({ kind: 'table', columns, rows }, evidence);
export const chart = (chartType: Chart['chartType'], categories: string[], series: Chart['series'], evidence: readonly Evidence<unknown>[]) => bind({ kind: 'chart', chartType, categories, series }, evidence);

export function composeContent(title: string, subtitle: string, blocks: readonly BoundBlock[], period: Period, audience: PageAudience, isTestData: boolean) {
  const evidence = blocks.flatMap(item => item.evidence);
  if (!evidence.every(item => usableEvidence(item, audience))) throw new Error('Page requires evidence cleared for its audience.');
  const byId = new Map<string, Evidence<unknown>['sources'][number]>();
  for (const reference of evidence.flatMap(item => item.sources)) {
    const prior = byId.get(reference.id);
    if (prior && (prior.version !== reference.version || prior.dataAsOf !== reference.dataAsOf || prior.locator !== reference.locator || prior.sha256 !== reference.sha256)) {
      throw new Error('PITCH_PROPOSAL_SOURCE_CONFLICT');
    }
    byId.set(reference.id, reference);
  }
  const sources = [...byId.values()];
  return slideContentSchema.parse({
    protocol: PROTOCOL,
    locale: 'zh',
    title,
    subtitle,
    blocks: blocks.map(({ block, evidence }) => ({ ...block, sourceIds: [...new Set(evidence.flatMap(item => item.sources.map(source => source.id)))] })),
    sources,
    dataAsOf: periodEnd(period),
    disclosure: audience === 'client' ? 'client_approved' : 'internal',
    isTestData: isTestData || evidence.some(item => item.isTestData) || sources.some(source => source.kind === 'synthetic'),
  });
}

export function matchesPattern(id: LayoutId, blocks: readonly BoundBlock[]) {
  const pattern = PATTERN_BY_ID.get(id);
  return Boolean(pattern && pattern.slots.length === blocks.length && pattern.slots.every(slot => pattern.slots.filter(other => other.kind === slot.kind).length === blocks.filter(block => block.block.kind === slot.kind).length));
}
