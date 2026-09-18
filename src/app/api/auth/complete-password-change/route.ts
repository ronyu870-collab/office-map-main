import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { writeAuditBestEffort } from '@/src/lib/serverAudit';
import { validatePassword } from '@/src/utils/passwordPolicy';
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';

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
    const user = identity.caller;

    const body = await req.json();
    const passwordError = validatePassword(body.password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    const newPassword = body.password as string;

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
      app_metadata: {
        ...user.app_metadata,
        must_change_password: false,
      },
    });
    if (updateError) {
      return NextResponse.json({ error: `密码修改失败: ${updateError.message}` }, { status: 500 });
    }

    await writeAuditBestEffort(supabaseAdmin, {
      user_id: user.email || user.id,
      action_type: 'CHANGE_PASSWORD',
      details: { status: 'success', required_change_completed: true },
    }, 'auth/complete-password-change');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[complete-password-change] 异常:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
