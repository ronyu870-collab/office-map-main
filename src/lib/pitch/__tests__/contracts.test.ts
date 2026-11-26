import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PROTOCOL, slideContentSchema, assetInputSchema } from '../contracts/content';
import { buildTemplateContent, BASIC_TEMPLATE, layoutContent, templateConfigSchema } from '../templates/registry';
import { DEFAULT_THEME } from '../design/theme';
import { slideSceneSchema } from '../contracts/scene';
const source = randomUUID(), media = randomUUID();
const content = { protocol: PROTOCOL, locale: 'zh', title: '测试单页', disclosure: 'internal', isTestData: true, dataAsOf: '2026-01-01',
  sources: [{ id: source, kind: 'synthetic', label: '测试数据', locator: 'logical-unit:1', version: '1', dataAsOf: '2026-01-01' }],
  blocks: [{ kind: 'paragraph', text: '测试正文', sourceIds: [source] }, { kind: 'image', mediaAssetId: media, mediaVersion: 1, alt: '示意图', sourceIds: [source] }] };
describe('Pitch versioned contracts and reviewed template boundary', () => {
  it('expresses structured business content without losing unknown values or evidence', () => {
    const blocks = [
      ...content.blocks,
      { kind: 'metric', label: '空置面积', value: null, unit: '平方米', sourceIds: [source] },
      { kind: 'table', columns: ['名称', '面积'], rows: [['示意', null]], sourceIds: [source] },
      { kind: 'chart', chartType: 'bar', categories: ['Q1'], series: [{ name: '测试', values: [null], unit: '元' }], sourceIds: [source] },
      { kind: 'map', mapId: 'snapshot', snapshotVersion: '1', buildingIds: [], sourceIds: [source] },
      { kind: 'timeline', entries: [{ date: '2026-01-01', title: '测试', description: '示意' }], sourceIds: [source] },
      { kind: 'team', members: [{ name: '测试人员', title: '合成身份', biography: '非真实人员' }], sourceIds: [source] },
      { kind: 'case', title: '合成案例', challenge: '示意', approach: '示意', outcome: '未知', sourceIds: [source] },
      { kind: 'insight', claim: '示意观点', basis: '合成数据', limitations: ['非业务结论'], sourceIds: [source] },
    ];
    const result = slideContentSchema.parse({ ...content, blocks });
    expect(result.blocks).toHaveLength(10);
    expect(result.blocks[2]).toMatchObject({ value: null });
  });
  it('rejects dangling evidence, misleading test labels, invalid chart/table shapes and future protocols', () => {
    expect(slideContentSchema.safeParse({ ...content, protocol: 'colliers-pitch/2' }).success).toBe(false);
    expect(slideContentSchema.safeParse({ ...content, isTestData: false }).success).toBe(false);
    expect(slideContentSchema.safeParse({ ...content, blocks: [{ kind: 'paragraph', text: 'x', sourceIds: [randomUUID()] }] }).success).toBe(false);
    expect(slideContentSchema.safeParse({ ...content, blocks: [{ kind: 'table', columns: ['a'], rows: [[1, 2]], sourceIds: [source] }] }).success).toBe(false);
    expect(slideContentSchema.safeParse({ ...content, blocks: [{ kind: 'chart', chartType: 'bar', categories: ['Q1'], series: [{ name: 'x', values: [], unit: '' }], sourceIds: [source] }] }).success).toBe(false);
  });
  it('separates export/AI approval from internal generation and validates business validity', () => {
    const input = { scope: { organizationId: 'synthetic', region: 'test', city: 'test', businessLine: 'test' }, categoryId: randomUUID(), tags: [], names: { zh: '测试' }, content,
      state: 'draft', visibility: 'private', allowInternalGeneration: true, allowClientExport: false, allowExternalAi: false, validFrom: null, validUntil: null };
    expect(assetInputSchema.safeParse(input).success).toBe(true);
    expect(assetInputSchema.safeParse({ ...input, allowClientExport: true }).success).toBe(false);
    expect(assetInputSchema.safeParse({ ...input, allowExternalAi: true }).success).toBe(false);
    expect(assetInputSchema.safeParse({ ...input, validFrom: '2026-12-01', validUntil: '2026-01-01' }).success).toBe(false);
  });
  it('lets config reuse a reviewed adapter while rejecting executable payloads and unsupported content', () => {
    expect(buildTemplateContent({ ...BASIC_TEMPLATE, id: 'configured-template' }, content, { language: 'zh' }).title).toBe('测试单页');
    expect(() => buildTemplateContent(BASIC_TEMPLATE, content, { language: 'en' })).toThrow('PITCH_LANGUAGE_UNAVAILABLE');
    expect(() => buildTemplateContent(BASIC_TEMPLATE, { ...content, title: 'x'.repeat(41) }, { language: 'zh' })).toThrow('PITCH_LAYOUT_CAPACITY');
    expect(templateConfigSchema.safeParse({ ...BASIC_TEMPLATE, execute: 'eval()' }).success).toBe(false);
    expect(templateConfigSchema.safeParse({ ...BASIC_TEMPLATE, adapter: 'arbitrary-js' }).success).toBe(false);
  });
  it('pins layout and theme independently and rejects off-page coordinates', () => {
    const scene = layoutContent(slideContentSchema.parse(content), DEFAULT_THEME);
    expect(scene).toMatchObject({ layoutId: 'text-image', layoutVersion: 1, themeId: DEFAULT_THEME.id, themeVersion: 1 });
    expect(DEFAULT_THEME.approval).toBe('provisional');
    expect(new Set(Object.values(DEFAULT_THEME.typography)).size).toBe(2);
    expect(slideSceneSchema.safeParse({ ...scene, elements: [{ ...scene.elements[0], x: 13, w: 2 }] }).success).toBe(false);
  });
});
