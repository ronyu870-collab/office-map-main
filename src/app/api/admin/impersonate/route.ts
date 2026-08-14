import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/** 验证调用方是 admin，返回 supabaseAdmin 和 caller 信息 */
async function verifyAdmin(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { error: NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 }) };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authHeader = req.headers.get('authorization') ?? '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!accessToken) {
    return { error: NextResponse.json({ error: '未提供认证 Token' }, { status: 401 }) };
  }

  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !caller) {
    return { error: NextResponse.json({ error: '无效的认证 Token' }, { status: 401 }) };
  }

  const { data: roleRow, error: roleError } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .single();

  if (roleError || !roleRow || roleRow.role !== 'admin') {
    return { error: NextResponse.json({ error: '权限不足，仅管理员可执行此操作' }, { status: 403 }) };
  }

  return { supabaseAdmin, caller };
}

/**
 * GET /api/admin/impersonate?user_id=xxx
 * 获取目标用户的 profile 信息
 */
export async function GET(req: NextRequest) {
  try {
    const result = await verifyAdmin(req);
    if ('error' in result) return result.error;
    const { supabaseAdmin, caller } = result;

    const userId = req.nextUrl.searchParams.get('user_id');
    if (!userId) {
      return NextResponse.json({ error: '缺少 user_id 参数' }, { status: 400 });
    }

    // 禁止模拟自己
    if (userId === caller.id) {
      return NextResponse.json({ error: '不能模拟自己' }, { status: 400 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, email, role, full_name, chinese_name')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const displayName = profile.chinese_name || profile.full_name || (profile.email ? profile.email.split('@')[0] : '未知用户');

    return NextResponse.json({
      user_id: profile.user_id,
      email: profile.email,
      role: profile.role,
      displayName,
    });
  } catch (err) {
    console.error('[impersonate GET] Error:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * POST /api/admin/impersonate
 * 记录模拟操作的审计日志
 * Body: { action: 'impersonate_start' | 'impersonate_end', target_user_id, target_email }
 */
export async function POST(req: NextRequest) {
  try {
    const result = await verifyAdmin(req);
    if ('error' in result) return result.error;
    const { supabaseAdmin, caller } = result;

    const body = await req.json();
    const { action, target_user_id, target_email } = body;

    if (!action || !target_user_id) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const { error: insertError } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        user_id: caller.email || caller.id,
        action_type: action,
        details: {
          admin_user_id: caller.id,
          admin_email: caller.email,
          target_user_id,
          target_email,
          timestamp: new Date().toISOString(),
        },
      });

    if (insertError) {
      console.error('[impersonate POST] Audit log insert error:', insertError);
      return NextResponse.json({ error: '审计日志写入失败' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[impersonate POST] Error:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
