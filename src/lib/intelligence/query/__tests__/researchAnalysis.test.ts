import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { attachResearchAnalysis, RESEARCH_ANALYSIS_LIMITS } from '../researchAnalysis';
import { researchAnalysisSchema, resolveResearchSources } from '../researchAnalysisView';
import { buildAggregateResult, buildCompareResult, buildGroupedResult, buildTrendResult, resultDigest } from '../result';
import { buildCsvPackage, buildXlsx } from '../exports';
import { buildResultChart } from '../charts';
import { resultViewSchema } from '../presentation';
import { resolveNumericFact } from '../facts';
import type { FactSnapshot, Quarter } from '../contracts';
import { fixture, nameSource, source } from './fixtures';
import { researchCapacityFixture } from './researchCapacityFixture';

const q = (quarter: number, year = 2026): Quarter => ({ year, quarter });
function snapshot(period: Quarter, rents: (number | string | null)[], areas = rents.map(() => 100), vacancies = rents.map(() => 10)): FactSnapshot {
  return { snapshotId: `research-${period.year}-${period.quarter}`, dataVersion: 'research-synthetic-v1', scopeFingerprint: 'research-scope',
    period, expectedCount: rents.length, complete: true, queryScope: { inventory: 'tracked', submarkets: ['CBD'], inventoryTime: 'current_catalog' },
    rows: rents.map((rent, i) => {
      const id = String.fromCharCode(65 + i), name = `${id}座`;
      return { id, name, nameSource: nameSource(id, name), facts: {
        totalArea: resolveNumericFact('totalArea', id, [source(id, 'totalArea', areas[i], period, String(period.year))], period),
        netEffectiveRent: resolveNumericFact('netEffectiveRent', id, [source(id, 'netEffectiveRent', rent, period, String(period.year))], period),
        vacantArea: resolveNumericFact('vacantArea', id, [source(id, 'vacantArea', vacancies[i], period, String(period.year))], period),
      } };
    }),
  };
}
const analysis = (result: ReturnType<typeof attachResearchAnalysis>) => researchAnalysisSchema.parse(result.parameters.researchAnalysis);
function trend(snapshots: FactSnapshot[], metric: 'rent' | 'vacancy' | 'totalArea' = 'rent', mode: 'per_period' | 'paired' = 'per_period') {
  return attachResearchAnalysis(buildTrendResult(snapshots, metric, mode), snapshots);
}

describe('deterministic research analysis from the original authorized snapshot', () => {
  it('T03 calculates exact endpoints, absolute/relative changes and consecutive movements', () => {
    const ss = [snapshot(q(4, 2025), [100]), snapshot(q(1), [110]), snapshot(q(2), [99]), snapshot(q(3), [120])];
    const result = trend(ss), research = analysis(result), series = research.series[0];
    expect(series.overall).toMatchObject({ base: q(4, 2025), current: q(3), difference: { numeric: 20 }, change: { numeric: 20 }, changeUnit: 'percent' });
    expect(series.quarterOnQuarter.at(-1)?.change?.exact).toEqual({ numerator: '700', denominator: '33' });
    expect(series.direction).toBe('fluctuating');
    expect(research.findings.find(item => item.kind === 'trend')?.text).toContain('2025-Q4 为 100');
    expect(research.findings.map(item => item.text).join('')).not.toMatch(/需求下降|经济放缓|新增供应导致/);
  });

  it('T03 reports percentage points for vacancy including a valid zero base', () => {
    const ss = [snapshot(q(2), [100], [100], [0]), snapshot(q(3), [100], [100], [15])];
    const series = analysis(trend(ss, 'vacancy')).series[0];
    expect(series.overall).toMatchObject({ baseValue: { numeric: 0 }, currentValue: { numeric: .15 }, difference: { numeric: 15 }, change: { numeric: 15 }, differenceUnit: 'percentage_point', changeUnit: 'percentage_point', unavailableReason: null });
    expect(series.anomalies.find(item => item.rule === 'entity_qoq_vacancy_10_pp')).toMatchObject({ change: { numeric: 15 }, threshold: { numeric: 10 }, changeUnit: 'percentage_point' });
    expect(analysis(trend(ss, 'vacancy')).findings[0].text).toContain('15 个百分点');
  });

  it('only computes year-on-year when both exact quarters are in the snapshot', () => {
    const ss = [snapshot(q(3, 2025), [100]), snapshot(q(4, 2025), [105]), snapshot(q(1), [110]), snapshot(q(2), [115]), snapshot(q(3), [120])];
    const series = analysis(trend(ss)).series[0];
    expect(series.yearOnYear).toHaveLength(1);
    expect(series.yearOnYear[0]).toMatchObject({ base: q(3, 2025), current: q(3), change: { numeric: 20 } });
    expect(series.direction).toBe('increasing');
    expect(analysis(trend(ss.slice(1))).series[0].yearOnYear).toEqual([]);
  });

  it('T10 retains missing periods and does not infer a continuous trend or fill missing values', () => {
    const ss = [snapshot(q(1), [100]), snapshot(q(2), [null]), snapshot(q(3), [120])];
    const series = analysis(trend(ss)).series[0];
    expect(series.periods.map(period => period.value?.numeric ?? null)).toEqual([100, null, 120]);
    expect(series.direction).toBe('incomplete');
    expect(series.quarterOnQuarter.every(change => change.change === null)).toBe(true);
    expect(series.commonEntityIds).toEqual([]);
    expect(series.commonSample.every(period => period.value === null)).toBe(true);
    const empty = analysis(trend([snapshot(q(2), [null]), snapshot(q(3), [null])])).series[0];
    expect(empty.overall?.change).toBeNull();
    expect(empty.overall?.unavailableReason).toBe('no_valid_sample');
    expect(empty.anomalies).toEqual([]);
  });

  it('T06 presents each-period and common-sample changes with actual membership and area differences', () => {
    const ss = [snapshot(q(2), [100, 200, null], [10, 30, 20]), snapshot(q(3), [110, null, 300], [10, 30, 20])];
    const result = attachResearchAnalysis(buildCompareResult(ss[0], ss[1], 'rent', 'per_period'), ss);
    const series = analysis(result).series[0], comparison = series.comparability[0];
    expect(comparison).toMatchObject({ baseCount: 2, currentCount: 2, commonCount: 1, enteredEntityIds: ['C'], exitedEntityIds: ['B'], baseDenominator: { numeric: 40 }, currentDenominator: { numeric: 30 }, denominatorDifference: { numeric: -10 } });
    expect(comparison.perPeriod.change?.exact).toEqual({ numerator: '740', denominator: '21' });
    expect(comparison.commonSample).toMatchObject({ baseValue: { numeric: 100 }, currentValue: { numeric: 110 }, change: { numeric: 10 } });
    expect(series.perPeriod[0]).toMatchObject({ value: { numeric: 175 }, simpleMean: { numeric: 150 } });
    const text = analysis(result).findings.map(item => item.text).join('');
    expect(text).toContain('均值变化不能直接解释为市场真实变化');
    expect(text).toContain('不代表楼宇实际新增或退市');
  });

  it('T06 uses the intersection of ALL periods for the alternate common-sample series', () => {
    const ss = [snapshot(q(1), [null, 200, 300, 400]), snapshot(q(2), [100, null, 300, 410]), snapshot(q(3), [100, 200, null, 420])];
    const series = analysis(trend(ss, 'rent', 'paired')).series[0];
    expect(series.commonEntityIds).toEqual(['D']);
    expect(series.periods.map(period => period.value?.numeric)).toEqual([400, 410, 420]);
    expect(series.commonSample.map(period => period.usedEntityIds)).toEqual([['D'], ['D'], ['D']]);
    expect(series.perPeriod.map(period => period.usedCount)).toEqual([3, 3, 3]);
  });

  it('T07 identifies the same building’s 180 to 80 rent change with exact rule evidence', () => {
    const ss = [snapshot(q(2), [180]), snapshot(q(3), [80])];
    const result = trend(ss), series = analysis(result).series[0];
    expect(series.anomalies).toHaveLength(1);
    expect(series.anomalies[0]).toMatchObject({ rule: 'entity_qoq_rent_30_percent', entityId: 'A', basePeriod: q(2), period: q(3), baseValue: { numeric: 180 }, value: { numeric: 80 }, change: { exact: { numerator: '-500', denominator: '9' } }, threshold: { numeric: 30 } });
    expect(analysis(result).findings.find(item => item.id.endsWith('/anomalies'))?.text).toContain('提醒不代表数据错误');
    expect(result.table.rows[1].cells.value).toMatchObject({ kind: 'number', value: { numeric: 80 } });
  });

  it('preserves the original query and states that extra analysis was not completed when its workload is too large', () => {
    const s = snapshot(q(3), Array(RESEARCH_ANALYSIS_LIMITS.observations + 1).fill(100));
    const original = buildAggregateResult(s, 'rent'), digest = resultDigest(original);
    const result = attachResearchAnalysis(original, [s]), research = analysis(result);
    expect(result.table).toBe(original.table);
    expect(result.sources).toBe(original.sources);
    expect(resultDigest(original)).toBe(digest);
    expect(research.series).toEqual([]);
    expect(research.resourceUsage).toMatchObject({ status: 'skipped', observationCount: 5001, reason: 'observation_limit' });
    expect(research.findings[0].text).toContain('未完成');
    expect(research.findings[0].text).toContain('不能据此判断不存在异常');
    expect(result.limitations.at(-1)).toBe(research.findings[0].text);
  });

  it('detects all adjacent-quarter anomalies while bounding listed records and disclosing omissions', () => {
    const ss = [snapshot(q(2), Array(130).fill(100)), snapshot(q(3), Array(130).fill(200))];
    const research = analysis(trend(ss)), series = research.series[0];
    expect(series.overall?.currentValue?.numeric).toBe(200);
    expect(series.anomalies).toHaveLength(RESEARCH_ANALYSIS_LIMITS.anomalies);
    expect(series.anomalyCoverage).toEqual({ complete: false, detected: 130, returned: 100,
      omitted: 30, iqrDetected: 0, quarterOnQuarterDetected: 130 });
    expect(research.resourceUsage?.status).toBe('limited');
    expect(research.findings.find(item => item.id.endsWith('/anomalies'))?.text).toContain('另有 30 条未列举');
  });

  it('bounds IQR evidence growth without deleting observations or implying complete anomaly details', () => {
    const s = snapshot(q(3), [...Array(800).fill(100), ...Array(200).fill(1000)]);
    const original = buildAggregateResult(s, 'rent'), research = analysis(attachResearchAnalysis(original, [s])), series = research.series[0];
    expect(series.periods[0].value?.numeric).toBe(280);
    expect(series.periods[0].usedCount).toBe(1000);
    expect(series.anomalyCoverage).toEqual({ complete: false, detected: 200, returned: 2,
      omitted: 198, iqrDetected: 200, quarterOnQuarterDetected: 0 });
    expect(series.anomalies.reduce((total, alert) => total + alert.sourceIds.length, 0)).toBeLessThanOrEqual(RESEARCH_ANALYSIS_LIMITS.anomalySourceReferences);
    expect(series.anomalies.every(alert => alert.sourceIds.length === 2001)).toBe(true);
    expect(research.findings.find(item => item.id.endsWith('/anomalies'))?.text).toContain('本次已完成检测');
  });

  it.each([74, 300, 600])('keeps %i real-format buildings × four quarters usable with bounded, resolvable evidence', count => {
    const { snapshots, original } = researchCapacityFixture(count);
    const result = attachResearchAnalysis(original, snapshots), research = analysis(result);
    expect(original.sources.every(source => source.id.length >= 116)).toBe(true);
    expect(research.resourceUsage?.status).toBe('complete');
    expect(research.series).toHaveLength(3); expect(result.table).toBe(original.table);
    expect(new TextEncoder().encode(JSON.stringify(research)).byteLength).toBeLessThan(RESEARCH_ANALYSIS_LIMITS.outputBytes);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(RESEARCH_ANALYSIS_LIMITS.combinedResultBytes);
    for (const series of research.series) {
      expect(series.periods).toHaveLength(4); expect(series.overall?.difference?.numeric).toBe(15);
      const known = new Set(result.sources.map(source => source.id));
      for (const entry of [...series.periods, series.overall!, ...series.quarterOnQuarter, ...series.comparability.flatMap(item => [item.perPeriod, item.commonSample])]) {
        expect(entry.sourceRefs?.length).toBeGreaterThan(0);
        const ids = resolveResearchSources(series, entry);
        expect(ids.length).toBeGreaterThan(0); expect(ids.every(id => known.has(id))).toBe(true);
      }
      const finding = research.findings.find(item => item.id === `${series.key}/trend`)!;
      expect(series.classificationSourceIds?.length).toBeGreaterThan(0);
      expect(series.classificationSourceIds?.every(id => finding.sourceIds.includes(id))).toBe(true);
    }
  });

  it('preserves a near-limit original archive when the combined research output would exceed the safe archive budget', () => {
    const s = snapshot(q(3), [100]), base = buildAggregateResult(s, 'rent');
    const original = { ...base, parameters: { ...base.parameters, syntheticArchivePadding: 'x'.repeat(RESEARCH_ANALYSIS_LIMITS.combinedResultBytes) } };
    const result = attachResearchAnalysis(original, [s]);
    expect(result.table).toBe(original.table); expect(result.sources).toBe(original.sources);
    expect(analysis(result).resourceUsage).toMatchObject({ status: 'skipped', reason: 'output_limit' });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(16 * 1024 * 1024);
  });

  it('applies the documented 30% boundary without using rounded display numbers', () => {
    const below = analysis(trend([snapshot(q(2), [100]), snapshot(q(3), ['129.999999999999999999'])])).series[0];
    expect(below.anomalies).toEqual([]);
    const exact = analysis(trend([snapshot(q(2), [100]), snapshot(q(3), [130])])).series[0];
    expect(exact.anomalies[0]).toMatchObject({ rule: 'entity_qoq_rent_30_percent', change: { numeric: 30 } });
  });

  it('does not mislabel non-adjacent observations as quarter-on-quarter anomalies', () => {
    const ss = [snapshot(q(1), [180]), snapshot(q(3), [80])];
    const result = attachResearchAnalysis(buildCompareResult(ss[0], ss[1], 'rent', 'per_period'), ss);
    const series = analysis(result).series[0];
    expect(series.quarterOnQuarter).toEqual([]);
    expect(series.anomalies).toEqual([]);
    expect(series.direction).toBe('incomplete');
  });

  it('T07 reuses Type 7 IQR and keeps the flagged observation in official weighted calculations', () => {
    const s = snapshot(q(3), [1, 2, 3, 100]);
    const result = attachResearchAnalysis(buildAggregateResult(s, 'rent'), [s]), series = analysis(result).series[0];
    expect(series.anomalies).toHaveLength(1);
    expect(series.anomalies[0]).toMatchObject({ rule: 'iqr_1_5', entityId: 'D', sampleCount: 4, lowerFence: { numeric: -36.5 }, upperFence: { numeric: 65.5 } });
    expect(series.periods[0]).toMatchObject({ usedCount: 4, value: { numeric: 26.5 } });
    expect(series.anomalies[0].sourceIds).toContain('name/D');
    const small = snapshot(q(3), [1, 2, 100]);
    expect(analysis(attachResearchAnalysis(buildAggregateResult(small, 'rent'), [small])).series[0].anomalies).toEqual([]);
  });

  it('preserves missing, invalid and conflicting coverage separately', () => {
    const ss = [fixture(q(2)), fixture(q(3))];
    const series = analysis(trend(ss, 'vacancy')).series[0];
    expect(series.periods[1].coverage).toMatchObject({ total: 4, valid: 2, missing: 1, invalid: 1, conflict: 0 });
    expect(analysis(trend(ss, 'vacancy')).findings.find(item => item.id.endsWith('/coverage'))?.text).toContain('缺失 1、无效 1');
  });

  it('T08 analyzes each market separately and preserves empty and unknown groups', () => {
    const ss = [snapshot(q(2), [100, 180, null]), snapshot(q(3), [110, 80, 120])].map(s => ({ ...s,
      queryScope: { ...s.queryScope, submarkets: ['CBD', '金融街', '丽泽'] }, rows: s.rows.map((row, i) => {
        const value = ['CBD', '金融街', null][i];
        return { ...row, dimensions: { submarket: { value, source: { ...row.nameSource, id: `market/${row.id}`, field: 'submarket', rawValue: value } } } };
      }),
    }));
    const result = attachResearchAnalysis(buildGroupedResult(ss, ss, 'submarket', 'rent', 'per_period'), ss);
    const research = analysis(result);
    expect(research.series.find(series => series.label === 'CBD')?.overall?.change?.numeric).toBe(10);
    expect(research.series.find(series => series.label === '金融街')?.anomalies[0]).toMatchObject({ rule: 'entity_qoq_rent_30_percent', entityId: 'B' });
    const forged = ss.map(s => ({ ...s, rows: s.rows.map(row => row.id === 'A' ? { ...row, dimensions: {
      submarket: { value: '金融街', source: { ...row.dimensions.submarket.source, rawValue: '金融街' } },
    } } : row) }));
    expect(() => attachResearchAnalysis(result, forged)).toThrow('RESEARCH_SOURCE_BINDING_MISMATCH');
    expect(research.series.find(series => series.label === '丽泽')?.periods.every(period => period.value === null)).toBe(true);
    expect(research.series.some(series => series.label.includes('未知'))).toBe(true);
  });

  it('T09 refuses different versions/scopes and any evidence without archived source bindings', () => {
    const ss = [snapshot(q(2), [100]), snapshot(q(3), [110])], result = buildTrendResult(ss, 'rent', 'per_period');
    expect(() => attachResearchAnalysis(result, [{ ...ss[0], dataVersion: 'different' }, ss[1]])).toThrow('RESEARCH_SNAPSHOT_MISMATCH');
    expect(() => attachResearchAnalysis(result, [{ ...ss[0], scopeFingerprint: 'other-account' }, ss[1]])).toThrow('RESEARCH_SNAPSHOT_MISMATCH');
    expect(() => attachResearchAnalysis({ ...result, sources: [] }, ss)).toThrow('RESEARCH_SOURCE_BINDING_MISMATCH');
    expect(() => attachResearchAnalysis(result, [ss[0], ss[0]])).toThrow('RESEARCH_DUPLICATE_PERIOD');
    // Same ID/version labels cannot substitute different values behind a source reference.
    expect(() => attachResearchAnalysis(result, [ss[0], snapshot(q(3), [999])])).toThrow('RESEARCH_SOURCE_BINDING_MISMATCH');
  });

  it('T09 retains immutable originals and carries calculations into CSV/XLSX manifests without changing charts', async () => {
    const ss = [snapshot(q(2), [180]), snapshot(q(3), [80])], original = buildTrendResult(ss, 'rent', 'per_period');
    const digest = resultDigest(original), result = attachResearchAnalysis(original, ss);
    expect(resultDigest(original)).toBe(digest);
    expect(result.table).toEqual(original.table);
    expect(result.analysis).toEqual(original.analysis);
    expect(Object.isFrozen(result.parameters.researchAnalysis)).toBe(true);
    const manifest = JSON.parse(buildCsvPackage(result).manifest);
    expect(manifest.parameters.researchAnalysis).toEqual(result.parameters.researchAnalysis);
    expect(manifest.sources).toEqual(result.sources);
    const workbook = XLSX.read(await buildXlsx(result), { type: 'array' });
    const metadata = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['口径与快照'], { header: 1 });
    const parameters = metadata.find(row => row[0] === 'parameters');
    expect(JSON.parse(String(parameters?.[1])).researchAnalysis.version).toBe('research-analysis/1');
    expect(buildResultChart(resultViewSchema.parse(result), { kind: 'time_series' }).points.map(point => point.y)).toEqual([180, 80]);
    const sourceIds = new Set(result.sources.map(source => source.id));
    expect(analysis(result).findings.every(item => item.sourceIds.every(id => sourceIds.has(id)))).toBe(true);
  });
});

it('does not report a sustained decline from only a single quarter-on-quarter change', () => {
  const research = analysis(trend([snapshot(q(1), [211.5912619372]), snapshot(q(2), [205.324590694378])]));
  expect(research.findings[0].text).toContain('205.32');
  expect(research.findings[0].text).not.toContain('逐季连续下降');
  expect(analysis(trend([snapshot(q(1), [220]), snapshot(q(2), [210]), snapshot(q(3), [200])])).findings[0].text).toContain('逐季连续下降');
});
