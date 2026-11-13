import { expect, it } from 'vitest';
import { createHistoryWorkbook } from './exportWorkbook';

it('round-trips the Excel file with exact numeric values, zero, text, range, and widths', async () => {
  const { XLSX, book } = await createHistoryWorkbook([
    { company: '=示范企业', record_source: 'live', area_sqm: 123.45, face_rent: 0, effective_rent: 123.456789 },
    { company: '归档示范', record_source: 'history', effective_rent: null },
  ], '同名企业 · 2024–2026 · 共 2 笔');
  const file = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const parsed = XLSX.read(file, { type: 'buffer', cellStyles: true });
  const sheet = parsed.Sheets['筛选成交'];
  expect(sheet.A2).toMatchObject({ t: 's', v: '=示范企业' });
  expect(sheet.A2.f).toBeUndefined();
  expect(sheet.M2.v).toBe(123.45);
  expect(sheet.N2.v).toBe(0);
  expect(sheet.O2.v).toBe(123.456789);
  expect(sheet.O3).toBeUndefined();
  expect(sheet['!autofilter']?.ref).toBe('A1:S3');
  expect(sheet['!cols']?.[0].width).toBeGreaterThan(30);
  expect(parsed.Sheets['导出范围'].B1.v).toBe('同名企业 · 2024–2026 · 共 2 笔');
  expect(parsed.Sheets['导出范围'].B2.v).toBe(2);
});
