import { supabase } from '@/src/services/supabaseClient';
import type { FeedbackComment } from './feedbackApi';

const FIELDS = 'id,issue_id,content,images,created_by,is_admin,created_at,kind,metadata';
let missingUntil = 0;

type FeedbackThread = { comments: FeedbackComment[]; readAt: string | null };

async function openLegacyThread(issueId: string, signal: AbortSignal): Promise<FeedbackThread> {
  const { error: markError } = await supabase.rpc('feedback_mark_read', { p_issue_id: issueId }).abortSignal(signal);
  if (markError) throw new Error(`更新已读状态失败：${markError.message}`);
  const { data, error } = await supabase.from('admin_issue_comments').select(FIELDS).eq('issue_id', issueId)
    .order('created_at', { ascending: true }).abortSignal(signal);
  if (error) throw new Error(`获取沟通记录失败：${error.message}`);
  return { comments: (data ?? []) as FeedbackComment[], readAt: null };
}

export async function openFeedbackThread(issueId: string, signal: AbortSignal): Promise<FeedbackThread> {
  signal.throwIfAborted();
  if (Date.now() < missingUntil) return openLegacyThread(issueId, signal);

  const { data, error } = await supabase.rpc('feedback_open_thread', { p_issue_id: issueId })
    .select('read_at,comment,comment_created_at').order('comment_created_at', { ascending: true }).abortSignal(signal);
  if (error?.code === 'PGRST202') {
    signal.throwIfAborted();
    // The schema can lag the frontend during rollout. Only a missing RPC may fall back.
    missingUntil = Date.now() + 30_000;
    return openLegacyThread(issueId, signal);
  }
  if (error) throw new Error(`获取沟通记录失败：${error.message}`);
  const rows = (data ?? []) as { read_at: string; comment: FeedbackComment | null }[];
  const readAt = rows[0]?.read_at;
  if (!readAt || !Number.isFinite(Date.parse(readAt)) || rows.some(row => row.comment && row.comment.issue_id !== issueId)) {
    throw new Error('未能确认沟通记录，请重试。');
  }
  return { readAt, comments: rows.flatMap(({ comment }) => comment ? [comment] : []) };
}

export function isLaterFeedbackActivity(value: string | null, baseline: string | null): boolean {
  return value !== null && (baseline === null || Date.parse(value) > Date.parse(baseline));
}

export function mergeFeedbackReadAt(previous: string | null, incoming: string | null): string | null {
  return isLaterFeedbackActivity(incoming, previous) ? incoming : previous;
}
