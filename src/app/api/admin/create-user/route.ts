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

    // 确认调用方是 admin
    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id)
      .single();

    if (roleError || !roleRow || roleRow.role !== 'admin') {
      return NextResponse.json({ error: '权限不足，仅管理员可执行此操作' }, { status: 403 });
    }

    // 解析请求体
    const body = await req.json();
    const { email, password, chinese_name, full_name, role, phone, gender, title, internal_number, seq_no } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: '邮箱不能为空' }, { status: 400 });
    }

    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : 'user';
    if (!['admin', 'editor', 'user'].includes(normalizedRole)) {
      return NextResponse.json({ error: '无效的用户角色' }, { status: 400 });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    const userPassword = password as string;

    // 1. 创建 Supabase Auth 账号
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password: userPassword,
      email_confirm: true,
      app_metadata: { must_change_password: true },
    });

    if (createError) {
      return NextResponse.json({ error: `创建账号失败: ${createError.message}` }, { status: 500 });
    }

    const userId = authData.user.id;

    // 2. 插入 user_roles 记录（user_id 使用 auth UUID）
    const { error: insertError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: userId,
        role: normalizedRole,
        chinese_name: chinese_name || null,
        full_name: full_name || null,
        email: email.trim(),
        phone: phone || null,
        gender: gender || null,
        title: title || null,
        internal_number: internal_number || null,
        seq_no: seq_no != null && seq_no !== '' ? Number(seq_no) : null,
      });

    if (insertError) {
      // 回滚：删除已创建的 auth 账号
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: `创建用户档案失败: ${insertError.message}` }, { status: 500 });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: caller.email || caller.id,
      action_type: 'ADMIN_DATA_OPERATION',
      details: { operation: 'INSERT', table: 'user_roles', table_label: '用户管理', name: full_name || chinese_name, email: email.trim() },
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
