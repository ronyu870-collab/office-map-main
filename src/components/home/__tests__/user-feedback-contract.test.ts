import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(path, 'utf8');
}

describe('user feedback portal contract', () => {
  it('keeps the feedback entry lightweight, separate from team communication, and hidden for admins', () => {
    const home = read('src/components/home/HomeWorkspace.tsx');
    const launcher = read('src/components/home/UserFeedbackLauncher.tsx');

    expect(home).toContain("import { UserFeedbackLauncher }");
    expect(home).toContain("activeRole !== 'admin'");
    expect(home).toContain('<UserFeedbackLauncher');
    expect(launcher).toContain("dynamic(");
    expect(launcher).toContain("UserFeedbackDialog");
    expect(launcher).toContain('问题与建议');
    expect(launcher).toContain('反馈 Bug、数据问题或功能需求');
  });

  it('supports structured feedback, screenshots, personal history, status, and follow-up discussion', () => {
    const dialog = read('src/components/home/UserFeedbackDialog.tsx');
    const service = read('src/services/feedbackApi.ts');

    expect(dialog).toContain("{ value: 'bug'");
    expect(dialog).toContain("{ value: 'feature'");
    expect(dialog).toContain("{ value: 'data'");
    expect(dialog).toContain('最多 3 张');
    expect(dialog).toContain('我的反馈');
    expect(dialog).toContain('处理沟通');
    expect(dialog).toContain("'SUBMIT_FEEDBACK'");
    expect(service).toContain(".eq('source', 'user_feedback')");
    expect(service).toContain(".eq('created_by', userEmail)");
    expect(service).toContain("priority: 'medium'");
    expect(service).toContain('feedback/${userId}/');
  });

  it('enforces owner-scoped issue/comment access and owner-scoped screenshot upload paths in RLS', () => {
    const migration = read('supabase/migrations/20260911123000_add_user_feedback_portal.sql');

    expect(migration).toContain('users read own feedback issues');
    expect(migration).toContain("source = 'user_feedback'");
    expect(migration).toContain("created_by = (select auth.jwt() ->> 'email')");
    expect(migration).toContain('users comment on own feedback');
    expect(migration).toContain('is_admin = false');
    expect(migration).toContain('users upload own feedback images');
    expect(migration).toContain("(storage.foldername(name))[1] = 'feedback'");
    expect(migration).toContain('(storage.foldername(name))[2] = (select auth.uid())::text');
  });
});
