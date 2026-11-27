import { describe, expect, it } from 'vitest';
import { computeParkSubmarketTrend, computeSubmarketTrends, type TrendMetricRow } from './submarketMarketTrend';
import { classifyResearchMarket, completeProductExamples, latestProductComparison, representativeProductTrend, representativeResearchMetric } from './submarketProductResearch';

const stock = [{ id: 'a', grade: 'A' }, { id: 'p', grade: 'P' }, { id: 'b', grade: 'B' },
  { id: 'park1', grade: 'BP' }, { id: 'park2', grade: '产业园' }, { id: 'other', grade: '?' }];
const fact = (building_id: string, record_quarter: number, total_area: number, net_effective_rent: number, vacant_area: number,
  extra: Partial<TrendMetricRow> = {}): TrendMetricRow => ({ building_id, record_year: 2026, record_quarter,
  id: 1, total_area, net_effective_rent, vacant_area, is_locked: true, is_draft: false, ...extra });

describe('submarket product facts', () => {
  it('classifies complete catalog separately from editorial focus', () => {
    expect(classifyResearchMarket('望京-酒仙桥', stock)).toEqual({ type: 'mixed', officeCount: 3, parkCount: 2 });
    expect(classifyResearchMarket('上地', stock.slice(3,5))).toEqual({ type: 'park', officeCount: 0, parkCount: 2 });
    expect(classifyResearchMarket('CBD', stock.slice(0,3))).toEqual({ type: 'office', officeCount: 3, parkCount: 0 });
    expect(classifyResearchMarket('四季青', [])).toEqual({ type: 'park', officeCount: 0, parkCount: 0 });
  });
  it('keeps the office axis and computes BP weighted values with independent denominators and deterministic selection', () => {
    const office = [fact('a',2,100,200,10), fact('p',2,300,100,30), fact('b',2,100,150,20)];
    const park = [fact('park1',1,100,100,10),fact('park2',1,300,80,30),
      fact('park1',2,100,120,0),fact('park1',2,100,900,0,{id:0}),
      fact('park2',2,300,100,-1),fact('park2',3,300,150,20,{is_locked:false}),
      fact('park1',3,100,100,0,{is_draft:true})];
    const all = [...office,...park];
    expect(computeSubmarketTrends(stock, all, 'available')).toEqual(computeSubmarketTrends(stock.slice(0,3), office, 'available'));
    const [q1,q2] = computeParkSubmarketTrend(stock, all, 'available');
    expect(q1.period).toBe('2026Q1');
    expect(q2).toMatchObject({ period: '2026Q2', rent:105, vacancyPct:0, rentSamples:2, vacancySamples:1,
      rentArea:400, vacancyArea:100, stockArea:400, stockSamples:2 });
    expect(q2.sameSampleQoq?.rent.samples).toBe(2);
    expect(q2.sameSampleQoq?.rent.rentPct).toBeCloseTo((105/85-1)*100);
    expect(q2.sameSampleQoq?.vacancy.vacancyPp).toBeNull();
    expect(q2.rentDistribution).toMatchObject({samples:2,min:100,median:110,max:120});
    expect(representativeProductTrend([q1,q2])[1].vacancyPct).toBeNull();
    expect(q2.vacancyPct).toBe(0);
  });
  it('keeps actual gaps and never promotes a single sample into comparison', () => {
    const park = computeParkSubmarketTrend(stock,[fact('park1',2,100,60,20)],'available');
    const office = computeSubmarketTrends(stock,[fact('a',2,100,120,10),fact('b',2,100,100,20)],'available');
    expect(park[0].rentSamples).toBe(1);
    expect(representativeResearchMetric(park[0],'rent')).toBeNull();
    expect(latestProductComparison(office.all,park,'rent')).toBeNull();
    expect(park[0].rentDistribution).toBeUndefined();
    const gaps = computeParkSubmarketTrend(stock,[fact('park1',1,100,100,0),fact('park2',1,200,100,0),fact('park1',3,100,150,0),fact('park2',3,200,150,0)],'available');
    expect(gaps[1]).toMatchObject({period:'2026Q2',rent:null,vacancyPct:null});
    expect(gaps[2].sameSampleQoq?.rent.rentPct).toBeNull();
  });
  it('adds only visible real projects for missing mixed products', () => {
    const buildings = [{id:'office',grade:'P',submarket:'望京-酒仙桥'}, {id:'park',grade:'BP',submarket:'望京酒仙桥'},
      {id:'elsewhere',grade:'BP',submarket:'上地'}];
    expect(completeProductExamples(buildings,'望京-酒仙桥','mixed').map(item=>item.buildingId)).toEqual(['office','park']);
    expect(completeProductExamples(buildings.slice(0,1),'望京-酒仙桥','mixed').map(item=>item.buildingId)).toEqual(['office']);
  });
});
