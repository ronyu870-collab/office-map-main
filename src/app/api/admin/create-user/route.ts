import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validatePassword } from '@/src/utils/passwordPolicy';
import { writeAuditBestEffort } from '@/src/lib/serverAudit';
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';

export const dynamic = 'force-dynamic';

const ADMIN_FORM_ROLES = new Set(['admin', 'editor', 'user']);

function toDatabaseRole(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'user';
  if (!ADMIN_FORM_ROLES.has(normalized)) return null;
  return normalized === 'user' ? 'viewer' : normalized;
}

function optionalText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
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

    const identityResult = await resolveEffectiveRequestIdentity(req, supabaseAdmin);
    if ('response' in identityResult) return identityResult.response;
    const { identity } = identityResult;
    if (identity.effectiveRole !== 'admin') {
      return NextResponse.json({ error: '权限不足，仅管理员可执行此操作' }, { status: 403 });
    }
    const impersonationBlock = denyImpersonatedMutation(identity);
    if (impersonationBlock) return impersonationBlock;
    const caller = identity.caller;

    const body = await req.json();
    const { email, password, chinese_name, full_name, role, phone, gender, title, internal_number, seq_no } = body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return NextResponse.json({ error: '邮箱不能为空' }, { status: 400 });
    }

    const normalizedPhone = optionalText(phone);
    if (!normalizedPhone || !/^\d{11}$/.test(normalizedPhone)) {
      return NextResponse.json({ error: '手机号必须为 11 位数字' }, { status: 400 });
    }

    const databaseRole = toDatabaseRole(role);
    if (!databaseRole) {
      return NextResponse.json({ error: '无效的用户角色' }, { status: 400 });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    const userPassword = password as string;
    const normalizedEmail = email.trim();

    // 创建 Auth 账号时，auth_user_created_profile trigger 会同步创建 viewer 档案。
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: userPassword,
      email_confirm: true,
      app_metadata: { must_change_password: true },
    });

    if (createError || !authData.user) {
      return NextResponse.json({ error: `创建账号失败: ${createError?.message ?? '未返回用户信息'}` }, { status: 500 });
    }

    const userId = authData.user.id;

    // trigger 已经创建同主键档案，因此这里必须 upsert，而不能再次 insert。
    // 如果未来 trigger 被移除，upsert 仍能安全创建档案。
    const { error: profileError } = await supabaseAdmin
      .from('user_roles')
      .upsert({
        user_id: userId,
        role: databaseRole,
        chinese_name: optionalText(chinese_name),
        full_name: optionalText(full_name),
        email: normalizedEmail,
        phone: normalizedPhone,
        gender: optionalText(gender),
        title: optionalText(title),
        internal_number: optionalText(internal_number),
        seq_no: seq_no != null && seq_no !== '' ? Number(seq_no) : null,
      }, { onConflict: 'user_id' });

    if (profileError) {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (rollbackError) {
        console.error('[create-user] 创建档案失败且 Auth 回滚失败:', rollbackError.message);
      }
      return NextResponse.json({ error: `创建用户档案失败: ${profileError.message}` }, { status: 500 });
    }

    await writeAuditBestEffort(supabaseAdmin, {
      user_id: caller.email || caller.id,
      action_type: 'ADMIN_DATA_OPERATION',
      details: {
        operation: 'INSERT',
        table: 'user_roles',
        table_label: '用户管理',
        target_user_id: userId,
        role: databaseRole,
        name: optionalText(full_name) || optionalText(chinese_name),
        email: normalizedEmail,
      },
    }, 'admin/create-user');

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
