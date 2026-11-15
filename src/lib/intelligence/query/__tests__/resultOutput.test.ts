import { describe, expect, it } from 'vitest';
import { attachResearchAnalysis } from '../researchAnalysis';
import { buildAggregateResult, buildCompareResult, buildListResult, buildTrendResult, resultDigest } from '../result';
import { resultViewSchema } from '../presentation';
import { buildResultArtifact, artifactInputSchema } from '../artifacts';
import { artifactContentDisposition, buildArtifactFilename, parseArtifactFilename } from '../artifactFilename';
import { renderResultCopy } from '../resultOutput';
import { basePeriod, fixture } from './fixtures';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const current = () => ({ ...fixture(), queryScope: { inventory: 'tracked' as const, submarkets: ['CBD'] } });
describe('P2 snapshot-bound research outputs', () => {
  it('T08 copies original units, period, sample count and denominator without a new query', async () => {
    const result = buildAggregateResult(current(), 'rent'), digest = resultDigest(result);
    const output = await buildResultArtifact(result, { requestId, resultId: result.resultId, action: 'copy', format: 'conclusion' });
    expect(output.type).toBe('copy'); if (output.type !== 'copy') throw new Error();
    expect(output.text).toContain('CBD · 净有效租金'); expect(output.text).toContain('2026Q3');
    expect(output.text).toContain('170 元/㎡/月'); expect(output.text).toContain('有效 3 栋');
    expect(output.text).toContain('50,000 ㎡'); expect(output.text).toContain(result.resultId);
    expect(output.text).toContain('数据库记录存在不等于原始资料已核验');
    expect(output.resultDigest).toBe(digest); expect(resultDigest(result)).toBe(digest);
  });
  it('T08 retains both comparison periods and the original percentage-point unit', () => {
    const result = resultViewSchema.parse(buildCompareResult(fixture(basePeriod), current(), 'vacancy', 'paired'));
    const text = renderResultCopy(result, 'figures');
    expect(text).toContain('2026Q2与2026Q3'); expect(text).toContain('百分点');
    expect(text).toContain('12.5'); expect(text).toContain('17.5'); expect(text).toContain('配对楼宇');
  });
  it('T14 preserves unknown numbers and distinguishes empty tables', () => {
    const list = resultViewSchema.parse(buildListResult(current(), ['height']));
    const text = renderResultCopy(list, 'figures');
    expect(text).toContain('C座\t未知：缺少数据'); expect(text).toContain('D座\t未知：来源冲突');
    const empty = resultViewSchema.parse(buildListResult({ ...current(), rows: [], expectedCount: 0 }, ['height']));
    expect(renderResultCopy(empty, 'figures')).toContain('没有符合条件的记录');
  });
  it('T17 composes P1 findings, samples and anomalies from the same immutable result', () => {
    const snapshots = [fixture(basePeriod), current()];
    const result = attachResearchAnalysis(buildTrendResult(snapshots, 'rent', 'per_period'), snapshots), digest = resultDigest(result);
    const view = resultViewSchema.parse(result), text = renderResultCopy(view, 'summary');
    expect(text).toContain('2026Q2至2026Q3'); expect(text).toContain('有效样本与统计口径');
    expect(text).toContain('原始资料已核验'); expect(text).toContain('核心发现与趋势');
    expect(text).toContain('各期独立有效样本'); expect(text).toContain('末期 2026Q3 参与 3 栋');
    expect(text).toContain('异常关注'); expect(text).not.toMatch(/经济放缓|预计下季度|需求下降导致/);
    expect(resultDigest(result)).toBe(digest);
  });
  it('retains complete numeric filtering conditions in copied conclusions', () => {
    const original = resultViewSchema.parse(buildAggregateResult(current(), 'rent'));
    const result = { ...original, parameters: { ...original.parameters, executedPlan: { filter: {
      operator: 'or', terms: [{ field: 'height', operator: 'gte', value: '200' }, { field: 'netEffectiveRent', operator: 'lt', value: '150' }],
    } } } };
    expect(renderResultCopy(result, 'conclusion')).toContain('建筑高度 ≥ 200 米 或 净有效租金 < 150 元/㎡/月');
  });
  it('T15 bounds key figures and accurately discloses omitted rows', () => {
    const original = resultViewSchema.parse(buildListResult(current(), ['height']));
    const result = { ...original, table: { ...original.table, rows: Array.from({ length: 60 }, (_, i) => ({ ...original.table.rows[0], entityId: String(i) })) } };
    const text = renderResultCopy(result, 'figures');
    expect(text.match(/A座\t210/g)).toHaveLength(20); expect(text).toContain('前 20 行，共 60 行');
  });
  it('T09 names exports for actual object, metric and historical period and decodes UTF-8 safely', () => {
    const result = resultViewSchema.parse(buildAggregateResult(current(), 'rent'));
    const filename = buildArtifactFilename(result, 'xlsx'), header = artifactContentDisposition(filename);
    expect(filename).toContain('CBD_净有效租金_2026Q3'); expect(parseArtifactFilename(header)).toBe(filename);
    expect(new Response(null, { headers: { 'Content-Disposition': header } }).headers.get('content-disposition')).toBe(header);
    expect(parseArtifactFilename('attachment; filename="query-legacy.zip"')).toBe('query-legacy.zip');
    for (const value of ['attachment; filename="../private.xlsx"', 'attachment; filename="safe.zip"; filename*=UTF-8\'\'%2Fetc%2Fpasswd.zip',
      'attachment; filename="safe.zip"; filename*=UTF-8\'\'%0D%0AX.zip', 'attachment; filename="safe.zip"; filename*=UTF-8\'\'%E0%80',
      'attachment; filename="safe.zip"; filename*=UTF-8\'\'safe.exe']) expect(parseArtifactFilename(value)).toBeNull();
  });
  it('refuses client text injection and copy of another result', async () => {
    const result = buildAggregateResult(current(), 'rent');
    const input = { requestId, resultId: result.resultId, action: 'copy' as const, format: 'summary' as const };
    expect(artifactInputSchema.safeParse({ ...input, text: 'invented market fact' }).success).toBe(false);
    await expect(buildResultArtifact(result, { ...input, resultId: crypto.randomUUID() })).rejects.toThrow('ARTIFACT_RESULT_MISMATCH');
  });
});
