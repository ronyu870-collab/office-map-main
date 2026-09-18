import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/brokers
 * 获取业务员列表（使用 service_role key 绕过 RLS）
 * 需要有效的认证 Token。
 *
 * 应用角色契约只有 viewer / editor / admin；broker 对应 editor。
 */
export async function GET(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Broker discovery is role-neutral, but an active simulation context still
    // has to be valid. This prevents a stale or forged simulation header from
    // silently falling back to the administrator identity.
    const identityResult = await resolveEffectiveRequestIdentity(req, supabaseAdmin);
    if ('response' in identityResult) return identityResult.response;

    const [{ data, error }, { data: authUsers, error: authUsersError }] = await Promise.all([
      supabaseAdmin
        .from('user_roles')
        .select('user_id, full_name, chinese_name, role, email')
        .eq('role', 'editor')
        .not('chinese_name', 'eq', '测试账号')
        .not('email', 'is', null)
        .order('user_id', { ascending: true }),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    if (error) {
      console.error('[api/brokers] 查询失败:', error);
      return NextResponse.json({ error: '查询业务员列表失败' }, { status: 500 });
    }
    if (authUsersError) {
      console.error('[api/brokers] 查询账号状态失败:', authUsersError);
      return NextResponse.json({ error: '查询账号状态失败' }, { status: 500 });
    }

    const activeUserIds = new Set(
      authUsers.users
        .filter((user) => {
          if (!user.banned_until) return true;
          const bannedUntil = new Date(user.banned_until).getTime();
          return Number.isNaN(bannedUntil) || bannedUntil <= Date.now();
        })
        .map((user) => user.id),
    );

    const brokers = (data || [])
      .filter((row) => activeUserIds.has(row.user_id))
      .map((row) => ({
        user_id: row.user_id,
        name: row.full_name || row.chinese_name || row.user_id,
      }));

    return NextResponse.json({ brokers });
  } catch (err) {
    console.error('[api/brokers] 异常:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
