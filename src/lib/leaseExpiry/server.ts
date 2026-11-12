import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import type { SaveReview } from './contracts';

export function reviewJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, x-colliers-impersonate-user' } });
}
export async function requireLeaseReviewAdmin(request: Request) {
  if (process.env.LEASE_EXPIRY_REVIEW_ENABLED !== 'true') return reviewJson({ error: '管理员核实试点尚未开放' }, 403);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return reviewJson({ error: '核实服务配置未就绪' }, 503);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await resolveEffectiveRequestIdentity(request, client);
  if ('response' in result) {
    result.response.headers.set('Cache-Control', 'private, no-store');
    return result.response;
  }
  if (result.identity.callerRole !== 'admin' || result.identity.isImpersonating) {
    return reviewJson({ error: '仅真实管理员账号可访问核实清单，请退出用户模拟' }, 403);
  }
  // DB RPC checks current role and auth.users state again in its transaction.
  return { client, actorId: result.identity.caller.id };
}
export function reviewRpcError(error: { code?: string; message?: string }) {
  if (error.code === '42501') return reviewJson({ error: '权限已变更或账号已停用，请重新登录' }, 403);
  if (error.code === '22023') return reviewJson({ error: '核实资料格式不正确' }, 400);
  if (error.code === 'P0002') return reviewJson({ error: '原始记录已不可用' }, 404);
  if (error.message === 'F6_SOURCE_CHANGED') return reviewJson({ error: '原始资料已变化。请保留当前备注，重新载入后核对。', code: 'source_changed' }, 409);
  if (error.message === 'F6_REVISION_CONFLICT') return reviewJson({ error: '另一位管理员已更新草稿。请保留当前备注，重新载入后核对。', code: 'revision_conflict' }, 409);
  if (error.message === 'F6_REQUEST_CONFLICT') return reviewJson({ error: '保存请求内容不一致，请重新载入后核对。', code: 'request_conflict' }, 409);
  return reviewJson({ error: '核实服务暂时不可用，请稍后重试' }, 503);
}
// Awaiting this RPC persists both the draft and its before/after audit event atomically.
export async function writeAuditLeaseExpiryReview(client: SupabaseClient, actorId: string, input: SaveReview) {
  return await client.rpc('lease_expiry_review_save', {
    p_source_kind: input.source_kind, p_actor: actorId, p_source_id: input.source_id, p_expected_revision: input.expected_revision,
    p_source_fingerprint: input.source_fingerprint, p_request_id: input.request_id,
    p_status: input.status, p_notes: input.notes, p_evidence_reference: input.evidence_reference,
  });
}
