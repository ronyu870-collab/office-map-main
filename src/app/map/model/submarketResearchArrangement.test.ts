import { describe, expect, it } from 'vitest';
import cbd from '../../../../data/submarket-research/2026-11-27/cbd.json';
import finance from '../../../../data/submarket-research/2026-11-27/financial-street.json';
import zhong from '../../../../data/submarket-research/2026-11-27/zhongguancun.json';
import lize from '../../../../data/submarket-research/2026-11-27/lize.json';
import wang from '../../../../data/submarket-research/2026-11-27/wangjing-jiuxianqiao.json';
import yansha from '../../../../data/submarket-research/2026-11-27/yansha.json';
import yayao from '../../../../data/submarket-research/2026-11-27/yayao.json';
import dong from '../../../../data/submarket-research/2026-11-27/dongcheng.json';
import yu from '../../../../data/submarket-research/2026-11-27/yuyuantan.json';
import tong from '../../../../data/submarket-research/2026-11-27/tongzhou.json';
import shang from '../../../../data/submarket-research/2026-11-27/shangdi.json';
import bei from '../../../../data/submarket-research/2026-11-27/beiqinglu.json';
import siji from '../../../../data/submarket-research/2026-11-27/sijiqing.json';
import feng from '../../../../data/submarket-research/2026-11-27/fengtai-park.json';
import yi from '../../../../data/submarket-research/2026-11-27/yizhuang.json';
import media from '../../../../data/submarket-research/2026-11-27/tonghuihe.json';
import { MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY } from './mapDomain';
import { submarketIntelligenceSchema } from './submarketIntelligence';
import { buildResearchPresentation } from './submarketResearchPresentation';
import { configuredResearchMarketType } from './submarketProductResearch';
import { MARKET_RESEARCH_ARRANGEMENTS, marketResearchArrangement, researchFullModules, researchAnalysisModules,
  visibleResearchFullModules, hasRepresentativeResearchTrend, researchCatalogReferences } from './submarketResearchArrangement';
import type { SubmarketTrendPoint } from './submarketMarketTrend';
import type { MarketBuilding } from './marketStatistics';

const editions = [cbd, finance, zhong, lize, wang, yansha, yayao, dong, yu, tong, shang, bei, siji, feng, yi, media].map(edition => submarketIntelligenceSchema.parse(edition));
const point = (quarter: number, samples: number): SubmarketTrendPoint => ({
  period: '2026Q' + quarter, year: 2026, quarter, rent: 90, vacancyPct: 18,
  rentSamples: samples, vacancySamples: samples, rentArea: 1000, vacancyArea: 1000,
});

describe('sixteen market research arrangements', () => {
  it('covers the current market domain exactly and resolves aliases', () => {
    expect(Object.keys(MARKET_RESEARCH_ARRANGEMENTS).sort()).toEqual([...new Set([...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY])].filter(name => name !== '其他').sort());
    expect(editions).toHaveLength(16);
    expect(new Set(editions.map(edition => edition.market)).size).toBe(16);
    expect(marketResearchArrangement('望京—酒仙桥')).toBe(marketResearchArrangement('望京-酒仙桥'));
    expect(marketResearchArrangement('亦庄经济开发区')).toBe(marketResearchArrangement('亦庄'));
    expect(marketResearchArrangement('其他')).toBeUndefined();
    expect(new Set(Object.values(MARKET_RESEARCH_ARRANGEMENTS).map(plan => plan.full.join(','))).size).toBeGreaterThanOrEqual(10);
  });
  it.each(editions)('$market keeps published evidence and an applicable reading sequence', edition => {
    const plan = marketResearchArrangement(edition.market)!;
    expect(plan).toBeDefined();
    for (const modules of [plan.full, plan.overview, plan.analysis, plan.themeOrder]) {
      expect(new Set(modules).size).toBe(modules.length);
    }
    expect(plan.full.every(module => researchFullModules.includes(module))).toBe(true);
    expect(plan.analysis.every(module => researchAnalysisModules.includes(module))).toBe(true);
    expect(plan.full).toContain('projects');
    expect(plan.full).toContain('profile');
    const snapshot = JSON.stringify(edition);
    const projected = buildResearchPresentation(edition, configuredResearchMarketType(edition.market));
    expect(projected.chapters.flatMap(chapter => chapter.facts.map(fact => fact.key)).sort()).toEqual(edition.facts.map(fact => fact.title).sort());
    expect(projected.chapters.flatMap(chapter => chapter.observations.map(item => item.key)).sort()).toEqual(edition.observations.map(item => item.title).sort());
    expect(projected.projects.map(item => item.buildingId)).toEqual(edition.projects.map(item => item.buildingId));
    if (plan.leadTitle) {
      expect(edition.observations.some(item => item.kind === 'inference' && item.title === plan.leadTitle)).toBe(true);
      expect(projected.lead?.key).toBe(plan.leadTitle);
    }
    expect(JSON.stringify(edition)).toBe(snapshot);
    expect(JSON.stringify(projected.chapters)).not.toContain('https://');
    expect(JSON.stringify(projected.chapters)).not.toContain('"sourceIds"');
  });
  it('uses real availability rather than fixed chart counts', () => {
    for (const market of ['玉渊潭', '四季青']) {
      const plan = marketResearchArrangement(market)!;
      expect(plan.projectFirst).toBe(true);
      expect(visibleResearchFullModules(plan, { trend: false, outlook: false })).toEqual(['projects', 'profile', 'analysis']);
      expect(hasRepresentativeResearchTrend([point(2, 1)], true)).toBe(false);
      expect(hasRepresentativeResearchTrend([point(2, 3), point(2, 3)], true)).toBe(false);
      expect(hasRepresentativeResearchTrend([point(1, 3), point(2, 3)], true)).toBe(true);
      expect(hasRepresentativeResearchTrend([point(2, 0)])).toBe(false);
    }
    expect(marketResearchArrangement('丽泽')?.analysis[0]).toBe('supply');
    expect(marketResearchArrangement('中关村')?.analysis[0]).toBe('demand');
    for (const market of ['CBD', '上地', '望京-酒仙桥']) expect(marketResearchArrangement(market)?.benchmark).toBe(true);
  });
  it.each(['金融街', '燕莎', '东城商务区', '玉渊潭'])('%s only resolves matching authorized real asset identifiers', market => {
    const references = marketResearchArrangement(market)!.catalogReferences!;
    expect(references.length).toBeGreaterThan(0);
    expect(new Set(references.map(item => item.buildingId)).size).toBe(references.length);
    const buildings: MarketBuilding[] = references.map(item => ({ id: item.buildingId, submarket: market, grade: item.grade, name: '测试资产' }));
    expect(researchCatalogReferences(market, buildings).map(item => item.buildingId)).toEqual(references.map(item => item.buildingId));
    expect(researchCatalogReferences(market, [])).toEqual([]);
    expect(researchCatalogReferences(market, buildings.map(item => ({ ...item, submarket: '其他' })))).toEqual([]);
    expect(researchCatalogReferences(market, buildings.map(item => ({ ...item, grade: 'unclassified' })))).toEqual([]);
  });
  it('does not overwrite a newly edited positioning', () => {
    const edition = editions.find(item => item.market === '金融街')!;
    const positioning = '管理员维护的新市场定位';
    expect(buildResearchPresentation({ ...edition, positioning }, 'office').positioning).toBe(positioning);
  });
});
