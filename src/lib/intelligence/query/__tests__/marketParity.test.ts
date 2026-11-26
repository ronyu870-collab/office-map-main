import { describe, expect, it } from 'vitest';
import { aggregateMarket } from '@/src/app/map/model/marketStatistics';
import { aggregateQuarter } from '../analytics';
import { fixture, source } from './fixtures';
import { resolveNumericFact } from '../facts';

describe('same-period same-inventory formal market parity', () => {
  it.each([2, 3])('matches AI and map weighted metrics for Q%i without fallback or mixed quarters', quarter => {
    const snapshot = fixture({year: 2026, quarter});
    const buildings = snapshot.rows.map(row => ({
      id: row.id, name: row.name, grade: 'A',
      metrics: [{ record_year: 2026, record_quarter: quarter, is_locked: true, is_draft: false,
        total_area: row.facts.totalArea?.sources[0].rawValue,
        vacant_area: row.facts.vacantArea?.sources[0].rawValue,
        net_effective_rent: row.facts.netEffectiveRent?.sources[0].rawValue }],
    }));
    const map = aggregateMarket(buildings, 'quarterly_market');
    const rent = aggregateQuarter(snapshot, 'rent'), vacancy = aggregateQuarter(snapshot, 'vacancy');
    expect(rent.value?.numeric).toBeCloseTo(map.rent!, 10);
    expect(rent.coverage.valid).toBe(map.rentSampleCount);
    expect(rent.denominator.numeric).toBe(map.rentSampleArea);
    expect(vacancy.value!.numeric * 100).toBeCloseTo(map.vacancyPct!, 10);
    expect(vacancy.coverage.valid).toBe(map.vacancySampleCount);
    expect(vacancy.denominator.numeric).toBe(map.vacancySampleArea);
  });
});

it('uses identical strict eligibility in formal quarterly map and AI; retains current-state estimates separately', () => {
  const period = {year: 2026, quarter: 2}, original = fixture(period);
  const observations = [
    {area: 100, rent: 0, vacant: null, rate: .2},
    {area: 100, rent: 200, vacant: 0, rate: .7},
    {area: 0, rent: 500, vacant: 0, rate: 0},
    {area: 100, rent: 300, vacant: 150, rate: .1},
  ];
  const snapshot = {...original, rows: original.rows.map((row,i) => ({...row,facts:{
    totalArea:resolveNumericFact('totalArea',row.id,[source(row.id,'totalArea',observations[i].area,period)],period),
    netEffectiveRent:resolveNumericFact('netEffectiveRent',row.id,[source(row.id,'netEffectiveRent',observations[i].rent,period)],period),
    vacantArea:resolveNumericFact('vacantArea',row.id,[source(row.id,'vacantArea',observations[i].vacant,period)],period),
  }}))};
  const buildings = observations.map((v,i) => ({id:snapshot.rows[i].id,grade:'A',metrics:[{record_year:2026,record_quarter:2,is_locked:true,is_draft:false,total_area:v.area,net_effective_rent:v.rent,vacant_area:v.vacant,vacancy_rate:v.rate}]}));
  const strict=aggregateMarket(buildings,'quarterly_market'), latest=aggregateMarket(buildings);
  expect(strict).toMatchObject({method:'single_formal_quarter',rent:250,rentSampleCount:2,rentSampleArea:200,vacancyPct:0,vacancySampleCount:1,vacancySampleArea:100,areaSamples:3});
  expect(aggregateQuarter(snapshot,'rent').value?.numeric).toBe(strict.rent);
  expect(aggregateQuarter(snapshot,'rent').coverage.valid).toBe(strict.rentSampleCount);
  expect(aggregateQuarter(snapshot,'vacancy').value!.numeric*100).toBe(strict.vacancyPct);
  expect(aggregateQuarter(snapshot,'vacancy').coverage.valid).toBe(strict.vacancySampleCount);
  expect(latest.rentSampleCount).toBe(3); expect(latest.vacancySampleCount).toBe(3);
  expect(()=>aggregateMarket([buildings[0],{...buildings[1],metrics:[{...buildings[1].metrics[0],record_quarter:3}]}],'quarterly_market')).toThrow('MIXED_FORMAL_QUARTER');
});
