import { supabase } from './supabaseClient';
import type { NoticeRow } from './apiClient';
import type { SystemTask } from '@/src/types/admin-memo';

/**
 * 新增一条公告（最多允许3条同时生效）。
 * 调用前应由 UI 层确认当前 active 数量 < 3。
 */
export async function publishNotice(
  content: string,
  updatedBy: string
): Promise<NoticeRow> {
  const { data, error } = await supabase
    .from('notices')
    .insert({
      content: content.trim(),
      is_active: true,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`发布公告失败：${error?.message ?? '未知错误'}`);
  }
  return data as NoticeRow;
}

/**
 * 将指定 id 的公告设为 inactive（软删除）。
 */
export async function deactivateNotice(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('notices')
    .update({ is_active: false })
    .eq('id', id)
    .eq('is_active', true)
    .select('id')
    .single();

  if (error || !data) throw new Error(`删除公告失败：${error?.message ?? '未找到生效公告'}`);
}

/**
 * 清空所有生效公告。
 */
export async function clearNotice(): Promise<void> {
  const { error } = await supabase
    .from('notices')
    .update({ is_active: false })
    .eq('is_active', true);

  if (error) throw new Error(`清空公告失败：${error.message}`);
}

/**
 * 管理员备忘录相关接口
 */

export interface AdminMemo {
  id: string;
  content: string;
  updated_at: string;
  updated_by: string;
}

export interface UpdateAdminMemoResponse {
  memo: AdminMemo;
  conflict?: {
    detected: boolean;
    serverUpdatedAt: string;
    serverUpdatedBy: string;
  };
}

const MEMO_ID = '00000000-0000-0000-0000-000000000001';

/**
 * 获取全局唯一的管理员备忘录
 */
export async function getAdminMemo(): Promise<AdminMemo> {
  const { data, error } = await supabase
    .from('admin_memos')
    .select('*')
    .eq('id', MEMO_ID)
    .single();

  if (error || !data) {
    // 检测权限错误（401/403）
    const statusCode = (error as { status?: number } | null)?.status;
    if (statusCode === 401 || statusCode === 403) {
      throw Object.assign(new Error('权限不足，请检查登录状态'), { code: 'PERMISSION_DENIED' });
    }
    throw new Error(`获取备忘录失败：${error?.message ?? '未知错误'}`);
  }

  return data as AdminMemo;
}

/**
 * 更新管理员备忘录内容
 */
export async function updateAdminMemo(
  content: string,
  userEmail: string
): Promise<AdminMemo> {
  const { data, error } = await supabase
    .from('admin_memos')
    .update({
      content: content,
      updated_at: new Date().toISOString(),
      updated_by: userEmail,
    })
    .eq('id', MEMO_ID)
    .select()
    .single();

  if (error || !data) {
    // 检测权限错误（401/403）
    const statusCode = (error as { status?: number } | null)?.status;
    if (statusCode === 401 || statusCode === 403) {
      throw Object.assign(new Error('权限不足，请检查登录状态'), { code: 'PERMISSION_DENIED' });
    }
    // 检测网络错误
    if (!navigator.onLine) {
      throw Object.assign(new Error('网络连接已断开，请检查网络后重试'), { code: 'NETWORK_ERROR' });
    }
    throw new Error(`更新备忘录失败：${error?.message ?? '未知错误'}`);
  }

  return data as AdminMemo;
}

/**
 * 更新管理员备忘录内容（带冲突检测）
 */
export async function updateAdminMemoWithConflictCheck(
  content: string,
  userEmail: string,
  expectedTimestamp: string
): Promise<UpdateAdminMemoResponse> {
  // 先检查当前版本
  const current = await getAdminMemo();

  // 冲突检测：比较时间戳（转为 Date 对象避免格式差异导致误判）
  const currentTime = new Date(current.updated_at).getTime();
  const expectedTime = new Date(expectedTimestamp).getTime();
  if (currentTime !== expectedTime) {
    return {
      memo: current,
      conflict: {
        detected: true,
        serverUpdatedAt: current.updated_at,
        serverUpdatedBy: current.updated_by,
      },
    };
  }

  // 无冲突，执行更新
  const updated = await updateAdminMemo(content, userEmail);

  return {
    memo: updated,
    conflict: {
      detected: false,
      serverUpdatedAt: updated.updated_at,
      serverUpdatedBy: updated.updated_by,
    },
  };
}

/**
 * 强制覆盖（忽略冲突）
 */
export async function forceUpdateAdminMemo(
  content: string,
  userEmail: string
): Promise<AdminMemo> {
  return updateAdminMemo(content, userEmail);
}


/**
 * 获取系统任务提示
 */
export async function getSystemTasks(): Promise<SystemTask[]> {
  const tasks: SystemTask[] = [];

  // 检查待处理更新（示例：检查 update_requests 表）
  try {
    const { data: pendingUpdates, error } = await supabase
      .from('update_requests')
      .select('id')
      .eq('status', 'pending');

    if (!error && pendingUpdates && pendingUpdates.length > 0) {
      tasks.push({
        id: 'pending-updates',
        type: 'pending_update',
        title: `${pendingUpdates.length} 条数据更新请求待处理`,
        description: '点击查看详情',
        priority: 'high',
        link: '/admin/updates',
        createdAt: new Date(),
      });
    }
  } catch (err) {
    console.error('Failed to fetch pending updates:', err);
  }

  // 检查 OSS 存储使用率
  try {
    const usage = await getStorageUsage();

    if (usage > 80) {
      tasks.push({
        id: 'storage-warning',
        type: 'storage_warning',
        title: `OSS 存储使用率 ${usage.toFixed(1)}%`,
        description: '建议清理旧文件或扩容',
        priority: usage > 90 ? 'high' : 'medium',
        link: '/admin/oss',
        createdAt: new Date(),
      });
    }
  } catch (err) {
    console.error('Failed to fetch storage usage:', err);
  }

  return tasks;
}

/**
 * 获取 OSS 存储使用率（模拟实现）
 * TODO: 实际实现需要调用 OSS API
 */
async function getStorageUsage(): Promise<number> {
  // 这里返回模拟数据
  // 实际实现需要调用 ali-oss 的 API 获取存储使用情况
  return 75;
}

// ===== 需求反馈模块 =====

export interface AdminIssue {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'wontfix' | 'duplicate';
  priority: 'high' | 'medium' | 'low';
  category: 'bug' | 'feature' | 'data' | 'other';
  module: string;
  images: string[];
  created_at: string;
  created_by: string;
  resolved_at: string | null;
  resolved_by: string;
  reopened_at: string | null;
}

export interface AdminIssueComment {
  id: string;
  issue_id: string;
  content: string;
  images: string[];
  created_by: string;
  is_admin: boolean;
  created_at: string;
}

export interface IssueQueryOptions {
  statusFilter?: string;
  categoryFilter?: string;
  moduleFilter?: string;
  prioritySort?: boolean;
  search?: string;
}

export async function getIssues(options: IssueQueryOptions = {}): Promise<AdminIssue[]> {
  let query = supabase.from('admin_issues').select('*');

  if (options.statusFilter && options.statusFilter !== 'all') {
    query = query.eq('status', options.statusFilter);
  }
  if (options.categoryFilter && options.categoryFilter !== 'all') {
    query = query.eq('category', options.categoryFilter);
  }
  if (options.moduleFilter && options.moduleFilter !== 'all') {
    query = query.eq('module', options.moduleFilter);
  }
  if (options.search) {
    query = query.or(`title.ilike.%${options.search}%,description.ilike.%${options.search}%`);
  }

  // 排序：优先级高的在前，同优先级按时间降序
  if (options.prioritySort) {
    query = query.order('priority', { ascending: true }).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw new Error(`获取问题列表失败：${error.message}`);
  return (data ?? []) as AdminIssue[];
}

export async function createIssue(
  title: string,
  description: string,
  priority: string,
  category: string,
  module: string,
  images: string[],
  createdBy: string
): Promise<AdminIssue> {
  const { data, error } = await supabase
    .from('admin_issues')
    .insert({ title, description, priority, category, module, images, created_by: createdBy })
    .select()
    .single();
  if (error) throw new Error(`创建问题失败：${error.message}`);
  return data as AdminIssue;
}

export async function updateIssue(
  id: string,
  updates: Partial<Pick<AdminIssue, 'title' | 'description' | 'status' | 'priority' | 'category' | 'module' | 'images'> & { resolved_by?: string }>
): Promise<AdminIssue> {
  if (updates.status === 'resolved') {
    (updates as any).resolved_at = new Date().toISOString();
  }
  if (updates.status === 'open' && (updates as any).reopened_at !== undefined) {
    (updates as any).reopened_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('admin_issues')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`更新问题失败：${error.message}`);
  return data as AdminIssue;
}

export async function deleteIssue(id: string): Promise<void> {
  const { error } = await supabase.from('admin_issues').delete().eq('id', id);
  if (error) throw new Error(`删除问题失败：${error.message}`);
}

// ─── 评论 ────────────────────────────────────────────────────────

export async function getComments(issueId: string): Promise<AdminIssueComment[]> {
  const { data, error } = await supabase
    .from('admin_issue_comments')
    .select('*')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`获取评论失败：${error.message}`);
  return (data ?? []) as AdminIssueComment[];
}

export async function addComment(
  issueId: string,
  content: string,
  images: string[],
  createdBy: string,
  isAdmin: boolean
): Promise<AdminIssueComment> {
  const { data, error } = await supabase
    .from('admin_issue_comments')
    .insert({ issue_id: issueId, content, images, created_by: createdBy, is_admin: isAdmin })
    .select()
    .single();
  if (error) throw new Error(`添加评论失败：${error.message}`);
  return data as AdminIssueComment;
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('admin_issue_comments').delete().eq('id', id);
  if (error) throw new Error(`删除评论失败：${error.message}`);
}

// ─── 图片上传（含压缩） ──────────────────────────────────────────

async function compressImage(file: File, maxDim = 1600, quality = 0.8): Promise<File> {
  // 小于 500KB 不压缩
  if (file.size < 500 * 1024) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export async function uploadIssueImage(
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  const compressed = await compressImage(file);
  onProgress?.(30);
  const ext = compressed.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'png');
  const path = `issues/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from('issue-images').upload(path, compressed, {
    cacheControl: '3600',
    upsert: false,
  });
  onProgress?.(90);
  if (error) throw new Error(`图片上传失败：${error.message}`);
  const { data } = supabase.storage.from('issue-images').getPublicUrl(path);
  onProgress?.(100);
  return data.publicUrl;
}
