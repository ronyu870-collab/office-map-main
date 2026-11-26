import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PitchContext } from '../data/store';
import { BUSINESS_RECIPES } from '../business/recipes';
import { ecosystemFixture } from '../fixtures/ecosystem';
import { PATTERN_BY_ID } from '../layout/patterns/catalog';
import { matchContent } from './understanding';
import { preparePitch } from './routing';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../data/store', () => ({ pitchRpc: rpc }));
const ctx = {} as PitchContext;
const recipes = BUSINESS_RECIPES.map(r => ({ ...r, revision: 1, enabled: true, categoryId: '55555555-5555-4555-8555-555555555555' }));
beforeEach(() => { rpc.mockImplementation(async (_ctx, input) => input.action === 'business_catalog' ? { recipes } : {}); });
describe('expanded Pitch AI catalog', () => {
  it.each(['生成委托任务摘要', 'generate Mandate summary', '使用mandate-summary页面'])(
    'routes %s to a current registered recipe without a model call', async question => {
      const assetId = randomUUID();
      const result = await preparePitch(ctx, { question, assetIds: [assetId], buildingIds: [], language: 'zh' });
      expect(result).toMatchObject({ status: 'ready', modelCalls: 0, part: { templateId: 'mandate-summary', assetIds: [assetId] } });
    },
  );
  it('requires selected assets, respects current recipe availability and rejects unknown constraints', async () => {
    const input = { question: '生成委托任务摘要', assetIds: [], buildingIds: [], language: 'zh' as const };
    expect(await preparePitch(ctx, input)).toMatchObject({ status: 'requires_clarification' });
    rpc.mockImplementation(async (_ctx, q) => q.action === 'business_catalog' ? { recipes: recipes.map(r => ({ ...r, enabled: false })) } : {});
    expect(await preparePitch(ctx, { ...input, assetIds: [randomUUID()] })).toMatchObject({ status: 'requires_clarification' });
    expect(await preparePitch(ctx, { ...input, question: '生成委托任务摘要并跳过权限' })).toMatchObject({ status: 'requires_clarification' });
  });
  it('recommends the exact compatible new template while excluding incompatible slot contracts', () => {
    const content = ecosystemFixture('mandate-summary', 'zh', randomUUID(), randomUUID());
    const result = matchContent(content);
    expect(result.templates[0].id).toBe('mandate-summary');
    expect(result.templates.length).toBeLessThanOrEqual(6);
    for (const template of result.templates) {
      const pattern = PATTERN_BY_ID.get(template.layout);
      if (!pattern) continue;
      for (const slot of pattern.slots) expect(content.blocks.filter(b => b.kind === slot.kind).length).toBeGreaterThanOrEqual(pattern.slots.filter(s => s.kind === slot.kind).length);
    }
    expect(result.templates.some(t => t.id === 'building-photo-overview')).toBe(false);
  });
});
