import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, calls: [] as string[], fail: '' }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: {
  from(table: string) {
    mock.calls.push(`from:${table}`);
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const q = {
      select(_columns: string) { return q; },
      eq(key: string, value: unknown) { mock.calls.push(`${table}:eq:${key}:${value}`); filters.push(r => r[key] === value); return q; },
      lte(key: string, value: string) { mock.calls.push(`${table}:lte:${key}`); filters.push(r => Date.parse(String(r[key])) <= Date.parse(value)); return q; },
      order(key: string, _options?: unknown) { mock.calls.push(`${table}:order:${key}`); return q; },
      async range(from: number, to: number) {
        mock.calls.push(`${table}:range:${from}`);
        if (mock.fail === table) return { data: null, error: { message: 'synthetic read failure' } };
        const rows = (mock.tables[table] ?? []).filter(r => filters.every(f => f(r)));
        return { data: rows.slice(from, Math.min(to + 1, from + 73)), error: null }; // Server cap smaller than the requested page.
      },
    };
    return q;
  },
} }));
import { loadReport } from './data';

beforeEach(() => { mock.tables = {}; mock.calls = []; mock.fail = ''; });
describe('quarterly report reads', () => {
  it('reads all pages beyond 1000 rows and uses the immediate previous metrics quarter without person filters', async () => {
    mock.tables.buildings = Array.from({ length: 1101 }, (_, i) => ({ id: `b${i}`, name: `测试${i}`, grade: 'A', submarket: 'CBD' }));
    mock.tables.quarterly_submissions = mock.tables.buildings.map((b, i) => ({ id: `s${i}`, building_id: b.id, record_year: 2026, record_quarter: 1, created_at: '2026-01-01T00:00:00Z', total_area: 100, net_effective_rent: 100, vacant_area: 10 }));
    mock.tables.building_metrics = mock.tables.buildings.map((b, i) => ({ id: i + 1, building_id: b.id, record_year: 2025, record_quarter: 4, created_at: '2025-12-31T00:00:00Z', total_area: 100, net_effective_rent: 125, vacant_area: 10 }));
    const report = await loadReport({ year: 2026, quarter: 1 });
    expect(report.raw).toHaveLength(1101); expect(report.latest).toHaveLength(1101);
    expect(report.markets[0].rows[0].previous.count).toBe(1101);
    expect(mock.calls).toContain('building_metrics:eq:record_year:2025');
    expect(mock.calls).toContain('building_metrics:eq:record_quarter:4');
    expect(mock.calls).toContain('quarterly_submissions:range:73');
    expect(mock.calls.some(c => /eq:(user_id|is_active|tracking_scope|building_id)/.test(c))).toBe(false);
    expect(mock.calls).toContain('quarterly_submissions:lte:created_at');
    expect(mock.calls.some(c => c.includes('update_drafts'))).toBe(false);
  });
  it('propagates a baseline read failure rather than exporting fabricated blank or zero history', async () => {
    mock.fail = 'building_metrics';
    await expect(loadReport({ year: 2026, quarter: 3 })).rejects.toThrow('synthetic read failure');
  });
});
