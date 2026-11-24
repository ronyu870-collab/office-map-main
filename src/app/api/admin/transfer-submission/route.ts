import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { canWriteBusinessData } from '@/src/utils/accessControl';

export const dynamic = 'force-dynamic';
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const timestamp = (value: unknown): value is string | null => value === null || (
  typeof value === 'string' && value.length <= 64
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value))
);
const failure = (error: string, code: string, status: number) => NextResponse.json({ error, code }, { status });

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRoleKey) return failure('服务暂不可用，请稍后重试', 'TRANSFER_UNAVAILABLE', 503);
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const identityResult = await resolveEffectiveRequestIdentity(req, client);
    if ('response' in identityResult) return identityResult.response;
    const { identity } = identityResult;
    const impersonationBlock = denyImpersonatedMutation(identity);
    if (impersonationBlock) return impersonationBlock;
    if (!canWriteBusinessData(identity.effectiveRole)) {
      return failure('当前账号为只读模式，不能转交成交记录', 'TRANSFER_ACTOR_FORBIDDEN', 403);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body');
      body = parsed;
    } catch {
      return failure('转交参数无效', 'INVALID_TRANSFER_REQUEST', 400);
    }
    // Old open pages cannot invent a safe precondition or idempotency key.
    // Reject before any mutation; never fall back to the former read-then-write.
    if (!Object.hasOwn(body, 'requestId') || !Object.hasOwn(body, 'expectedSubmitterId') || !Object.hasOwn(body, 'expectedUpdatedAt')) {
      return failure('转交功能已更新，请刷新页面后重新打开记录', 'REFRESH_REQUIRED', 409);
    }
    const { requestId, submissionId, targetUserId, expectedSubmitterId, expectedUpdatedAt } = body;
    if (![requestId, submissionId, targetUserId].every((id) => typeof id === 'string' && UUID.test(id))
      || !(expectedSubmitterId === null || (typeof expectedSubmitterId === 'string' && expectedSubmitterId.length <= 4096))
      || !timestamp(expectedUpdatedAt)) {
      return failure('转交参数无效，请刷新记录后重试', 'INVALID_TRANSFER_REQUEST', 400);
    }
    // The service-only RPC revalidates the current actor/recipient and atomically
    // commits the lease row, audit_logs and request receipt. It preserves the
    // existing UPDATE audit trigger; no second best-effort event is emitted here.
    const { data, error } = await client.rpc('transfer_lease_submission_v1', {
      p_request_id: requestId,
      p_actor_id: identity.caller.id,
      p_submission_id: submissionId,
      p_target_user_id: targetUserId,
      p_expected_submitter_id: expectedSubmitterId,
      // Preserve Postgres microseconds; Date.toISOString() would lose precision.
      p_expected_updated_at: expectedUpdatedAt,
    });
    if (error) {
      const known: Record<string, [string, number]> = {
        TRANSFER_ACTOR_FORBIDDEN: ['账号当前不可执行转交，请重新登录并核对权限', 403],
        TRANSFER_OWNER_FORBIDDEN: ['只能赠与自己提交的记录', 403],
        TRANSFER_TARGET_INVALID: ['接收人不存在、已停用或不符合接收条件，请重新选择', 400],
        TRANSFER_RECORD_NOT_FOUND: ['未找到该记录，请刷新列表', 404],
        STALE_RECORD: ['记录已被更新，请刷新后核对归属，再重新转交', 409],
        REQUEST_PAYLOAD_MISMATCH: ['该转交请求与原操作不一致，请核对待确认操作', 409],
        TRANSFER_SAME_OWNER: ['接收人与当前归属相同，无需转交', 400],
        INVALID_TRANSFER_REQUEST: ['转交参数无效', 400],
      };
      if (known[error.message]) {
        const [message, status] = known[error.message];
        return failure(message, error.message, status);
      }
      console.error('[transfer-submission] RPC failed', { code: error.code });
      return failure('暂未确认转交结果，请保留原操作并重试确认', 'TRANSFER_UNCONFIRMED', 503);
    }
    // A successful HTTP/RPC response without a matching receipt is ambiguous.
    if (!data || data.requestId !== String(requestId).toLowerCase()
      || data.submissionId !== String(submissionId).toLowerCase()
      || data.targetUserId !== String(targetUserId).toLowerCase()
      || typeof data.targetUserName !== 'string' || !data.targetUserName
      || typeof data.replayed !== 'boolean' || !timestamp(data.updatedAt)
      || typeof data.transferredAt !== 'string' || !timestamp(data.transferredAt)) {
      return failure('暂未确认转交结果，请保留原操作并重试确认', 'TRANSFER_UNCONFIRMED', 503);
    }
    return NextResponse.json({
      success: true,
      requestId: data.requestId, submissionId: data.submissionId,
      targetUserId: data.targetUserId, targetUserName: data.targetUserName,
      updatedAt: data.updatedAt, transferredAt: data.transferredAt, replayed: data.replayed,
    });
  } catch (error) {
    console.error('[transfer-submission] unexpected failure', { name: error instanceof Error ? error.name : 'unknown' });
    return failure('暂未确认转交结果，请保留原操作并重试确认', 'TRANSFER_UNCONFIRMED', 503);
  }
}
