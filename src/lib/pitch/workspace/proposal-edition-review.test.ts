import { expect, it } from 'vitest';
import { layoutFixture } from '../fixtures/layouts';
import { workspaceDetailSchema } from './protocol';
import { proposalEditionReviewSchema, reviewProposalEdition } from './proposal-edition-review';

const originalId = '11111111-1111-4111-8111-111111111111';
const removedId = '22222222-2222-4222-8222-222222222222';
const updatedId = '33333333-3333-4333-8333-333333333333';
const addedId = '44444444-4444-4444-8444-444444444444';
const changedReceipt = '55555555-5555-4555-8555-555555555556';

const source = layoutFixture('chart-insight');
const original = { id: originalId, asset_id: originalId, asset_version: 1, template_id: 'business-content', template_version: 1,
  content: { ...source, title: '人工筛选后命名', dataAsOf: '2026-09-30' },
  scene: { protocol: source.protocol, width: 13.333333, height: 7.5, themeId: 'colliers-default-v1',
    themeVersion: 2, layoutId: 'chart-insight', layoutVersion: 1,
    elements: [{ kind: 'text', role: 'title', bold: true, x: 1, y: 1, w: 5, h: 1, text: '人工筛选后命名' }],
  } };
const removed = { ...original, id: removedId, content: layoutFixture('kpi') };
const old = workspaceDetailSchema.parse({
  project: { id: originalId, version: 2, title: '市场报告', theme_id: 'colliers-default-v1', theme_version: 2,
    organization_id: 'test', region: '华北', city: '北京', business_line: 'office' },
  slides: [original, removed], workspace: { context: { business: 'market-report', period: '2026-Q3' }, page_settings: {}, active_slide: originalId },
  history: [], exports: [], tasks: [],
});
const added = { ...old.slides[0], id: addedId, content: layoutFixture('data-table') };

it('uses one-to-one page mappings and includes changed figures, added or removed pages, and conclusion review', () => {
  const before = old.slides[0];
  const blocks = before.content.blocks.map(block => block.kind === 'chart'
    ? { ...block, sourceIds: [changedReceipt], chartType: 'column' as const,
      series: [{ ...block.series[0], values: [0, 42, null, 18] }] } : { ...block, sourceIds: [changedReceipt] });
  const fresh = { ...before, id: updatedId, content: {
    ...before.content, title: '二季度新页名', dataAsOf: '2026-06-30', blocks,
    sources: [{ ...before.content.sources[0], id: changedReceipt }],
  } };
  const review = proposalEditionReviewSchema.parse(reviewProposalEdition(old, [added, fresh], new Map([[originalId, updatedId]]), '2026-Q2'));
  expect(review).toMatchObject({ beforePeriod: '2026-Q3', afterPeriod: '2026-Q2', needsConclusionReview: true,
    pages: [
      { before: { id: originalId, position: 1, dataAsOf: '2026-09-30' },
        after: { id: updatedId, position: 2, dataAsOf: '2026-06-30' },
        changes: [{ before: { kind: 'chart', series: [{ values: [100, null, 120, 118] }] },
          after: { kind: 'chart', series: [{ values: [0, 42, null, 18] }] } }], conclusionChanged: false },
      { before: { id: removedId } },
      { after: { id: addedId } },
    ],
  });
  expect(review.pages[1].after).toBeUndefined();
  expect(review.pages[2].before).toBeUndefined();
  expect(review.pages[0].changes[0].after).not.toHaveProperty('sourceIds');
});

it('ignores chart presentation changes and still calls out a revised analytical conclusion', () => {
  const before = old.slides[0];
  const freeformChanged = { ...before, content: { ...before.content, blocks: before.content.blocks.map(block => block.kind === 'chart'
    ? { ...block, chartType: 'column' as const } : block) } };
  const retained = new Map(old.slides.map(page => [page.id, page.id]));
  expect(reviewProposalEdition(old, [freeformChanged, old.slides[1]], retained, '2026-Q2')).toMatchObject({ pages: [], needsConclusionReview: false });
  const analysis = { ...freeformChanged, content: { ...freeformChanged.content, blocks: freeformChanged.content.blocks.map(block =>
    block.kind === 'insight' ? { ...block, claim: '新判断' } : block) } };
  expect(reviewProposalEdition(old, [analysis, old.slides[1]], retained, '2026-Q2')).toMatchObject({
    pages: [{ changes: [], conclusionChanged: true }], needsConclusionReview: true,
  });
});


it('flags the narrative of an analytical recipe page even when expressed as paragraphs', () => {
  const before = old.slides[0];
  const paragraph = (text: string) => ({ kind: 'paragraph' as const, text, sourceIds: [before.content.sources[0].id] });
  const prior = { ...before, content: { ...before.content, blocks: [paragraph('原市场判断')] } };
  const next = { ...prior, id: updatedId, content: { ...prior.content, blocks: [paragraph('新季度判断')] } };
  const review = reviewProposalEdition({ ...old, slides: [prior] }, [next], new Map([[originalId, updatedId]]), '2026-Q2', new Set([updatedId]));
  expect(review).toMatchObject({ pages: [{ changes: [], conclusionChanged: true }], needsConclusionReview: true });
});
