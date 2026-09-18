import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { canViewLeaseTeamSubmissions } from '@/src/utils/accessControl';
import { annotateSubmitterActivity } from '@/src/utils/leaseSubmitterPrivacy';

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

    const callerRole = String(callerProfile?.role ?? '').trim().toLowerCase();
    const { data: accessSetting, error: settingError } = await supabaseAdmin
      .from('system_settings')
      .select('boolean_value')
      .eq('key', 'editor_can_view_lease_team_submissions')
      .maybeSingle();
    if (settingError) {
      console.error('[team-submissions] 查询团队成交开关失败:', settingError);
      return NextResponse.json({ error: '权限设置读取失败' }, { status: 500 });
    }

    const canAccessTeamSubmissions = callerRole === 'admin'
      || (callerRole === 'editor' && accessSetting?.boolean_value === true);

    if (req.nextUrl.searchParams.get('access') === '1') {
      return NextResponse.json(
        { canViewTeamSubmissions: canAccessTeamSubmissions },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (!canViewLeaseTeamSubmissions(callerProfile?.role) || !canAccessTeamSubmissions) {
      return NextResponse.json(
        { error: '团队成交汇总当前未向编辑用户开放', code: 'LEASE_TEAM_ACCESS_DISABLED' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Keep Supabase's standard Auth transport for getUser(token). A forced fetch
    // signal on that client can interfere with the caller-token validation path.
    // Only the team-wide service-role reads need the bounded transport below.
    const timedSupabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: timedFetch },
    });

    const activeUserIdsPromise = (async () => {
      try {
        const { data, error } = await timedSupabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (error) {
          console.warn('[team-submissions] 查询账号状态失败，将保留提交人姓名但无法判断账号状态:', { message: error.message });
          return null;
        }
        return new Set(
          data.users
            .filter((user) => isActiveUser(user.banned_until))
            .map((user) => user.id),
        );
      } catch (error) {
        console.warn('[team-submissions] 查询账号状态异常，将保留提交人姓名但无法判断账号状态:', { message: errorMessage(error) });
        return null;
      }
    })();

    const [transactionsResult, activeUserIds] = await Promise.all([
      timedSupabaseAdmin
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
    const submissions = annotateSubmitterActivity(
      transactionsResult.data ?? [],
      activeUserIds ?? new Set<string>(),
    );

    console.info('[team-submissions] 请求完成', {
      durationMs: Date.now() - startedAt,
      recordCount: submissions.length,
      identityStatus: activeUserIds ? 'verified' : 'unverified',
    });
    return NextResponse.json({
      submissions,
      submitterIdentityStatus: activeUserIds ? 'verified' : 'unverified',
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
