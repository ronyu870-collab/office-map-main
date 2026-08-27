import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { canViewLeaseTeamSubmissions } from '@/src/utils/accessControl';
import { maskInactiveSubmitters } from '@/src/utils/leaseSubmitterPrivacy';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SUPABASE_REQUEST_TIMEOUT_MS = 10_000;

function timedFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS),
  });
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'TimeoutError'
    || error.name === 'AbortError'
    || error.message.toLowerCase().includes('timeout')
  );
}

function isActiveUser(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return true;
  const timestamp = new Date(bannedUntil).getTime();
  return Number.isNaN(timestamp) || timestamp <= Date.now();
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: timedFetch },
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

    // This endpoint uses the service role and therefore bypasses RLS. Authorization
    // must be checked explicitly before any team-wide data is queried.
    const { data: callerProfile, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id)
      .maybeSingle();

    if (roleError) {
      console.error('[team-submissions] 查询调用方角色失败:', roleError);
      return NextResponse.json({ error: '权限校验失败' }, { status: 500 });
    }
    if (!canViewLeaseTeamSubmissions(callerProfile?.role)) {
      return NextResponse.json({ error: '权限不足，只有编辑者和管理员可查看团队提交' }, { status: 403 });
    }

    const activeUserIdsPromise = (async () => {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (error) {
          console.warn('[team-submissions] 查询账号状态失败，将隐藏提交人身份:', { message: error.message });
          return null;
        }
        return new Set(
          data.users
            .filter((user) => isActiveUser(user.banned_until))
            .map((user) => user.id),
        );
      } catch (error) {
        console.warn('[team-submissions] 查询账号状态异常，将隐藏提交人身份:', { message: errorMessage(error) });
        return null;
      }
    })();

    const [transactionsResult, activeUserIds] = await Promise.all([
      supabaseAdmin
        .from('lease_transactions')
        .select('*')
        .gte('created_at', '2026-04-23T00:00:00Z')
        .order('created_at', { ascending: false })
        .limit(500),
      activeUserIdsPromise,
    ]);

    if (transactionsResult.error) {
      console.error('[team-submissions] 查询成交记录失败:', transactionsResult.error);
      return NextResponse.json({ error: '查询提交记录失败' }, { status: 500 });
    }
    const submissions = maskInactiveSubmitters(
      transactionsResult.data ?? [],
      activeUserIds ?? new Set<string>(),
    );

    console.info('[team-submissions] 请求完成', {
      durationMs: Date.now() - startedAt,
      recordCount: submissions.length,
      identityStatus: activeUserIds ? 'verified' : 'masked',
    });
    return NextResponse.json({
      submissions,
      submitterIdentityStatus: activeUserIds ? 'verified' : 'masked',
    });
  } catch (error) {
    const timedOut = isTimeoutError(error);
    console.error('[team-submissions] 异常:', {
      durationMs: Date.now() - startedAt,
      message: errorMessage(error),
    });
    return NextResponse.json(
      { error: timedOut ? '团队成交服务响应超时，请稍后重试' : '服务器内部错误' },
      { status: timedOut ? 504 : 500 },
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}
