import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

    // 验证调用方身份
    const authHeader = req.headers.get('authorization') ?? '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!accessToken) {
      return NextResponse.json({ error: '未提供认证 Token' }, { status: 401 });
    }

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !caller) {
      return NextResponse.json({ error: '无效的认证 Token' }, { status: 401 });
    }

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
    const { data: roleRow } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id)
      .single();

    const isAdmin = roleRow?.role === 'admin';
    if (submission.submitter_id !== caller.id && !isAdmin) {
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

    // 记录审计日志
    await supabaseAdmin.from('audit_logs').insert({
      user_id: caller.id,
      action_type: 'TRANSFER_SUBMISSION',
      details: {
        record_id: submissionId,
        original_submitter_id: submission.submitter_id,
        original_submitter_name: submission.submitter_name,
        target_user_id: targetUserId,
        target_user_name: targetUserName,
      },
    });

    return NextResponse.json({
      success: true,
      message: `已成功赠与给 ${targetUserName}`,
    });
  } catch (err: any) {
    console.error('[transfer-submission] 未预期的错误:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
