import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export const IMPERSONATION_REQUEST_HEADER = 'x-colliers-impersonate-user';

export type EffectiveRequestIdentity = {
  caller: User;
  callerRole: string;
  effectiveUserId: string;
  effectiveRole: string;
  isImpersonating: boolean;
  targetEmail: string | null;
  targetDisplayName: string | null;
};

type IdentityResult =
  | { identity: EffectiveRequestIdentity }
  | { response: NextResponse };

function normalizedRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export async function resolveEffectiveRequestIdentity(
  request: Request,
  client: SupabaseClient,
): Promise<IdentityResult> {
  const accessToken = (request.headers.get('authorization') ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!accessToken) {
    return { response: NextResponse.json({ error: '未提供认证 Token' }, { status: 401 }) };
  }

  const { data: { user: caller }, error: authError } = await client.auth.getUser(accessToken);
  if (authError || !caller) {
    return { response: NextResponse.json({ error: '登录状态已失效，请重新登录' }, { status: 401 }) };
  }

  const { data: callerProfile, error: callerRoleError } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .maybeSingle();
  if (callerRoleError) {
    return { response: NextResponse.json({ error: '权限校验失败' }, { status: 500 }) };
  }

  const callerRole = normalizedRole(callerProfile?.role);
  const targetUserId = request.headers.get(IMPERSONATION_REQUEST_HEADER)?.trim() || null;

  if (!targetUserId) {
    return {
      identity: {
        caller,
        callerRole,
        effectiveUserId: caller.id,
        effectiveRole: callerRole,
        isImpersonating: false,
        targetEmail: null,
        targetDisplayName: null,
      },
    };
  }

  // Only a real admin session may project another user's authorization context.
  // If a stale or forged header appears on any non-admin session, fail closed.
  if (callerRole !== 'admin') {
    return {
      response: NextResponse.json(
        { error: '用户模拟状态无效，请退出模拟后重试' },
        { status: 403 },
      ),
    };
  }

  const { data: targetProfile, error: targetError } = await client
    .from('user_roles')
    .select('user_id,role,email,chinese_name,full_name')
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (targetError) {
    return { response: NextResponse.json({ error: '模拟用户权限校验失败' }, { status: 500 }) };
  }
  if (!targetProfile?.user_id) {
    return {
      response: NextResponse.json(
        { error: '被模拟用户不存在或已被删除，请结束模拟' },
        { status: 403 },
      ),
    };
  }

  const effectiveRole = normalizedRole(targetProfile.role);
  const displayName =
    (typeof targetProfile.chinese_name === 'string' && targetProfile.chinese_name.trim())
    || (typeof targetProfile.full_name === 'string' && targetProfile.full_name.trim())
    || (typeof targetProfile.email === 'string' && targetProfile.email.trim())
    || targetProfile.user_id;

  return {
    identity: {
      caller,
      callerRole,
      effectiveUserId: targetProfile.user_id,
      effectiveRole,
      isImpersonating: true,
      targetEmail: typeof targetProfile.email === 'string' ? targetProfile.email : null,
      targetDisplayName: displayName,
    },
  };
}

export function denyImpersonatedMutation(identity: EffectiveRequestIdentity): NextResponse | null {
  if (!identity.isImpersonating) return null;
  return NextResponse.json(
    { error: '用户模拟为只读模式，不能执行写入、删除或管理操作' },
    { status: 403 },
  );
}
