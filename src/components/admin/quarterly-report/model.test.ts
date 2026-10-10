import { describe, expect, it } from 'vitest';
import { buildReport, evaluate, finite, formatRate, gradeOf, latestRows, previousPeriod, type MetricRow, type ReportInput } from './model';

export function submission(overrides: Partial<MetricRow> = {}): MetricRow {
  return { id: 's-1', building_id: 'one', record_year: 2026, record_quarter: 3, created_at: '2026-10-10T01:00:00.123456Z', total_area: 100, net_effective_rent: 100, vacant_area: 10, vacancy_rate: 10, user_id: 'u-1', user_name: '提交人', ...overrides };
}
export function fixture(overrides: Partial<ReportInput> = {}): ReportInput {
  return { period: { year: 2026, quarter: 3 }, capturedAt: '2026-10-10T02:00:00Z', submissions: [submission()],
    previousMetrics: [submission({ id: 1, record_quarter: 2, net_effective_rent: 125, vacant_area: 0, vacancy_rate: 0 })],
    buildings: [{ id: 'one', name: '测试楼宇', grade: 'A', submarket: 'CBD' }], users: [{ user_id: 'u-1', chinese_name: '原始提交人' }], ...overrides };
}

describe('quarterly market reporting rules', () => {
  it('rolls Q1 back to the previous year Q4', () => expect(previousPeriod({ year: 2026, quarter: 1 })).toEqual({ year: 2025, quarter: 4 }));
  it('rejects an invalid quarter', () => expect(() => previousPeriod({ year: 2026, quarter: 5 })).toThrow());
  it('does not turn null, empty, booleans or infinity into zero', () => {
    for (const v of [null, undefined, '', ' ', false, true, Infinity, NaN, 'NaN']) expect(finite(v)).toBeNull();
    expect(finite('0')).toBe(0);
  });
  it('picks the whole latest record across users and never backfills blanks', () => {
    const old = submission({ id: 'a', updated_at: '2026-10-11T00:00:00Z' });
    const newer = submission({ id: 'b', created_at: '2026-10-10T01:00:01Z', user_id: 'u-2', net_effective_rent: null });
    expect(latestRows([old, newer])).toEqual([newer]);
    const report = buildReport(fixture({ submissions: [old, newer] }));
    expect(report.latest[0].source.net_effective_rent).toBeNull();
    expect(report.markets[0].rows[0].current.rent).toBeNull();
    expect(report.raw).toHaveLength(2);
    expect(old.net_effective_rent).toBe(100);
  });
  it('preserves PostgreSQL microsecond ordering', () => {
    const newer = submission({ id: 'a', created_at: '2026-10-10T01:00:00.123457Z' });
    const old = submission({ id: 'z', created_at: '2026-10-10T01:00:00.123456Z' });
    expect(latestRows([newer, old])[0].id).toBe('a');
  });
  it('uses a deterministic ID tie-break regardless of input order or timestamp offset', () => {
    const a = submission({ id: 'a' });
    const z = submission({ id: 'z', created_at: '2026-10-10T09:00:00.123456+08:00' });
    expect(latestRows([a, z])[0].id).toBe('z');
    expect(latestRows([z, a])[0].id).toBe('z');
  });
  it('never deduplicates different building IDs by their names', () => {
    const report = buildReport(fixture({ submissions: [submission(), submission({ id: 's-2', building_id: 'two' })],
      buildings: [{ id: 'one', name: '同名大厦', grade: 'A', submarket: 'CBD' }, { id: 'two', name: '同名大厦', grade: 'A', submarket: 'CBD' }] }));
    expect(report.latest).toHaveLength(2);
  });
  it('deduplicates within a building AND quarter', () => expect(latestRows([submission(), submission({ id: 's-2', record_quarter: 2 })])).toHaveLength(2));
  it('fails closed when the latest timestamp cannot be determined', () => expect(() => latestRows([submission({ created_at: '' })])).toThrow(/提交时间/));
  it('combines A and P, never BP, and retains the agreed category order', () => {
    expect(gradeOf('P')).toBe('A'); expect(gradeOf('BP')).toBe('BP');
    const input = fixture({ submissions: [submission(), submission({ id: 's-2', building_id: 'two' }), submission({ id: 's-3', building_id: 'three' })],
      buildings: [{ id: 'one', name: '甲', grade: 'A', submarket: 'CBD' }, { id: 'two', name: '超甲', grade: 'P', submarket: 'CBD' }, { id: 'three', name: '园区', grade: 'BP', submarket: '上地' }] });
    const report = buildReport(input);
    expect(report.markets.map(g => g.label)).toEqual(['甲级写字楼', '乙级写字楼', '产业园']);
    expect(report.markets[0].rows[0].current.count).toBe(2);
    expect(report.markets[2].rows[0].current.count).toBe(1);
  });
  it('compares 60 currently submitted buildings against ALL 100 historical buildings', () => {
    const buildings = Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, name: `楼${i}`, grade: 'A', submarket: 'CBD' }));
    const report = buildReport(fixture({ buildings, submissions: buildings.slice(0, 60).map((b, i) => submission({ id: `s${i}`, building_id: b.id, net_effective_rent: 240, vacant_area: 17, vacancy_rate: 17 })),
      previousMetrics: buildings.map((b, i) => submission({ id: i + 1, building_id: b.id, record_quarter: 2, net_effective_rent: i < 60 ? 200 : 325, vacant_area: 15, vacancy_rate: 0.15 })) }));
    const market = report.markets[0].rows[0];
    expect(market.current.count).toBe(60); expect(market.previous.count).toBe(100);
    expect(market.previous.rent).toBe(250); expect(market.current.rent).toBe(240);
    expect(market.rentChange).toBeCloseTo(-0.04); expect(market.vacancyChange).toBeCloseTo(0.02);
    expect(report.latest).toHaveLength(60); // No 40-row carry-forward.
    expect(report.latest[0].previousValues.rent).toBe(200); // Individual comparison still uses the SAME building.
  });
  it('uses area weights and recalculates category totals from buildings, not an average of submarkets', () => {
    const report = buildReport(fixture({ submissions: [submission({ total_area: 100, net_effective_rent: 100, vacant_area: 10 }), submission({ id: 's-2', building_id: 'two', total_area: 300, net_effective_rent: 200, vacant_area: 90, vacancy_rate: 30 })],
      buildings: [{ id: 'one', name: '小楼', grade: 'A', submarket: 'CBD' }, { id: 'two', name: '大楼', grade: 'A', submarket: '金融街' }] }));
    expect(report.markets[0].rows[0].current.rent).toBe(175);
    expect(report.markets[0].rows[0].current.vacancy).toBe(0.25);
  });
  it('uses separate valid denominators for rent and vacancy, with genuine zero vacancy retained', () => {
    const report = buildReport(fixture({ submissions: [submission({ net_effective_rent: null, vacant_area: 0, vacancy_rate: 0 }), submission({ id: 's-2', building_id: 'two', total_area: 300, net_effective_rent: 200, vacant_area: null })],
      buildings: [{ id: 'one', name: '一', grade: 'A', submarket: 'CBD' }, { id: 'two', name: '二', grade: 'A', submarket: 'CBD' }] }));
    const stats = report.markets[0].rows[0].current;
    expect(stats.rent).toBe(200); expect(stats.vacancy).toBe(0);
    expect(stats.count).toBe(2); expect(stats.rentCount).toBe(1); expect(stats.vacancyCount).toBe(1);
  });
  it('excludes impossible vacancy and invalid area instead of clamping or filling zero', () => {
    expect(evaluate(submission({ vacant_area: 101 })).vacancy).toBeNull();
    expect(evaluate(submission({ vacant_area: -1 })).vacancy).toBeNull();
    expect(evaluate(submission({ total_area: 0 })).rent).toBeNull();
  });
  it('keeps the submitted vacancy rate but diagnoses inconsistencies and uses areas for analytics', () => {
    const report = buildReport(fixture({ submissions: [submission({ vacancy_rate: 55 })] }));
    expect(report.latest[0].source.vacancy_rate).toBe(55);
    expect(report.latest[0].values.vacancy).toBe(0.1);
    expect(report.latest[0].checks).toContain('填报空置率与面积不一致');
  });
  it('does not borrow an older quarter when the immediately previous quarter is absent', () => {
    const report = buildReport(fixture({ previousMetrics: [submission({ record_quarter: 1 })] }));
    expect(report.latest[0].previous).toBeUndefined(); expect(report.markets[0].rows[0].rentChange).toBeNull();
  });
  it('retains previous-only submarkets with blank current indicators, not a -100% change', () => {
    const report = buildReport(fixture({ submissions: [] }));
    const market = report.markets[0].rows.find(r => r.name === 'CBD')!;
    expect(market.current.count).toBe(0); expect(market.current.rent).toBeNull(); expect(market.rentChange).toBeNull();
  });
  it('does not include other quarters in the raw export or baseline', () => {
    const report = buildReport(fixture({ submissions: [submission(), submission({ id: 's2', record_quarter: 4 })] }));
    expect(report.raw).toHaveLength(1);
  });
  it('formats vacancy movement in percentage points, not relative percent change', () => {
    expect(formatRate(0.02, true, true)).toBe('+2.0');
    expect(formatRate(-0.04, true)).toBe('-4.0%');
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0)).toBe('0.0%');
  });
});


describe('source-specific historical vacancy units', () => {
  it('accepts the historical ratio without treating a sub-1% submission as a ratio', () => {
    const current = submission({ vacant_area: 0.5, vacancy_rate: 0.5 });
    const previous = submission({ id: 'p', record_quarter: 2, vacant_area: 0.5, vacancy_rate: 0.005 });
    const report = buildReport(fixture({ submissions: [current], previousMetrics: [previous] }));
    expect(report.latest[0].checks).toEqual([]);
    expect(report.latest[0].previousValues.issues).toEqual([]);
    expect(report.previousIssueCount).toBe(0);
    expect(report.markets[0].rows[0].current.vacancy).toBe(0.005);
    expect(report.markets[0].rows[0].previous.vacancy).toBe(0.005);
    expect(evaluate(current, 'ratio').issues).toContain('填报空置率与面积不一致');
  });
});
