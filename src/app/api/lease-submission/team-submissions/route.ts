import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { maskInactiveSubmitters } from '@/src/utils/leaseSubmitterPrivacy';

export const dynamic = 'force-dynamic';

function isActiveUser(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return true;
  const timestamp = new Date(bannedUntil).getTime();
  return Number.isNaN(timestamp) || timestamp <= Date.now();
}

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
    const accessToken = (req.headers.get('authorization') ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    if (!accessToken) {
      return NextResponse.json({ error: '未提供认证 Token' }, { status: 401 });
    }

    const { data: { user: caller }, error: authError } =
      await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !caller) {
      return NextResponse.json({ error: '无效的认证 Token' }, { status: 401 });
    }

    const [transactionsResult, usersResult] = await Promise.all([
      supabaseAdmin
        .from('lease_transactions')
        .select('*')
        .gte('created_at', '2026-04-23T00:00:00Z')
        .order('created_at', { ascending: false })
        .limit(500),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    if (transactionsResult.error) {
      console.error('[team-submissions] 查询成交记录失败:', transactionsResult.error);
      return NextResponse.json({ error: '查询提交记录失败' }, { status: 500 });
    }
    if (usersResult.error) {
      console.error('[team-submissions] 查询账号状态失败:', usersResult.error);
      return NextResponse.json({ error: '查询账号状态失败' }, { status: 500 });
    }

    const activeUserIds = new Set(
      usersResult.data.users
        .filter((user) => isActiveUser(user.banned_until))
        .map((user) => user.id),
    );
    const submissions = maskInactiveSubmitters(
      transactionsResult.data ?? [],
      activeUserIds,
    );

    return NextResponse.json({ submissions });
  } catch (error) {
    console.error('[team-submissions] 异常:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
