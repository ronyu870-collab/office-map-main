import { Resvg } from '@resvg/resvg-js';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { STUDIO_THEME, VERIFICATION_THEME } from '../../design/theme';
import { layoutSlides } from '../../layout/engine';
import { numberDeckPages } from '../../layout/pagination';
import { assertSceneQuality } from '../../layout/quality';
import { inspectMedia } from '../../render/media';
import { renderPitchPptx } from '../../render/pptx';
import { buildProposal } from '..';
import { scoreShortlist } from '../scorecard';
import { proposalFixture } from './fixture';

const complete = [
  ['leasing-agency', 17, 22], ['office-comparison', 9, 14], ['market-report', 15, 25], ['building-promotion', 5, 9],
] as const;

async function renderExample(scenario: (typeof complete)[number][0], theme: typeof STUDIO_THEME) {
  const { snapshot, data } = proposalFixture(scenario);
  const result = buildProposal(snapshot, data, { theme });
  const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="960"><rect width="1440" height="960" fill="#dce2e6"/></svg>').render().asPng();
  const media = await inspectMedia(snapshot.visuals.filter(visual => visual.kind !== 'stacking-plan')
    .map(visual => ({ id: visual.id, version: visual.version, mime: 'image/png', bytes: png })));
  const scenes = [];
  for (const page of result.pages) {
    try {
      const group = await layoutSlides(page.content, result.theme, page.layoutId, page.variant);
      for (const scene of group) {
        await assertSceneQuality(scene, result.theme, media);
        scenes.push({ scene, theme: result.theme });
      }
    } catch (error) {
      throw new Error(`${scenario}/${page.pageKind}: ${String(error)}`, { cause: error });
    }
  }
  const bytes = await renderPitchPptx(result.plan.title, numberDeckPages(scenes), media);
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+[.]xml$/.test(name));
  const xml = (await Promise.all(files.map(name => zip.file(name)!.async('string')))).join('');
  return { result, xml, files, zip };
}

describe('旗舰提案编排', () => {
  it.each(complete)('生成 %s 的完整中文提案，可换完整主题并导出原生 PPTX', async (scenario, min, max) => {
    const first = await renderExample(scenario, STUDIO_THEME);
    const second = await renderExample(scenario, VERIFICATION_THEME);
    for (const { result, xml, files, zip } of [first, second]) {
      expect(files.length).toBeGreaterThanOrEqual(min);
      expect(files.length).toBeLessThanOrEqual(max);
      expect(xml).toContain('测试数据，非真实案例');
      expect(xml).toContain('<a:tbl>');
      expect(xml).toContain('<p:pic>');
      if (scenario !== 'building-promotion') expect(Object.keys(zip.files).some(name => /^ppt\/charts\/chart\d+[.]xml$/.test(name))).toBe(true);
      expect(result.plan.slides.map(slide => slide.id)).toEqual(result.pages.map(page => page.id));
      expect(result.pages.every(page => page.content.isTestData && page.content.disclosure === 'internal')).toBe(true);
      expect(result.plan.slides.some(slide => slide.visuals.some(asset => asset.kind === 'map'))).toBe(true);
      expect(result.plan.slides.some(slide => slide.visuals.some(asset => asset.kind === 'stacking-plan'))).toBe(true);
    }
    expect(second.result.pages.map(page => page.content)).toEqual(first.result.pages.map(page => page.content));
    expect(first.xml).not.toBe(second.xml);
    if (scenario === 'office-comparison') {
      const photos = first.result.plan.slides.filter(slide => slide.pageKind === 'projects').flatMap(slide => slide.visuals);
      expect(new Set(photos.flatMap(photo => photo.buildingIds)).size).toBe(5);
      expect(first.xml).toContain('未评级');
    }
  }, 90_000);

  it('缺少正式数据或撤回素材时按页降级，保留同一项目与期间', () => {
    const { snapshot, data } = proposalFixture('building-promotion');
    snapshot.visuals = [];
    snapshot.brief.period = '2026-Q3';
    data.contact = undefined;
    const result = buildProposal(snapshot, data, { theme: STUDIO_THEME });
    expect(result.pages[0].content.blocks.every(block => block.kind !== 'image')).toBe(true);
    expect(result.pages.map(page => page.pageKind)).not.toContain('spaces');
    expect(result.pages.map(page => page.pageKind)).not.toContain('leasing-evidence');
    expect(result.pages.at(-1)?.pageKind).toBe('next-steps');
    expect(result.pages.every(page => page.content.dataAsOf === '2026-09-30')).toBe(true);
    expect(result.plan.gaps.some(gap => gap.pageKind === 'spaces')).toBe(true);
  });

  it('客户端永远拒绝测试上下文，默认不猜客户预算或评分偏好', () => {
    const { snapshot, data } = proposalFixture('office-comparison');
    data.customerBrief = undefined;
    data.scoreWeights = undefined;
    const result = buildProposal(snapshot, data, { theme: STUDIO_THEME });
    expect(result.pages.find(page => page.pageKind === 'requirements')?.content.title).toContain('待客户确认');
    expect(result.plan.slides.some(slide => slide.pageKind === 'scorecard')).toBe(false);
    snapshot.brief.audience = 'client';
    expect(() => buildProposal(snapshot, data, { theme: STUDIO_THEME })).toThrow('PITCH_PROPOSAL_CLIENT_FIXTURE');
  });

  it('候选楼宇、目标与历史期间可调整，拒绝跨域资料与错误构图', () => {
    const { snapshot, data } = proposalFixture('leasing-agency');
    snapshot.brief.buildingIds = snapshot.brief.buildingIds.slice(0, 2);
    snapshot.brief.start = '2026-Q1';
    const result = buildProposal(snapshot, data, { theme: STUDIO_THEME, targetBuildingId: snapshot.brief.buildingIds[1], pages: { 'positioning-matrix': { include: false } } });
    expect(result.pages[0].content.title).toContain('乙座');
    expect(result.plan.slides.find(slide => slide.pageKind === 'competition-map')?.visuals).toEqual([]);
    expect(result.plan.slides.some(slide => slide.pageKind === 'positioning-matrix')).toBe(false);
    expect(() => buildProposal(snapshot, data, { theme: STUDIO_THEME, pages: { cover: { layoutId: 'data-table' } } })).toThrow('PITCH_PROPOSAL_LAYOUT_INCOMPATIBLE');
  });

  it('只按显式权重比较完整候选，保留真实零值且小样本不排名', () => {
    const candidates = [{ buildingId: 'a', values: { netEffectiveRent: 90, vacancyRate: 0 } },
      { buildingId: 'b', values: { netEffectiveRent: 180, vacancyRate: .1 } }, { buildingId: 'c', values: { netEffectiveRent: 70, vacancyRate: null } }];
    expect(scoreShortlist(candidates, { netEffectiveRent: 70, vacancyRate: 30 }).map(row => row.score)).toEqual([70, 30, null]);
    expect(scoreShortlist(candidates, { netEffectiveRent: 30, vacancyRate: 70 }).map(row => row.score)).toEqual([30, 70, null]);
    expect(scoreShortlist(candidates.slice(1), { netEffectiveRent: 30, vacancyRate: 70 }).map(row => row.score)).toEqual([null, null]);
  });
});
