import { supabase } from '@/src/services/supabaseClient';

export type FeedbackCategory = 'bug' | 'feature' | 'data' | 'other';
export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'wontfix' | 'duplicate';

export interface FeedbackIssue {
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
  resolved_by: string | null;
  reopened_at: string | null;
  source: 'admin' | 'user_feedback';
  context: Record<string, unknown>;
}

export interface FeedbackComment {
  id: string;
  issue_id: string;
  content: string;
  images: string[];
  created_by: string;
  is_admin: boolean;
  created_at: string;
}

export interface CreateFeedbackInput {
  title: string;
  description: string;
  category: FeedbackCategory;
  module: string;
  images: string[];
  createdBy: string;
  context: Record<string, unknown>;
}

const ISSUE_SELECT = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'category',
  'module',
  'images',
  'created_at',
  'created_by',
  'resolved_at',
  'resolved_by',
  'reopened_at',
  'source',
  'context',
].join(',');

export async function getMyFeedback(userEmail: string): Promise<FeedbackIssue[]> {
  const { data, error } = await supabase
    .from('admin_issues')
    .select(ISSUE_SELECT)
    .eq('source', 'user_feedback')
    .eq('created_by', userEmail)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`获取反馈失败：${error.message}`);
  return (data ?? []) as FeedbackIssue[];
}

export async function createFeedback(input: CreateFeedbackInput): Promise<FeedbackIssue> {
  const { data, error } = await supabase
    .from('admin_issues')
    .insert({
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category,
      module: input.module,
      images: input.images,
      priority: 'medium',
      status: 'open',
      created_by: input.createdBy,
      source: 'user_feedback',
      context: input.context,
    })
    .select(ISSUE_SELECT)
    .single();

  if (error) throw new Error(`提交反馈失败：${error.message}`);
  return data as FeedbackIssue;
}

export async function getFeedbackComments(issueId: string): Promise<FeedbackComment[]> {
  const { data, error } = await supabase
    .from('admin_issue_comments')
    .select('id,issue_id,content,images,created_by,is_admin,created_at')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`获取反馈回复失败：${error.message}`);
  return (data ?? []) as FeedbackComment[];
}

export async function addFeedbackComment(
  issueId: string,
  content: string,
  images: string[],
  createdBy: string,
): Promise<FeedbackComment> {
  const { data, error } = await supabase
    .from('admin_issue_comments')
    .insert({
      issue_id: issueId,
      content: content.trim(),
      images,
      created_by: createdBy,
      is_admin: false,
    })
    .select('id,issue_id,content,images,created_by,is_admin,created_at')
    .single();

  if (error) throw new Error(`补充反馈失败：${error.message}`);
  return data as FeedbackComment;
}

async function compressImage(file: File, maxDim = 1600, quality = 0.8): Promise<File> {
  if (file.size < 500 * 1024) return file;

  return new Promise((resolve) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = image;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(file);
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    image.src = objectUrl;
  });
}

export async function uploadFeedbackImage(file: File, userId: string): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('仅支持上传图片');
  if (file.size > 8 * 1024 * 1024) throw new Error('单张图片不能超过 8MB');

  const compressed = await compressImage(file);
  const ext = compressed.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'png');
  const path = `feedback/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from('issue-images').upload(path, compressed, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(`图片上传失败：${error.message}`);

  const { data } = supabase.storage.from('issue-images').getPublicUrl(path);
  return data.publicUrl;
}
