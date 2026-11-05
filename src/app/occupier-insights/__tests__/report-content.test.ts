import { describe, expect, it } from 'vitest';
import { charts, ecosystem, industryProfiles, assetServices, portfolioReasons, portfolioOffer, costLayers, employeePriorities, workplaceOffer, greenBenefits, greenEvidence, marketQuestions, reviewAreas, conclusions } from '../reportContent';
// Independently reviewed transcription, in display order. Do not derive expectations from the component.
const expected = {
 industries:[21,18.5,17.3,14.8,6.2,4.9,4.9,4.9,2.5,2.5,2.5],stages:[13.6,11.1,45.7,25.9,3.7],
 growth:[35.8,28.4,22.2,7.4,6.2],factors:[86.4,69.1,60.5,54.3,27.2,2.5],clusters:[39.5,28.4,27.2,3.7,1.2],
 portfolio:[33.3,25.9,24.7,9.9,6.2],risks:[90.1,74.1,72.8,35.8,27.2],workplace:[61.7,16.1,14.8,4.9,2.5],
 sustainability:[55.6,14.8,13.6,11.1,4.9],advisory:[92.6,88.9,72.8,34.6,11.1],readiness:[66.7,11.1,11.1,7.4,3.7],
};
describe('eleven-photo transcription contract',()=>{
 it('retains all 62 values without normalization or inferred sample sizes',()=>{
  expect(Object.keys(charts)).toEqual(Object.keys(expected));
  for(const key of Object.keys(expected) as (keyof typeof expected)[]) expect(charts[key].items.map(([,value])=>value)).toEqual(expected[key]);
  expect(Object.values(charts).reduce((count,chart)=>count+chart.items.length,0)).toBe(62);
 });
 it('retains easily confused low-frequency labels and the accurate cluster sum',()=>{
  expect(charts.sustainability.items[4]).toEqual(['非优先考虑事项',4.9]);
  expect(charts.advisory.items[4]).toEqual(['极少聘请第三方咨询服务',11.1]);
  expect(charts.readiness.items[2]).toEqual(['未评估',11.1]);
  expect(charts.clusters.items[0][1]+charts.clusters.items[1][1]).toBeCloseTo(67.9);
 });
 it('retains the qualitative frameworks instead of replacing them with brief notes',()=>{
  expect(ecosystem).toHaveLength(6); expect(industryProfiles).toHaveLength(3);
  industryProfiles.forEach(item=>expect(item.drivers).toHaveLength(4));
  expect(assetServices).toHaveLength(7);expect(portfolioReasons).toHaveLength(6);expect(portfolioOffer).toHaveLength(5);
  expect(costLayers.reduce((count,layer)=>count+layer.items.length,0)).toBe(8);
  expect(employeePriorities).toHaveLength(5);expect(workplaceOffer).toHaveLength(6);
  expect(greenBenefits).toHaveLength(5);expect(greenEvidence).toHaveLength(5);
  expect(marketQuestions).toHaveLength(6);expect(reviewAreas).toHaveLength(6);expect(conclusions).toHaveLength(7);
 });
});
