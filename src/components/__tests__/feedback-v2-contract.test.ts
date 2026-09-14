import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('Feedback V2 closed-loop contract', () => {
  it('keeps unread tracking and timeline fields in the database migration', () => {
    const migration = source('supabase/migrations/20260914110000_feedback_v2_closed_loop.sql');
    expect(migration).toContain('admin_issue_reads');
    expect(migration).toContain('last_admin_activity_at');
    expect(migration).toContain('last_user_activity_at');
    expect(migration).toContain("kind in ('comment', 'status_change', 'system')");
    expect(migration).toContain('feedback_admin_reply');
    expect(migration).toContain('feedback_reopen');
    expect(migration).toContain('feedback_mark_read');
  });

  it('shows user unread feedback and allows resolved feedback to reopen', () => {
    const panel = source('src/components/FeedbackPanel.tsx');
    expect(panel).toContain('has_unread_admin_activity');
    expect(panel).toContain('问题仍未解决');
    expect(panel).toContain('reopenFeedback');
    expect(panel).toContain("setTab(unreadCount > 0 ? 'mine' : 'submit')");
    expect(panel).toContain('沟通记录');
  });

  it('gives admins reply-and-transition actions and unread user activity', () => {
    const manager = source('src/components/admin/IssueManager.tsx');
    expect(manager).toContain('has_unread_user_activity');
    expect(manager).toContain('回复并开始处理');
    expect(manager).toContain('回复并标记已解决');
    expect(manager).toContain('FEEDBACK_ADMIN_REPLIED');
    expect(manager).toContain('FEEDBACK_STATUS_CHANGED');
  });

  it('keeps admin reply plus status transition atomic behind one RPC', () => {
    const service = source('src/services/feedbackAdminApi.ts');
    expect(service).toContain("supabase.rpc('feedback_admin_reply'");
    expect(service).toContain('p_next_status');
  });
});
