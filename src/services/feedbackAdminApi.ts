import { supabase } from '@/src/services/supabaseClient';

export type AdminFeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'wontfix' | 'duplicate';
export type AdminFeedbackPriority = 'high' | 'medium' | 'low';
export type AdminFeedbackCategory = 'bug' | 'feature' | 'data' | 'other';
export type AdminFeedbackCommentKind = 'comment' | 'status_change' | 'system';

export interface AdminFeedbackIssue {
  id: string;
  title: string;
  description: string;
  status: AdminFeedbackStatus;
  priority: AdminFeedbackPriority;
  category: AdminFeedbackCategory;
  module: string;
  images: string[];
  created_at: string;
  created_by: string;
  resolved_at: string | null;
  resolved_by: string | null;
  reopened_at: string | null;
  source: 'admin' | 'user_feedback';
  context: Record<string, unknown>;
  last_activity_at: string | null;
  last_admin_activity_at: string | null;
  last_user_activity_at: string | null;
  last_read_at: string | null;
  has_unread_user_activity: boolean;
}

export interface AdminFeedbackComment {
  id: string;
  issue_id: string;
  content: string;
  images: string[];
  created_by: string;
  is_admin: boolean;
  created_at: string;
  kind: AdminFeedbackCommentKind;
  metadata: Record<string, unknown>;
}

const ISSUE_SELECT = [
  'id', 'title', 'description', 'status', 'priority', 'category', 'module', 'images',
  'created_at', 'created_by', 'resolved_at', 'resolved_by', 'reopened_at', 'source', 'context',
  'last_activity_at', 'last_admin_activity_at', 'last_user_activity_at',
].join(',');

function isLater(value: string | null, baseline: string | null): boolean {
  if (!value) return false;
  if (!baseline) return true;
  return new Date(value).getTime() > new Date(baseline).getTime();
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) throw new Error('当前登录状态无效');
  return data.user.id;
}

export async function getAdminFeedbackIssues(): Promise<AdminFeedbackIssue[]> {
  const userId = await currentUserId();
  const [{ data: issues, error: issueError }, { data: reads, error: readError }] = await Promise.all([
    supabase
      .from('admin_issues')
      .select(ISSUE_SELECT)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('admin_issue_reads')
      .select('issue_id,last_read_at')
      .eq('user_id', userId),
  ]);

  if (issueError) throw new Error(`获取需求反馈失败：${issueError.message}`);
  if (readError) throw new Error(`获取已读状态失败：${readError.message}`);

  const readMap = new Map((reads ?? []).map((row) => [row.issue_id as string, row.last_read_at as string]));
  return ((issues ?? []) as unknown as Omit<AdminFeedbackIssue, 'last_read_at' | 'has_unread_user_activity'>[]).map((issue) => {
    const lastReadAt = readMap.get(issue.id) ?? null;
    return {
      ...issue,
      last_read_at: lastReadAt,
      has_unread_user_activity: issue.source === 'user_feedback' && isLater(issue.last_user_activity_at, lastReadAt),
    };
  });
}

export async function adminReplyToFeedback(params: {
  issueId: string;
  content: string;
  images?: string[];
  nextStatus?: AdminFeedbackStatus | null;
}): Promise<void> {
  const { error } = await supabase.rpc('feedback_admin_reply', {
    p_issue_id: params.issueId,
    p_content: params.content.trim(),
    p_images: params.images ?? [],
    p_next_status: params.nextStatus ?? null,
  });
  if (error) throw new Error(`回复反馈失败：${error.message}`);
}

export async function updateAdminFeedbackStatus(issueId: string, status: AdminFeedbackStatus): Promise<void> {
  const { error } = await supabase.from('admin_issues').update({ status }).eq('id', issueId);
  if (error) throw new Error(`更新状态失败：${error.message}`);
}

export async function updateAdminFeedbackPriority(issueId: string, priority: AdminFeedbackPriority): Promise<void> {
  const { error } = await supabase.from('admin_issues').update({ priority }).eq('id', issueId);
  if (error) throw new Error(`更新优先级失败：${error.message}`);
}

export async function createAdminFeedback(input: {
  title: string;
  description: string;
  priority: AdminFeedbackPriority;
  category: AdminFeedbackCategory;
  module: string;
  createdBy: string;
}): Promise<void> {
  const { error } = await supabase.from('admin_issues').insert({
    title: input.title.trim(),
    description: input.description.trim(),
    priority: input.priority,
    category: input.category,
    module: input.module,
    images: [],
    created_by: input.createdBy,
    source: 'admin',
    status: 'open',
  });
  if (error) throw new Error(`创建问题失败：${error.message}`);
}

export async function deleteAdminFeedback(issueId: string): Promise<void> {
  const { error } = await supabase.from('admin_issues').delete().eq('id', issueId);
  if (error) throw new Error(`删除问题失败：${error.message}`);
}
