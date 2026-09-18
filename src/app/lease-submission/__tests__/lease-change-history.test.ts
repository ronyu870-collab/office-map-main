import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildLeaseTransactionChanges } from '../leaseTransactionChangeHistory';

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('lease transaction change history', () => {
  it('builds a compact business-field diff and ignores unchanged values', () => {
    const changes = buildLeaseTransactionChanges(
      {
        company: '测试企业',
        new_building: '环球金融中心',
        area_sqm: 500,
        face_rent: 350,
        transaction_year: 2026,
        transaction_quarter: 'Q3',
      },
      {
        company: '测试企业',
        new_building: '环球金融中心',
        area_sqm: 571,
        face_rent: 360,
        transaction_year: 2026,
        transaction_quarter: 'Q3',
      },
    );

    expect(changes.map((change) => change.key)).toEqual(['area_sqm', 'face_rent']);
    expect(changes[0]?.beforeText).toBe('500 ㎡');
    expect(changes[0]?.afterText).toBe('571 ㎡');
    expect(changes[1]?.beforeText).toBe('350 元/㎡/月');
    expect(changes[1]?.afterText).toBe('360 元/㎡/月');
  });

  it('requires an explicit edit confirmation and optimistic-lock timestamp', () => {
    const form = source('src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx');
    const service = source('src/services/leaseTransactionSubmitService.ts');

    expect(form).toContain('确认更新成交记录');
    expect(form).toContain('buildLeaseTransactionChanges(initialData, payload)');
    expect(form).toContain('initialData.updated_at');
    expect(service).toContain('expectedUpdatedAt?: string');
    expect(service).toContain('.eq("updated_at", expectedUpdatedAt)');
    expect(service).toContain('避免覆盖最新数据');
  });

  it('keeps transaction history controls behind the admin management boundary', () => {
    const table = source('src/app/lease-submission/components/SubmissionDetailTable.tsx');
    const drawer = source('src/app/lease-submission/components/LeaseTransactionHistoryDrawer.tsx');

    expect(table).toContain('canManageTeamRecords && (');
    expect(table).toContain('变更记录');
    expect(table).toContain('<LeaseTransactionHistoryDrawer');
    expect(drawer).toContain('仅管理员可见');
    expect(drawer).toContain(".eq('action_type', 'LEASE_TRANSACTION_UPDATE')");
    expect(drawer).toContain(".eq('target_table', 'lease_transactions')");
  });

  it('records committed updates in Postgres with before/after snapshots and a target index', () => {
    const migration = source('supabase/migrations/20260918123000_add_lease_transaction_change_history.sql');

    expect(migration).toContain('create or replace function private.audit_lease_transaction_update()');
    expect(migration).toContain("'LEASE_TRANSACTION_UPDATE'");
    expect(migration).toContain('old_values');
    expect(migration).toContain('new_values');
    expect(migration).toContain('lease_transactions_audit_update');
    expect(migration).toContain('audit_logs_target_record_occurred_idx');
    expect(migration).toContain('or (select private.is_admin())');
  });
});
