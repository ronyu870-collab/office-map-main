import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { LEASE_EXPORT_COLUMNS, buildLeaseExportRows } from '../leaseExport';

describe('租赁成交期间一致性', () => {
  it('个人记录和重复提示都拆分成交年份与成交季度', () => {
    const page = readFileSync('src/app/lease-submission/page.tsx', 'utf8');
    const form = readFileSync(
      'src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx',
      'utf8',
    );

    expect(page).toContain("'成交年份','成交季度'");
    expect(page).toContain("{item.transaction_year || '-'}");
    expect(page).toContain("{item.transaction_quarter || '-'}");
    expect(form).toContain("'成交年份','成交季度','提交时间'");
    expect(form).toContain("{item.transaction_year || '-'}");
    expect(form).toContain('<dt className="text-slate-400">成交年份</dt>');
    expect(form).toContain('<dt className="text-slate-400">成交季度</dt>');
  });

  it('疑似重复检测按成交年份与成交季度共同限定', () => {
    const service = readFileSync('src/services/leaseTransactionSubmitService.ts', 'utf8');
    const form = readFileSync(
      'src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx',
      'utf8',
    );

    expect(service).toContain('transaction_year, transaction_quarter');
    expect(service).toContain('.eq("transaction_year", year)');
    expect(service).toContain('transaction_year: row.transaction_year ?? year ?? 0');
    expect(service).not.toContain('transaction_year: 0,');
    expect(form).toContain('data.transaction_year,');
  });

  it('导出仍然把成交年份紧邻放在成交季度之前', () => {
    const keys = LEASE_EXPORT_COLUMNS.map((column) => column.key);
    const yearIndex = keys.indexOf('transaction_year');
    const quarterIndex = keys.indexOf('transaction_quarter');

    expect(yearIndex).toBeGreaterThanOrEqual(0);
    expect(quarterIndex).toBe(yearIndex + 1);

    const rows = buildLeaseExportRows([
      { transaction_year: 2026, transaction_quarter: 'Q3' },
    ]);
    const header = rows[0];
    const row = rows[1];

    expect(row[header.indexOf('成交年份')]).toBe(2026);
    expect(row[header.indexOf('成交季度')]).toBe('Q3');
  });
});
