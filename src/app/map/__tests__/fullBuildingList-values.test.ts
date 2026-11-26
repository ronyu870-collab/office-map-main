import { expect, it } from 'vitest';
import { finiteMetric } from '../model/fullBuildingList';
it('keeps whitespace unknown while preserving genuine numeric zero',()=>{
  expect(finiteMetric('  ')).toBeNull();expect(finiteMetric('\t')).toBeNull();
  expect(finiteMetric('0')).toBe(0);expect(finiteMetric(0)).toBe(0);
});
