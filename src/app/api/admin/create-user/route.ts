import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validatePassword } from '@/src/utils/passwordPolicy';
import { APP_ROLES, parseUserRole } from '@/src/types/auth';

export const dynamic = 'force-dynamic';

function normalizeOptionalText(value: unknown, maxLength = 200): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

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

    const authHeader = req.headers.get('authorization') ?? '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!accessToken) {
      return NextResponse.json({ error: '未提供认证 Token' }, { status: 401 });
    }

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !caller) {
      return NextResponse.json({ error: '无效的认证 Token' }, { status: 401 });
    }

    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id)
      .single();

    if (roleError || !roleRow || roleRow.role !== 'admin') {
      return NextResponse.json({ error: '权限不足，仅管理员可执行此操作' }, { status: 403 });
    }

    const body = await req.json();
    const { email, password, chinese_name, full_name, role, phone, gender, title, internal_number, seq_no } = body;

    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
    }

    const normalizedRole = role === undefined || role === null || role === ''
      ? 'viewer'
      : parseUserRole(role);
    if (!normalizedRole || !APP_ROLES.includes(normalizedRole)) {
      return NextResponse.json({ error: '无效的用户角色' }, { status: 400 });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    const userPassword = password as string;

    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: userPassword,
      email_confirm: true,
      app_metadata: { must_change_password: true },
    });

    if (createError) {
      return NextResponse.json({ error: `创建账号失败：${createError.message}` }, { status: 400 });
    }

    const userId = authData.user.id;

    const { error: insertError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: userId,
        role: normalizedRole,
        chinese_name: normalizeOptionalText(chinese_name),
        full_name: normalizeOptionalText(full_name),
        email: normalizedEmail,
        phone: normalizeOptionalText(phone, 50),
        gender: normalizeOptionalText(gender, 50),
        title: normalizeOptionalText(title),
        internal_number: normalizeOptionalText(internal_number, 50),
        seq_no: seq_no != null && seq_no !== '' ? Number(seq_no) : null,
      });

    if (insertError) {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (rollbackError) {
        console.error('[create-user] 创建档案失败且 Auth 回滚失败:', rollbackError.message);
      }
      return NextResponse.json({ error: `创建用户档案失败：${insertError.message}` }, { status: 500 });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: caller.email || caller.id,
      action_type: 'ADMIN_DATA_OPERATION',
      details: {
        operation: 'INSERT',
        table: 'user_roles',
        table_label: '用户管理',
        name: normalizeOptionalText(full_name) || normalizeOptionalText(chinese_name),
        email: normalizedEmail,
        role: normalizedRole,
      },
    });

    return NextResponse.json({
      success: true,
      message: '用户创建成功',
      userId,
    });
  } catch (err: unknown) {
    console.error('[create-user] 未预期的错误:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
