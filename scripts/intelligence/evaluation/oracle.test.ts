import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { fixture } from '../../../src/lib/intelligence/query/__tests__/fixtures';
import { buildAggregateResult, buildListResult } from '../../../src/lib/intelligence/query/result';
import { buildResultArtifact } from '../../../src/lib/intelligence/query/artifacts';
import { prepareExportResult } from '../../../src/lib/intelligence/agent/exportTableTool';
import { judge } from './judge.mjs';
import { matchesQuarterlyContract } from './contract';

describe('frozen evaluation oracle and evaluator fault injection', () => {
  const expected = { period: { year: 2026, quarter: 3 }, unit: 'CNY/m2/month', value: 170,
    version: 'synthetic-v1', executionStatus: 'completed', formats: ['xlsx', 'csv_zip'], missingHeight: 'missing' };
  it('checks hand-calculated weighted rent and joint-valid vacancy, independently of product formulas', () => {
    // (100*10000 + 200*30000 + 150*10000) / 50000 = 170;
    // joint valid vacant/area = (1000+6000)/(10000+30000) = 7/40.
    const rent = buildAggregateResult(fixture(), 'rent'), vacancy = buildAggregateResult(fixture(), 'vacancy');
    expect(rent.table.rows[0].cells.value).toMatchObject({ value: { numeric: 170 } });
    expect(vacancy.table.rows[0].cells.value).toMatchObject({ value: { exact: { numerator: '7', denominator: '40' } } });
    const shuffled = { ...fixture(), rows: [...fixture().rows].reverse() };
    expect(buildAggregateResult(shuffled, 'rent').table.rows[0].cells.value).toMatchObject({ kind: 'number', value: { numeric: 170, exact: { numerator: '170', denominator: '1' } } });
  });
  it('checks real workbook values, units, Chinese names and unknown cells without using the result as its own oracle', async () => {
    const raw = buildListResult(fixture(), ['height', 'netEffectiveRent']);
    const base = { ...raw, parameters: { ...raw.parameters, executedPlan: { operation: 'list',
      scope: { inventory: 'tracked' }, fields: ['height', 'netEffectiveRent'], period: { year: 2026, quarter: 3 } } } };
    const result = prepareExportResult([base], { resultIds: [base.resultId], format: 'xlsx' });
    const artifact = await buildResultArtifact(result, { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', resultId: result.resultId, action: 'export', format: 'xlsx' });
    if (artifact.type !== 'download') throw Error('file missing');
    const book = XLSX.read(artifact.bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['数据'], { header: 1 });
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual(['楼宇', '建筑高度 (m)', '净有效租金 (CNY/m2/month)']);
    expect(rows[1]).toEqual(['A座', 210, 100]); expect(rows[2]).toEqual(['B座', 198, 200]);
    expect(rows[3]).toEqual(['C座', '未记录', '未记录']);
    expect(rows[4]).toEqual(['D座', '冲突', 150]);
  });
  it('accepts equivalent governed query paths and rejects changed scope or period', () => {
    const args = { scope: { inventory: 'tracked', submarkets: ['CBD'] }, period: { year: 2026, quarter: 3 }, metric: 'rent' };
    expect(matchesQuarterlyContract('query_quarterly_metrics', args)).toBe(true);
    expect(matchesQuarterlyContract('query_verified_real_estate', { question: '2026Q3 CBD净有效租金' })).toBe(true);
    expect(matchesQuarterlyContract('analyze_market_trends', { scope: args.scope, metric: 'rent', start: args.period, end: args.period })).toBe(true);
    expect(matchesQuarterlyContract('query_quarterly_metrics', { ...args, period: { year: 2026, quarter: 2 } })).toBe(false);
    expect(matchesQuarterlyContract('query_quarterly_metrics', { ...args, scope: { ...args.scope, submarkets: ['金融街'] } })).toBe(false);
  });
  it.each([
    ['wrong quarter', { period: { year: 2026, quarter: 2 } }], ['wrong unit', { unit: 'CNY/m2/day' }],
    ['null becomes zero', { missingHeight: 0 }], ['dropped file', { formats: ['xlsx'] }],
    ['limited becomes completed', { executionStatus: 'limited' }], ['wrong version', { version: 'stale' }],
    ['forbidden sentinel', { extra: 'SYNTHETIC_FORBIDDEN_SENTINEL' }],
  ])('rejects %s rather than inflating coverage', (_label, mutation) => {
    expect(judge(expected, expected).status).toBe('PASS');
    expect(judge({ ...expected, ...mutation }, expected).status).toBe('FAIL');
  });
});
