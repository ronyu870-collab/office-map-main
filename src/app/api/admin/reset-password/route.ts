import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validatePassword } from '@/src/utils/passwordPolicy';
import { writeAuditBestEffort } from '@/src/lib/serverAudit';
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';

// 明确告诉 Next.js 这是完全动态的 API，不要在构建时静态渲染
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. 环境变量防御性检查
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[reset-password] 缺少必要的环境变量');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    // 2. 按需初始化 Admin 客户端（使用 service_role key，绕过 RLS）
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const identityResult = await resolveEffectiveRequestIdentity(req, supabaseAdmin);
    if ('response' in identityResult) return identityResult.response;
    const { identity } = identityResult;
    if (identity.effectiveRole !== 'admin') {
      return NextResponse.json({ error: '权限不足，仅管理员可执行此操作' }, { status: 403 });
    }
    const impersonationBlock = denyImpersonatedMutation(identity);
    if (impersonationBlock) return impersonationBlock;
    const caller = identity.caller;

    // 6. 解析请求体，获取目标用户 ID
    const body = await req.json();
    const { userId, password } = body as { userId?: string; password?: string };

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: '缺少 userId 参数' }, { status: 400 });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    const temporaryPassword = password as string;

    // 7. 不允许管理员重置自己的密码（防止误操作）
    if (userId === caller.id) {
      return NextResponse.json({ error: '不能重置自己的密码，请通过"修改密码"功能操作' }, { status: 400 });
    }

    const { data: targetUserData, error: targetUserError } =
      await supabaseAdmin.auth.admin.getUserById(userId);
    if (targetUserError || !targetUserData.user) {
      return NextResponse.json({ error: '目标账号不存在' }, { status: 404 });
    }

    // 8. 执行密码重置，并要求用户下次登录先修改临时密码。
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: temporaryPassword,
      app_metadata: {
        ...targetUserData.user.app_metadata,
        must_change_password: true,
      },
    });

    if (updateError) {
      return NextResponse.json({ error: `重置失败: ${updateError.message}` }, { status: 500 });
    }

    await writeAuditBestEffort(supabaseAdmin, {
      user_id: caller.email || caller.id,
      action_type: 'ADMIN_DATA_OPERATION',
      details: { operation: 'UPDATE', table: 'auth.users', table_label: '重置密码', target_user_id: userId },
    }, 'admin/reset-password');

    return NextResponse.json({ success: true, message: '临时密码已生成' });
  } catch (err: unknown) {
    console.error('[reset-password] 未预期的错误:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
