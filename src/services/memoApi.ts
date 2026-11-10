import { supabase } from './supabaseClient';
import { compressImage } from '@/src/utils/image';
import type { Memo, MemoVersion, MemoListItem } from '@/src/types/memo';

const MEMO_BUCKET = 'issue-images';
const MEMO_IMAGE_PREFIX = 'memos/';

// ─── 列表查询（仅摘要字段） ──────────────────────────────────────────────────

const MEMO_LIST_FIELDS = 'id,title,tags,is_pinned,updated_at,updated_by';

export async function listMemos(options?: {
  tag?: string;
  search?: string;
  sort?: 'updated_at' | 'created_at' | 'title';
  ascending?: boolean;
}, signal?: AbortSignal): Promise<MemoListItem[]> {
  function read(field: string) {
    let query = supabase.from('memos').select(`${MEMO_LIST_FIELDS},${field}`);
    if (options?.tag) query = query.contains('tags', [options.tag]);
    if (options?.search) query = query.ilike('title', `%${options.search}%`);
    query = query.order('is_pinned', { ascending: false })
      .order(options?.sort ?? 'updated_at', { ascending: options?.ascending ?? false });
    return signal ? query.abortSignal(signal) : query;
  }

  let { data, error } = await read('content_preview:memo_content_preview');
  // A build may run before the migration or PostgREST's schema reload.
  // Authorization and other query errors must still fail visibly.
  if (!signal?.aborted && error?.code === '42703' && /\bmemo_content_preview\b/.test(error.message)) {
    ({ data, error } = await read('content'));
  }
  if (error) throw new Error(`获取备忘录列表失败：${error.message}`);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    tags: row.tags,
    is_pinned: row.is_pinned,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    content_preview: (row.content_preview ?? row.content ?? '').slice(0, 100),
  }));
}

// ─── 获取单条完整内容 ────────────────────────────────────────────────────────

export async function getMemo(id: string): Promise<Memo> {
  const { data, error } = await supabase
    .from('memos')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) throw new Error(`获取备忘录失败：${error?.message ?? '未找到'}`);
  return data as Memo;
}

// ─── 创建新备忘录 ─────────────────────────────────────────────────────────────

export async function createMemo(
  title: string,
  content: string,
  tags: string[],
  userEmail: string
): Promise<Memo> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('memos')
    .insert({
      title: title || '无标题',
      content,
      tags,
      is_pinned: false,
      created_at: now,
      updated_at: now,
      created_by: userEmail,
      updated_by: userEmail,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`创建备忘录失败：${error?.message ?? '未知错误'}`);

  // 创建初始版本快照
  await supabase.from('memo_versions').insert({
    memo_id: data.id,
    version: 1,
    title: data.title,
    content: data.content,
    tags: data.tags,
    snapshot_by: userEmail,
  });

  return data as Memo;
}

// ─── 自动保存（不创建版本快照） ──────────────────────────────────────────────

export async function updateMemoContent(
  id: string,
  updates: { title?: string; content?: string; tags?: string[] },
  userEmail: string
): Promise<Memo> {
  const { data, error } = await supabase
    .from('memos')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
      updated_by: userEmail,
    })
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new Error(`保存失败：${error?.message ?? '未知错误'}`);
  return data as Memo;
}

// ─── 手动保存（创建版本快照） ────────────────────────────────────────────────

export async function saveMemoWithVersion(
  id: string,
  updates: { title?: string; content?: string; tags?: string[] },
  userEmail: string
): Promise<Memo> {
  // 1. 更新 memo
  const memo = await updateMemoContent(id, updates, userEmail);

  // 2. 获取当前最大版本号
  const { data: versions } = await supabase
    .from('memo_versions')
    .select('version')
    .eq('memo_id', id)
    .order('version', { ascending: false })
    .limit(1);

  const nextVersion = (versions?.[0]?.version ?? 0) + 1;

  // 3. 插入版本快照
  await supabase.from('memo_versions').insert({
    memo_id: id,
    version: nextVersion,
    title: memo.title,
    content: memo.content,
    tags: memo.tags,
    snapshot_by: userEmail,
  });

  return memo;
}

// ─── 删除备忘录（CASCADE 自动删版本） ────────────────────────────────────────

export async function deleteMemo(id: string): Promise<void> {
  const { error } = await supabase.from('memos').delete().eq('id', id);
  if (error) throw new Error(`删除失败：${error.message}`);
}

// ─── 置顶切换 ─────────────────────────────────────────────────────────────────

export async function toggleMemoPin(id: string, isPinned: boolean): Promise<void> {
  const { error } = await supabase
    .from('memos')
    .update({ is_pinned: isPinned })
    .eq('id', id);
  if (error) throw new Error(`置顶操作失败：${error.message}`);
}

// ─── 版本历史 ─────────────────────────────────────────────────────────────────

export async function getMemoVersions(memoId: string): Promise<MemoVersion[]> {
  const { data, error } = await supabase
    .from('memo_versions')
    .select('*')
    .eq('memo_id', memoId)
    .order('version', { ascending: false });

  if (error) throw new Error(`获取版本历史失败：${error.message}`);
  return (data ?? []) as MemoVersion[];
}

export async function getMemoVersion(versionId: string): Promise<MemoVersion> {
  const { data, error } = await supabase
    .from('memo_versions')
    .select('*')
    .eq('id', versionId)
    .single();

  if (error || !data) throw new Error(`获取版本失败：${error?.message ?? '未找到'}`);
  return data as MemoVersion;
}

export async function restoreMemoVersion(
  memoId: string,
  versionId: string,
  userEmail: string
): Promise<Memo> {
  const version = await getMemoVersion(versionId);
  return saveMemoWithVersion(
    memoId,
    { title: version.title, content: version.content, tags: version.tags },
    userEmail
  );
}

// ─── 标签 ─────────────────────────────────────────────────────────────────────

export async function getAllTags(signal?: AbortSignal): Promise<string[]> {
  const query = supabase.rpc('get_all_memo_tags');
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) {
    if (signal?.aborted) return [];
    // fallback: 直接查询
    const fallback = supabase.from('memos').select('tags');
    const { data: memos, error: fallbackError } = await (signal ? fallback.abortSignal(signal) : fallback);
    if (fallbackError) throw new Error(`获取备忘录标签失败：${fallbackError.message}`);
    const tagSet = new Set<string>();
    (memos ?? []).forEach((m: any) => (m.tags ?? []).forEach((t: string) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }
  return (data ?? []).map((r: any) => r.tag).sort();
}

// ─── 图片上传 ─────────────────────────────────────────────────────────────────

export async function uploadMemoImage(
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  const compressed = await compressImage(file);
  onProgress?.(30);
  const ext = compressed.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'png');
  const path = `${MEMO_IMAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(MEMO_BUCKET).upload(path, compressed, {
    cacheControl: '3600',
    upsert: false,
  });
  onProgress?.(90);
  if (error) throw new Error(`图片上传失败：${error.message}`);
  const { data } = supabase.storage.from(MEMO_BUCKET).getPublicUrl(path);
  onProgress?.(100);
  return data.publicUrl;
}
