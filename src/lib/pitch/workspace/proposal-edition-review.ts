import { z } from 'zod';
import { contentBlockSchema } from '../contracts/content';
import type { WorkspaceDetail } from './protocol';

const [, metric, , table, chart] = contentBlockSchema.options;
const evidenceSchema = z.discriminatedUnion('kind', [
  metric.omit({ sourceIds: true }),
  table.omit({ sourceIds: true }),
  chart.omit({ sourceIds: true }),
]);
const endpoint = z.object({ id: z.uuid(), title: z.string().max(160), position: z.number().int().min(1).max(50), dataAsOf: z.iso.date() });
const comparison = z.object({ before: evidenceSchema.optional(), after: evidenceSchema.optional() })
  .refine(pair => !!pair.before || !!pair.after);

export const proposalEditionReviewSchema = z.object({
  beforePeriod: z.string().regex(/^20\d{2}-Q[1-4]$/),
  afterPeriod: z.string().regex(/^20\d{2}-Q[1-4]$/),
  needsConclusionReview: z.boolean(),
  sourcesChanged: z.literal(true).optional(),
  pages: z.array(z.object({
    before: endpoint.optional(), after: endpoint.optional(), changes: z.array(comparison), conclusionChanged: z.boolean(),
  }).refine(page => !!page.before || !!page.after)).max(100),
});
export type ProposalEditionReview = z.infer<typeof proposalEditionReviewSchema>;

type Page = WorkspaceDetail['slides'][number];
type Evidence = z.infer<typeof evidenceSchema>;

const equal = (before: unknown, after: unknown) => JSON.stringify(before) === JSON.stringify(after);

function labels(block: Evidence) {
  if (block.kind === 'metric') return [block.label, block.unit];
  if (block.kind === 'table') return block.columns;
  return block.series.map(series => [series.name, series.unit]);
}

function comparable(block: Evidence) {
  if (block.kind !== 'chart') return block;
  return { categories: block.categories, series: block.series, ...('xAxis' in block ? { xAxis: block.xAxis } : {}) };
}

function evidence(page?: Page) {
  return page?.content.blocks.flatMap(({ sourceIds: _sourceIds, ...block }) => {
    void _sourceIds;
    return block.kind === 'metric' || block.kind === 'chart' || block.kind === 'table' ? [block] : [];
  }) ?? [];
}

function conclusions(page?: Page, includeNarrative = false): unknown[] {
  return page?.content.blocks.flatMap((block): unknown[] => {
    if (block.kind === 'insight') return [{ claim: block.claim, basis: block.basis, limitations: block.limitations }];
    if (includeNarrative && block.kind === 'paragraph') return [block.text];
    return [];
  }) ?? [];
}

function compareEvidence(before: Evidence[], after: Evidence[]) {
  if (equal(before.map(comparable), after.map(comparable))) return [];
  const key = (block: Evidence) => JSON.stringify([block.kind, labels(block)]);
  const positions = (blocks: Evidence[]) => {
    const byKey = new Map<string, number[]>();
    for (const [index, block] of blocks.entries()) {
      const label = key(block);
      const existing = byKey.get(label);
      if (existing) existing.push(index);
      else byKey.set(label, [index]);
    }
    return byKey;
  };
  const left = positions(before), right = positions(after);
  const matched = new Set<number>();
  const pairs: z.infer<typeof comparison>[] = [];
  for (const original of before) {
    const label = key(original);
    const candidates = right.get(label);
    if (left.get(label)?.length !== 1 || candidates?.length !== 1) {
      pairs.push({ before: original });
      continue;
    }
    const index = candidates[0];
    matched.add(index);
    if (!equal(comparable(original), comparable(after[index]))) pairs.push({ before: original, after: after[index] });
  }
  for (const [index, updated] of after.entries()) {
    if (!matched.has(index)) pairs.push({ after: updated });
  }
  return pairs;
}

export function reviewProposalEdition(current: WorkspaceDetail, next: readonly Page[],
  preserved: ReadonlyMap<string, string>, afterPeriod: string, analyticalPages: ReadonlySet<string> = new Set()): ProposalEditionReview {
  const incoming = new Map(next.map((page, index) => [page.id, { page, position: index + 1 }]));
  const pages: ProposalEditionReview['pages'] = [];
  const summarize = ({ id, content }: Page, position: number) => ({ id, title: content.title, position, dataAsOf: content.dataAsOf });
  const hasConclusions = analyticalPages.size > 0 || [...current.slides, ...next].some(page => conclusions(page).length);
  const add = (before?: { page: Page; position: number }, after?: { page: Page; position: number }) => {
    const prior = evidence(before?.page), next = evidence(after?.page);
    const changes = compareEvidence(prior, next);
    const includeNarrative = !!after && analyticalPages.has(after.page.id);
    const conclusionChanged = !equal(conclusions(before?.page, includeNarrative), conclusions(after?.page, includeNarrative));
    const dateChanged = (prior.length || next.length) && before?.page.content.dataAsOf !== after?.page.content.dataAsOf;
    if (before && after && !changes.length && !conclusionChanged && !dateChanged) return;
    pages.push({ before: before && summarize(before.page, before.position), after: after && summarize(after.page, after.position),
      changes, conclusionChanged });
  };
  for (const [index, page] of current.slides.entries()) {
    const nextId = preserved.get(page.id);
    const updated = nextId ? incoming.get(nextId) : undefined;
    add({ page, position: index + 1 }, updated);
    if (updated) incoming.delete(updated.page.id);
  }
  for (const added of incoming.values()) add(undefined, added);
  return {
    beforePeriod: current.workspace.context.period, afterPeriod, pages,
    needsConclusionReview: pages.some(page => page.conclusionChanged || hasConclusions && page.changes.length > 0),
  };
}
