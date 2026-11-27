import { expect, it } from 'vitest';
import { layoutFixture } from '../fixtures/layouts';
import type { SlideContent } from '../contracts/content';
import { slideSceneSchema } from '../contracts/scene';
import { carryPageContent, carryPageGeometry } from './proposal-edition';

const id = '11111111-1111-4111-8111-111111111111';
const nextSource = '22222222-2222-4222-8222-222222222222';

function chartScene(content: SlideContent, x = 1, editorId?: string) {
  const chart = content.blocks.find(block => block.kind === 'chart');
  if (!chart) throw new Error('Expected a chart fixture');
  return slideSceneSchema.parse({ protocol: content.protocol, width: 13.333333, height: 7.5,
    layoutId: 'chart-insight', themeId: 'colliers-default-v1', themeVersion: 2, layoutVersion: 1,
    elements: [{ kind: 'chart', x, y: 2, w: 8, h: 3, chartType: chart.chartType, categories: chart.categories,
      series: chart.series, editorId }] });
}

function page(content: SlideContent) {
  return { id, asset_id: id, asset_version: 1, template_id: 'business-content', template_version: 1,
    content, scene: chartScene(content) };
}

it('keeps a manual title, note and chart presentation with the new values and provenance', () => {
  const original = layoutFixture('chart-insight');
  const previous = { ...original, title: '审阅稿', blocks: original.blocks.map(block => block.kind === 'chart'
    ? { ...block, chartType: 'column' as const } : block) };
  const fresh = { ...original, dataAsOf: '2026-06-30', subtitle: '二季度正式数据',
    sources: [{ ...original.sources[0], id: nextSource, dataAsOf: '2026-06-30' }],
    blocks: original.blocks.map(block => ({
      ...block, sourceIds: [nextSource],
      ...(block.kind === 'chart' ? { series: [{ ...block.series[0], values: [5, 42, null, 18] }] } : {}),
    })) };
  const copied = carryPageContent(page(previous), original, page(fresh), { text: '请复核供应口径', baseSubtitle: '原副标题' });
  expect(copied.content).toMatchObject({ title: '审阅稿', dataAsOf: '2026-06-30',
    subtitle: '二季度正式数据 · 人工说明：请复核供应口径', sources: [{ id: nextSource }],
    blocks: [{ chartType: 'column', series: [{ values: [5, 42, null, 18] }], sourceIds: [nextSource] }, { kind: 'insight' }] });
  expect(copied.note?.baseSubtitle).toBe('二季度正式数据');

  const oldScene = chartScene(previous, 2, 'object-1');
  const updated = carryPageGeometry(oldScene, chartScene(copied.content));
  expect(updated.elements).toMatchObject([{ x: 2, editorId: 'object-1', chartType: 'column',
    series: [{ values: [5, 42, null, 18] }] }]);
});

it('rejects a conflicting rewrite of a paragraph backed by the original data', () => {
  const original = layoutFixture('chart-insight');
  const added = { ...original, blocks: [...original.blocks, { kind: 'paragraph' as const, text: '旧结论', sourceIds: [original.sources[0].id] }] };
  const edited = { ...added, blocks: added.blocks.map(block => block.kind === 'paragraph' ? { ...block, text: '修改后的旧结论' } : block) };
  const updated = { ...added, blocks: added.blocks.map(block => block.kind === 'paragraph' ? { ...block, text: '新季度结论' } : block) };
  expect(() => carryPageContent(page(edited), added, page(updated))).toThrow('PITCH_EDITION_LAYOUT');
});
