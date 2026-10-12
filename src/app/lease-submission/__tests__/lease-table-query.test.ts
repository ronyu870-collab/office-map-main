import { describe, expect, it } from 'vitest';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { formatLeaseRent } from '@/src/utils/formatLeaseRent';
import { LEASE_TABLE_FIELDS, leaseFilterOptions, leasePeriod, queryLeaseTable, type LeaseColumnKey } from '../leaseTableQuery';
import { buildLeaseExportRows, LEASE_EXPORT_COLUMNS } from '../leaseExport';

const record = (id: string, fields: Partial<LeaseTransaction> = {}): LeaseTransaction => ({
  id, company: '企业' + id, new_building: '楼宇', transaction_year: 2026, transaction_quarter: 'Q1',
  submitter_id: 'u1', submitter_name: '顾问甲', ...fields,
});

describe('成交汇总查询', () => {
  it('compares numeric areas across the entire dataset before pagination without mutating input', () => {
    const rows = Array.from({ length: 40 }, (_, i) => record(String(i), { area_sqm: i === 39 ? 10000 : i }));
    const before = structuredClone(rows);
    const result = queryLeaseTable(rows, { area: { min: '20', max: '10000' } }, { key: 'area', direction: 'desc' });
    expect(result[0].id).toBe('39');
    expect(result.at(-1)?.area_sqm).toBe(20);
    expect(result).toHaveLength(20);
    expect(rows).toEqual(before);
  });

  it('uses OR within a column and AND across columns, including keyword and exact-value filters', () => {
    const rows = [record('1', { company: 'Alpha Finance', industry: '金融', area_sqm: 500 }), record('2', { company: 'Alpha Tech', industry: '互联网', area_sqm: 800 }), record('3', { company: 'Beta', industry: '金融', area_sqm: 800 })];
    expect(queryLeaseTable(rows, { company: { search: ' ALPHA ' }, industry: { values: ['金融', '互联网'] }, area: { min: '500', max: '800' } }, null).map((row) => row.id)).toEqual(['1', '2']);
    expect(queryLeaseTable(rows, { industry: { values: [] } }, null)).toEqual([]);
  });

  it('sorts and filters periods across years, accepting historical full quarter labels', () => {
    const rows = [record('old', { transaction_year: 2025, transaction_quarter: 'Q4' }), record('new', { transaction_year: 2026, transaction_quarter: 'Q1' }), record('history', { transaction_year: 0, transaction_quarter: '2024Q3' })];
    expect(queryLeaseTable(rows, {}, { key: 'quarter', direction: 'desc' }).map((row) => row.id)).toEqual(['new', 'old', 'history']);
    expect(queryLeaseTable(rows, { quarter: { min: '2025Q4', max: '2026Q1' } }, null).map((row) => row.id)).toEqual(['old', 'new']);
    expect(leasePeriod(record('bad', { transaction_year: 0, transaction_quarter: 'Q1' }))).toBeNull();
  });

  it('always places nulls last, retains stable ties and includes zero in numeric ranges', () => {
    const rows = [record('empty', { area_sqm: null }), record('b', { area_sqm: 10 }), record('a', { area_sqm: 10 }), record('zero', { area_sqm: 0 })];
    for (const direction of ['asc', 'desc'] as const) {
      const sorted = queryLeaseTable(rows, {}, { key: 'area', direction });
      expect(sorted.at(-1)?.id).toBe('empty');
      expect(sorted.filter((row) => row.area_sqm === 10).map((row) => row.id)).toEqual(['b', 'a']);
    }
    expect(queryLeaseTable(rows, { area: { min: '0', max: '0' } }, null).map((row) => row.id)).toEqual(['zero']);
    expect(queryLeaseTable(rows, { area: { values: [''] } }, null).map((row) => row.id)).toEqual(['empty']);
  });

  it('filters every business column using the values offered by its picker', () => {
    const row = record('full', { suspected_company_fullname: '完整企业', enterprise_type: '民企', industry: '金融', demand_type: '新租', sub_market: 'CBD', district: '朝阳区', building_grade: '甲级', area_sqm: 100, face_rent: 121.6666666667, effective_rent: 100.375 });
    for (const key of Object.keys(LEASE_TABLE_FIELDS) as LeaseColumnKey[]) {
      const options = leaseFilterOptions([row], key);
      expect(options).toHaveLength(1);
      expect(queryLeaseTable([row], { [key]: { values: [options[0].value] } }, { key, direction: 'asc' })).toEqual([row]);
      expect(queryLeaseTable([row], { [key]: { values: ['missing'] } }, null)).toEqual([]);
    }
  });

  it('filters submitters by ID and preserves departed records and duplicate names', () => {
    const rows = [record('1'), record('2', { submitter_id: 'u2', submitter_name: '顾问甲' }), record('left', { submitter_id: 'u3', submitter_name: '离职顾问', submitter_active: false })];
    expect(leaseFilterOptions(rows, 'submitter').map((option) => option.value)).toEqual(['u1', 'u2', 'u3']);
    expect(queryLeaseTable(rows, { submitter: { values: ['u2'] } }, null).map((row) => row.id)).toEqual(['2']);
    expect(queryLeaseTable(rows, { submitter: { values: ['u3'] } }, null).map((row) => row.id)).toEqual(['left']);
    expect(queryLeaseTable(rows, {}, null)).toHaveLength(3);
  });

  it('keeps every submitter selectable when account activity could not be verified', () => {
    const rows = [record('1', { submitter_active: false }), record('2', { submitter_id: 'u2', submitter_name: '顾问乙', submitter_active: false })];
    const options = leaseFilterOptions(rows, 'submitter');
    expect(options.map((option) => option.value)).toEqual(['u1', 'u2']);
    for (const option of options) expect(queryLeaseTable(rows, { submitter: { values: [option.value] } }, null)).toHaveLength(1);
  });
});

describe('租金显示精度', () => {
  it.each([[121.667, '121.7'], [100.375, '100.4'], [106.762, '106.8'], [330, '330.0'], [0, '0.0'], [null, '—'], [undefined, '—']])('formats %s as %s', (value, expected) => {
    expect(formatLeaseRent(value)).toBe(expected);
  });
  it('retains original values and distinguishes rents that display identically when sorting', () => {
    const rows = [record('higher', { effective_rent: 100.375 }), record('lower', { effective_rent: 100.374 })];
    expect(formatLeaseRent(rows[0].effective_rent)).toBe(formatLeaseRent(rows[1].effective_rent));
    expect(queryLeaseTable(rows, {}, { key: 'effectiveRent', direction: 'asc' }).map((row) => row.id)).toEqual(['lower', 'higher']);
    expect(queryLeaseTable(rows, { effectiveRent: { min: '100.375' } }, null)).toHaveLength(1);
    expect(rows[0].effective_rent).toBe(100.375);
  });
  it('does not mutate frozen daily-to-monthly values through display, query or numeric export', () => {
    const rawMonthlyRent = 4 * 365 / 12;
    const rows = [Object.freeze(record('higher', { face_rent: rawMonthlyRent, effective_rent: 100.375 })), Object.freeze(record('lower', { face_rent: rawMonthlyRent, effective_rent: 100.374 }))];
    Object.freeze(rows);
    expect(formatLeaseRent(rows[0].face_rent)).toBe('121.7');
    expect(queryLeaseTable(rows, {}, { key: 'effectiveRent', direction: 'asc' }).map((row) => row.id)).toEqual(['lower', 'higher']);
    expect(queryLeaseTable(rows, { effectiveRent: { min: '100.375' } }, null).map((row) => row.id)).toEqual(['higher']);
    const exported = buildLeaseExportRows(rows.map((row) => ({ ...row })));
    const faceIndex = LEASE_EXPORT_COLUMNS.findIndex((column) => column.key === 'face_rent');
    const effectiveIndex = LEASE_EXPORT_COLUMNS.findIndex((column) => column.key === 'effective_rent');
    expect(exported[1][faceIndex]).toBe(rawMonthlyRent);
    expect(exported[1][effectiveIndex]).toBe(100.375);
    expect(typeof exported[1][faceIndex]).toBe('number');
    expect(rows[0].face_rent).toBe(rawMonthlyRent);
    expect(rows[0].effective_rent).toBe(100.375);
  });
});
