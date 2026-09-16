import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('租赁成交云端草稿闭环', () => {
  it('新增成交提供独立的保存草稿入口，且草稿不走正式提交校验', () => {
    const form = readFileSync(
      'src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx',
      'utf8',
    );

    expect(form).toContain('保存草稿');
    expect(form).toContain('saveLeaseTransactionDraft');
    expect(form).toContain('getValues() as unknown as Record<string, unknown>');
    expect(form).not.toContain('handleSubmit(saveDraft');
  });

  it('打开新增表单会读取并恢复草稿，异步楼宇/行业加载不会再次清空新增表单', () => {
    const form = readFileSync(
      'src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx',
      'utf8',
    );

    expect(form).toContain('getLeaseTransactionDraft(userId)');
    expect(form).toContain('createInitializedRef.current');
    expect(form).toContain('reset({ ...DEFAULTS, ...(record.draft.values as Partial<LeaseTransactionFormData>) });');
    expect(form).toContain("setSubmitMessage('已恢复上次云端草稿')");
  });

  it('正式提交成功后清理云端草稿，避免下一笔误恢复旧数据', () => {
    const form = readFileSync(
      'src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx',
      'utf8',
    );

    expect(form).toContain('await deleteLeaseTransactionDraft(userId)');
    expect(form.indexOf('await deleteLeaseTransactionDraft(userId)')).toBeGreaterThan(
      form.indexOf('if (!result.success || !result.data)'),
    );
    expect(form).toContain("setSubmittedRecord(result.data)");
  });

  it('草稿表使用 auth.uid() 做本人读写隔离', () => {
    const migration = readFileSync(
      'supabase/migrations/20260916053811_create_lease_transaction_drafts.sql',
      'utf8',
    );

    expect(migration).toContain('alter table public.lease_transaction_drafts enable row level security');
    expect(migration).toContain('using ((select auth.uid()) = user_id)');
    expect(migration).toContain('with check ((select auth.uid()) = user_id)');
    expect(migration).toContain('revoke all on table public.lease_transaction_drafts from anon');
  });
});
