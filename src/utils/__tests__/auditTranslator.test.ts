import { describe, expect, it } from 'vitest';

import { getLogBadgeStyle, parseAuditLog } from '@/src/utils/auditTranslator';

describe('audit translator business semantics', () => {
  it('renders research-library preview/download with the accessed file name', () => {
    expect(parseAuditLog('OSS_FILE_ACCESS', {
      display_name: '2026Q3 北京写字楼市场报告.pdf',
      access_method: 'download',
    })).toBe('下载了研究资料：「2026Q3 北京写字楼市场报告.pdf」');
    expect(parseAuditLog('OSS_FILE_ACCESS', {
      display_name: '2026Q3 北京写字楼市场报告.pdf',
      access_method: 'preview',
    })).toBe('预览了研究资料：「2026Q3 北京写字楼市场报告.pdf」');
  });

  it('renders page/module names and print-dialog reports as business language', () => {
    expect(parseAuditLog('PAGE_VIEW', { page: '/compare' })).toBe('浏览了「楼宇对比」页面');
    expect(parseAuditLog('ENTER_MODULE', { module: 'map' })).toBe('进入了「楼宇地图」');
    expect(parseAuditLog('EXPORT_REPORT', {
      report_name: '客户候选方案 · ACME',
      export_method: 'browser_print_pdf',
    })).toContain('发起打印 / 导出报告');
  });

  it('renders standardized data exports with business label, count and filename', () => {
    const text = parseAuditLog('EXPORT_DATA', {
      table_label: '季度填报数据',
      record_count: 12,
      file_name: '季度填报数据_2026Q3.xlsx',
    });
    expect(text).toContain('季度填报数据');
    expect(text).toContain('12 条');
    expect(text).toContain('季度填报数据_2026Q3.xlsx');
  });

  it('renders backup and lease exports as first-class audit events', () => {
    expect(parseAuditLog('EXPORT_BACKUP', {
      table_count: 20,
      file_name: 'colliers-backup.zip',
    })).toContain('20 张表');
    expect(parseAuditLog('EXPORT_LEASE_TRANSACTIONS', {
      record_count: 112,
      file_name: '租赁成交.xlsx',
    })).toContain('112 条');
  });

  it('does not fall back to generic badges for new high-value audit actions', () => {
    for (const action of ['ACCESS_DENIED', 'OSS_FILE_ACCESS', 'EXPORT_BACKUP', 'AI_REQUIREMENT_PARSE', 'FEEDBACK_STATUS_CHANGED']) {
      expect(getLogBadgeStyle(action).label).not.toBe('系统操作');
    }
  });
});
