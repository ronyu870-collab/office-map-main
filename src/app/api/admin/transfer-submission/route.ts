import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { writeAuditBestEffort } from '@/src/lib/serverAudit';
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { canWriteBusinessData } from '@/src/utils/accessControl';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const identityResult = await resolveEffectiveRequestIdentity(req, supabaseAdmin);
    if ('response' in identityResult) return identityResult.response;
    const { identity } = identityResult;
    const impersonationBlock = denyImpersonatedMutation(identity);
    if (impersonationBlock) return impersonationBlock;
    if (!canWriteBusinessData(identity.effectiveRole)) {
      return NextResponse.json({ error: '当前账号为只读模式，不能转交成交记录' }, { status: 403 });
    }
    const caller = identity.caller;

    // 解析请求体
    const body = await req.json();
    const { submissionId, targetUserId, targetUserName } = body;

    if (!submissionId || !targetUserId || !targetUserName) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证记录存在且属于当前用户（或调用方是 admin）
    const { data: submission, error: fetchError } = await supabaseAdmin
      .from('lease_transactions')
      .select('id, submitter_id, submitter_name')
      .eq('id', submissionId)
      .single();

    if (fetchError || !submission) {
      return NextResponse.json({ error: '未找到该记录' }, { status: 404 });
    }

    // 检查权限：本人或 admin 可以赠与
    const isAdmin = identity.effectiveRole === 'admin';
    if (submission.submitter_id !== identity.effectiveUserId && !isAdmin) {
      return NextResponse.json({ error: '只能赠与自己提交的记录' }, { status: 403 });
    }

    // 执行赠与：只更新 submitter_id 和 submitter_name，不动 original_* 字段
    const { error: updateError } = await supabaseAdmin
      .from('lease_transactions')
      .update({
        submitter_id: targetUserId,
        submitter_name: targetUserName,
      })
      .eq('id', submissionId);

    if (updateError) {
      return NextResponse.json({ error: `赠与失败: ${updateError.message}` }, { status: 500 });
    }

    await writeAuditBestEffort(supabaseAdmin, {
      user_id: caller.id,
      action_type: 'TRANSFER_SUBMISSION',
      details: {
        record_id: submissionId,
        original_submitter_id: submission.submitter_id,
        original_submitter_name: submission.submitter_name,
        target_user_id: targetUserId,
        target_user_name: targetUserName,
      },
    }, 'admin/transfer-submission');

    return NextResponse.json({
      success: true,
      message: `已成功赠与给 ${targetUserName}`,
    });
  } catch (err: unknown) {
    console.error('[transfer-submission] 未预期的错误:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
