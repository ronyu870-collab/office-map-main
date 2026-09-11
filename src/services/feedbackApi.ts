import { supabase } from '@/src/services/supabaseClient';
import { compressImage } from '@/src/utils/image';

export type FeedbackCategory = 'bug' | 'feature' | 'data' | 'other';
export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'wontfix' | 'duplicate';

export type UserFeedbackIssue = {
  id: string;
  title: string;
  description: string;
  status: FeedbackStatus;
  priority: 'high' | 'medium' | 'low';
  category: FeedbackCategory;
  module: string;
  images: string[];
  created_at: string;
  created_by: string;
  resolved_at: string | null;
  resolved_by: string;
  reopened_at: string | null;
  source: 'user_feedback';
  context: Record<string, unknown>;
};

export type UserFeedbackComment = {
  id: string;
  issue_id: string;
  content: string;
  images: string[];
  created_by: string;
  is_admin: boolean;
  created_at: string;
};

export type CreateFeedbackInput = {
  title: string;
  description: string;
  category: FeedbackCategory;
  module: string;
  images: string[];
  userEmail: string;
  context: Record<string, unknown>;
};

export async function getMyFeedback(userEmail: string): Promise<UserFeedbackIssue[]> {
  const { data, error } = await supabase
    .from('admin_issues')
    .select('id,title,description,status,priority,category,module,images,created_at,created_by,resolved_at,resolved_by,reopened_at,source,context')
    .eq('source', 'user_feedback')
    .eq('created_by', userEmail)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`获取反馈失败：${error.message}`);
  return (data ?? []) as UserFeedbackIssue[];
}

export async function createFeedback(input: CreateFeedbackInput): Promise<UserFeedbackIssue> {
  const { data, error } = await supabase
    .from('admin_issues')
    .insert({
      title: input.title,
      description: input.description,
      category: input.category,
      module: input.module,
      images: input.images,
      priority: 'medium',
      source: 'user_feedback',
      context: input.context,
      created_by: input.userEmail,
    })
    .select('id,title,description,status,priority,category,module,images,created_at,created_by,resolved_at,resolved_by,reopened_at,source,context')
    .single();

  if (error) throw new Error(`提交反馈失败：${error.message}`);
  return data as UserFeedbackIssue;
}

export async function getFeedbackComments(issueId: string): Promise<UserFeedbackComment[]> {
  const { data, error } = await supabase
    .from('admin_issue_comments')
    .select('id,issue_id,content,images,created_by,is_admin,created_at')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`获取反馈回复失败：${error.message}`);
  return (data ?? []) as UserFeedbackComment[];
}

export async function addFeedbackComment(
  issueId: string,
  content: string,
  userEmail: string,
): Promise<UserFeedbackComment> {
  const { data, error } = await supabase
    .from('admin_issue_comments')
    .insert({
      issue_id: issueId,
      content,
      images: [],
      created_by: userEmail,
      is_admin: false,
    })
    .select('id,issue_id,content,images,created_by,is_admin,created_at')
    .single();

  if (error) throw new Error(`发送补充说明失败：${error.message}`);
  return data as UserFeedbackComment;
}

export async function uploadFeedbackImage(file: File, userId: string): Promise<string> {
  const compressed = await compressImage(file);
  const ext = compressed.type === 'image/jpeg'
    ? 'jpg'
    : (file.name.split('.').pop()?.toLowerCase() || 'png');
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'png';
  const path = `feedback/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;

  const { error } = await supabase.storage.from('issue-images').upload(path, compressed, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(`截图上传失败：${error.message}`);

  const { data } = supabase.storage.from('issue-images').getPublicUrl(path);
  return data.publicUrl;
}
