import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { validatePassword } from '@/src/utils/passwordPolicy';

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
    const accessToken = (req.headers.get('authorization') ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    if (!accessToken) {
      return NextResponse.json({ error: '未提供认证 Token' }, { status: 401 });
    }

    const { data: { user }, error: authError } =
      await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) {
      return NextResponse.json({ error: '登录状态已失效，请重新登录' }, { status: 401 });
    }

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

    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.email || user.id,
      action_type: 'CHANGE_PASSWORD',
      details: { status: 'success', required_change_completed: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[complete-password-change] 异常:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
