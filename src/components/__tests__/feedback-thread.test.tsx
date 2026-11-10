import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackPanel } from '../FeedbackPanel';
import IssueManager from '../admin/IssueManager';

const fixture = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), reply: vi.fn(), adminReply: vi.fn(), log: vi.fn() }));
vi.mock('@/src/services/feedbackThread', async importOriginal => ({ ...await importOriginal<object>(), openFeedbackThread: fixture.open }));
vi.mock('@/src/services/feedbackApi', () => ({ getMyFeedback: fixture.list, addFeedbackComment: fixture.reply, createFeedback: vi.fn(), reopenFeedback: vi.fn(), uploadFeedbackImage: vi.fn() }));
vi.mock('@/src/services/feedbackAdminApi', () => ({ getAdminFeedbackIssues: fixture.list, adminReplyToFeedback: fixture.adminReply, createAdminFeedback: vi.fn(), deleteAdminFeedback: vi.fn(), updateAdminFeedbackPriority: vi.fn(), updateAdminFeedbackStatus: vi.fn() }));
vi.mock('@/src/services/adminApi', () => ({ uploadIssueImage: vi.fn() }));
vi.mock('@/src/utils/audit', () => ({ logAction: fixture.log }));

const at = '2026-11-01T04:00:00Z';
const receipt = '2026-11-02T04:00:00Z';
const issue = { id: 'one', title: '隔离反馈', description: '隔离描述', source: 'user_feedback', created_by: 'viewer@example.test', category: 'bug', module: 'general', status: 'open', priority: 'medium', images: [], created_at: at, last_read_at: null, last_activity_at: at, last_admin_activity_at: at, last_user_activity_at: at, has_unread_admin_activity: true, has_unread_user_activity: true };
const comment = { id: 'c1', issue_id: issue.id, content: '已保存的沟通记录', images: [], created_by: issue.created_by, is_admin: false, created_at: receipt, kind: 'comment', metadata: {} };

beforeEach(() => {
  vi.resetAllMocks();
  fixture.list.mockResolvedValue([issue]);
  fixture.open.mockResolvedValue({ comments: [], readAt: receipt });
});
afterEach(cleanup);

describe('反馈写入回执与沟通记录回读', () => {
  it('retries user reply readback without sending the committed reply again', async () => {
    fixture.open.mockResolvedValueOnce({ comments: [], readAt: receipt }).mockRejectedValueOnce(new Error('隔离回读失败')).mockResolvedValueOnce({ comments: [comment], readAt: receipt });
    render(<FeedbackPanel userId="user" userEmail={issue.created_by} userName="隔离用户" />);
    await screen.findByLabelText('1 条新动态');
    fireEvent.click(screen.getByRole('button', { name: /问题与建议/ }));
    fireEvent.click(await screen.findByRole('button', { name: /隔离反馈/ }));
    await screen.findByText('管理员暂未回复');
    const input = screen.getByPlaceholderText('补充说明或回复管理员…');
    fireEvent.change(input, { target: { value: '补充文本' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('隔离回读失败');
    expect(screen.queryByText(/补充说明发送失败/)).not.toBeInTheDocument();
    expect(input).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '重试沟通记录' }));
    expect(await screen.findByText(comment.content)).toBeVisible();
    expect(fixture.reply).toHaveBeenCalledExactlyOnceWith(issue.id, '补充文本', [], issue.created_by);
    expect(fixture.log).toHaveBeenCalledWith(issue.created_by, 'FEEDBACK_USER_REPLIED', { issue_id: issue.id, has_images: false });
  });

  it('keeps the administrator reply and status audit while reading back through the same thread', async () => {
    fixture.open.mockResolvedValueOnce({ comments: [], readAt: receipt }).mockResolvedValueOnce({ comments: [{ ...comment, is_admin: true }], readAt: receipt });
    fixture.list.mockResolvedValueOnce([issue]).mockResolvedValue([{ ...issue, status: 'in_progress' }]);
    render(<IssueManager adminEmail="admin@example.test" />);
    fireEvent.click(await screen.findByRole('button', { name: /隔离反馈/ }));
    await screen.findByText('暂无沟通记录');
    fireEvent.change(screen.getByPlaceholderText('输入回复，例如：问题已经定位，正在处理。'), { target: { value: '管理员回复' } });
    fireEvent.click(screen.getByRole('button', { name: '回复并开始处理' }));
    expect(await screen.findByText(comment.content)).toBeVisible();
    expect(within(screen.getByRole('main')).getByLabelText('状态')).toHaveValue('in_progress');
    expect(fixture.adminReply).toHaveBeenCalledExactlyOnceWith({ issueId: issue.id, content: '管理员回复', images: [], nextStatus: 'in_progress' });
    expect(fixture.log).toHaveBeenCalledWith('admin@example.test', 'FEEDBACK_STATUS_CHANGED', { issue_id: issue.id, old_status: 'open', new_status: 'in_progress' });
  });
});
