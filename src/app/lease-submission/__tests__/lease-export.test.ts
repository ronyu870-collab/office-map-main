import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  LEASE_EXPORT_COLUMNS,
  buildLeaseExportRows,
  leaseExportFileName,
} from '../leaseExport';

const EXPECTED_DB_FIELDS = [
  'id',
  'company',
  'suspected_company_fullname',
  'enterprise_type',
  'industry',
  'sub_industry',
  'demand_type',
  'new_building',
  'sub_market',
  'district',
  'building_grade',
  'floor_info',
  'old_address',
  'old_sub_market',
  'old_building_grade',
  'area_sqm',
  'face_rent',
  'lease_term_months',
  'fit_out_months',
  'rent_free_months',
  'effective_rent',
  'transaction_date',
  'transaction_year',
  'transaction_quarter',
  'remarks',
  'data_source',
  'submitter_id',
  'submitter_name',
  'created_at',
  'updated_at',
  'is_face_rent_estimated',
  'is_effective_rent_estimated',
  'relocation_area_change',
  'floor',
  'original_submitter_id',
  'original_submitter_name',
  'old_district',
];

describe('管理员租赁成交全量导出', () => {
  it('覆盖 lease_transactions 全部 37 个字段且导出表头全部中文化', () => {
    const exportKeys = LEASE_EXPORT_COLUMNS.map((column) => column.key);
    expect(exportKeys).toHaveLength(37);
    expect(new Set(exportKeys).size).toBe(37);
    expect([...exportKeys].sort()).toEqual([...EXPECTED_DB_FIELDS].sort());

    for (const column of LEASE_EXPORT_COLUMNS) {
      expect(column.label).not.toMatch(/^[a-z_]+$/i);
    }
  });

  it('按填报业务顺序排列，系统审计字段放在最后', () => {
    const keys = LEASE_EXPORT_COLUMNS.map((column) => column.key);
    expect(keys.slice(0, 6)).toEqual([
      'company',
      'suspected_company_fullname',
      'enterprise_type',
      'industry',
      'sub_industry',
      'demand_type',
    ]);
    expect(keys.indexOf('new_building')).toBeLessThan(keys.indexOf('area_sqm'));
    expect(keys.indexOf('area_sqm')).toBeLessThan(keys.indexOf('transaction_year'));
    expect(keys.slice(-8)).toEqual([
      'data_source',
      'submitter_name',
      'submitter_id',
      'original_submitter_name',
      'original_submitter_id',
      'created_at',
      'updated_at',
      'id',
    ]);
  });

  it('将系统布尔值、数据来源和时间转换成业务可读格式', () => {
    const rows = buildLeaseExportRows([{
      company: '测试企业',
      is_face_rent_estimated: true,
      is_effective_rent_estimated: false,
      data_source: 'broker_submission',
      created_at: '2026-08-26T08:00:00.000Z',
    }]);
    const header = rows[0];
    const row = rows[1];
    const value = (label: string) => row[header.indexOf(label)];

    expect(value('公司名称')).toBe('测试企业');
    expect(value('表面租金是否预估')).toBe('是');
    expect(value('有效租金是否预估')).toBe('否');
    expect(value('数据来源')).toBe('业务员填报');
    expect(value('填报时间')).toBe('2026-08-26 16:00:00');
  });

  it('生成适合归档的 xlsx 文件名', () => {
    expect(leaseExportFileName(new Date('2026-08-26T08:07:09.000Z')))
      .toBe('租赁成交全量数据_20260826_160709.xlsx');
  });

  it('服务端只允许 admin，并分页读取全表，不继承团队页面的日期截断或 500 条上限', () => {
    const route = readFileSync('src/app/api/lease-submission/export/route.ts', 'utf8');
    expect(route).toContain("callerProfile?.role !== 'admin'");
    expect(route).toContain(".from('lease_transactions')");
    expect(route).toContain(".select('*')");
    expect(route).toContain('.range(from, from + PAGE_SIZE - 1)');
    expect(route).not.toContain(".gte('created_at', '2026-04-23");
    expect(route).not.toContain('.limit(500)');
  });

  it('导出按钮只挂在管理员管理区域旁边', () => {
    const table = readFileSync('src/app/lease-submission/components/SubmissionDetailTable.tsx', 'utf8');
    const button = readFileSync('src/app/lease-submission/components/AdminLeaseExportButton.tsx', 'utf8');
    expect(table).toContain('{canManageTeamRecords && <AdminLeaseExportButton />}');
    expect(button).toContain("fetch('/api/lease-submission/export'");
    expect(button).toContain("'导出数据'");
  });
});
