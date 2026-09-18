import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';

export const dynamic = 'force-dynamic';

// 硬上限，防止数据膨胀后全量查询
const MAX_LIMIT = 500;

/**
 * GET /api/submissions
 * 获取所有租赁成交提交记录（使用 service_role key 绕过 RLS）
 * 需要有效的 JWT token，admin 可查看全部，普通用户只看自己的
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

    const identityResult = await resolveEffectiveRequestIdentity(req, supabaseAdmin);
    if ('response' in identityResult) return identityResult.response;
    const { identity } = identityResult;
    const isAdmin = identity.effectiveRole === 'admin';

    // 构建查询
    let query = supabaseAdmin
      .from('lease_transactions')
      .select('*')
      .gte('created_at', '2026-04-23T00:00:00Z')
      .order('created_at', { ascending: false })
      .limit(MAX_LIMIT);

    // 非 admin 用户只能看自己的记录
    if (!isAdmin) {
      query = query.eq('submitter_id', identity.effectiveUserId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[api/submissions] 查询失败:', error);
      return NextResponse.json({ error: '查询提交记录失败' }, { status: 500 });
    }

    return NextResponse.json({ submissions: data || [] });
  } catch (err) {
    console.error('[api/submissions] 异常:', err);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
