import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { clearMapReadCache } from './mapReadCache';

export const DEFAULT_APP_ROLE = 'viewer' as const;

const AUTH_SESSION_CACHE_KEY = '__auth_session_cache';
const AUTH_SESSION_CACHE_VERSION = 2;
const AUTH_SESSION_CACHE_TTL_MS = 10 * 60 * 1000;
let sessionCacheGeneration = 0;
let pendingRealSession: Promise<AuthSessionResult | null> | null = null;
let pendingRestoredProfile: {
  session: Session;
  request: ReturnType<typeof fetchUserProfile>;
} | null = null;

function sameCredential(a: Session, b: Session): boolean {
  return a.user.id === b.user.id && a.access_token === b.access_token;
}

/** One read for one credential, even if the SDK emits an event during initialization. */
function readRestoredProfile(session: Session): ReturnType<typeof fetchUserProfile> {
  const read = () => fetchUserProfile(session.user.id, session.user.email ?? '');
  if (typeof window === 'undefined') return read();
  if (pendingRestoredProfile && sameCredential(pendingRestoredProfile.session, session)) {
    return pendingRestoredProfile.request;
  }
  const request = read().finally(() => {
    if (pendingRestoredProfile?.request === request) pendingRestoredProfile = null;
  });
  pendingRestoredProfile = { session, request };
  return request;
}

/**
 * 生成唯一会话标识符（UUID v4）
 */
function generateSessionId(): string {
  // 使用 crypto.randomUUID（Node.js 内置，符合 UUID v4 标准）
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // 备用方法（浏览器环境或旧版本 Node.js）
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * 更新用户的 session_id 到数据库
 */
async function updateSessionId(userId: string, sessionId: string | null): Promise<void> {
  const { error } = await supabase
    .from('user_roles')
    .update({ session_id: sessionId })
    .eq('user_id', userId);

  if (error) {
    console.error('更新 session_id 失败:', error.message);
    // 不抛出错误，降级处理（继续登录流程）
  }
}

export interface AuthSessionResult {
  user: User;
  session: Session;
  role: string;
  displayName: string; // full_name > chinese_name > email prefix
  sessionId: string; // 新增：会话标识符，用于单设备登录验证
}

interface CachedAuthSession {
  version: number;
  scope: string;
  timestamp: number;
  data: AuthSessionResult;
}

function getAuthCacheScope(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function readSessionCache(): AuthSessionResult | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = sessionStorage.getItem(AUTH_SESSION_CACHE_KEY);
    if (!cached) return null;

    const parsed = JSON.parse(cached) as Partial<CachedAuthSession>;
    const isValid =
      parsed.version === AUTH_SESSION_CACHE_VERSION &&
      parsed.scope === getAuthCacheScope() &&
      typeof parsed.timestamp === 'number' &&
      Date.now() - parsed.timestamp < AUTH_SESSION_CACHE_TTL_MS &&
      typeof parsed.data?.user?.id === 'string' &&
      typeof parsed.data?.session?.access_token === 'string';

    if (isValid) return parsed.data ?? null;

    // 旧版本或其他 Supabase 项目的缓存不能跨迁移继续使用。
    sessionStorage.removeItem(AUTH_SESSION_CACHE_KEY);
  } catch (error) {
    console.warn('读取会话缓存失败，已忽略旧缓存:', error);
    sessionStorage.removeItem(AUTH_SESSION_CACHE_KEY);
  }

  return null;
}

/** 一次查询同时拿 role + 姓名，避免两次请求 */
async function fetchUserProfile(
  userId: string,
  emailFallback: string,
  options: { failOnQueryError?: boolean } = {},
): Promise<{ role: string; displayName: string; sessionId: string; phone?: string | null }> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role, full_name, chinese_name, session_id, phone')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (options.failOnQueryError) {
      throw new Error(`user_roles 查询失败 [${error.code || 'UNKNOWN'}]: ${error.message}`);
    }
    return {
      role: DEFAULT_APP_ROLE,
      displayName: emailFallback.split('@')[0],
      sessionId: '',
      phone: undefined,
    };
  }

  const role = data?.role ? String(data.role).trim().toLowerCase() : DEFAULT_APP_ROLE;
  const displayName =
    (data?.full_name && String(data.full_name).trim()) ||
    (data?.chinese_name && String(data.chinese_name).trim()) ||
    emailFallback.split('@')[0];
  const sessionId = data?.session_id || '';

  return {
    role,
    displayName,
    sessionId,
    phone: data ? (data.phone ?? null) : undefined,
  };
}

export async function signInWithPassword(params: {
  email: string;
  password: string;
  phone: string;
}): Promise<AuthSessionResult> {
  const email = params.email?.trim();
  const password = params.password ?? '';
  const phone = params.phone?.trim();
  if (!email) throw new TypeError('signInWithPassword: email 不能为空');
  if (!password) throw new TypeError('signInWithPassword: password 不能为空');
  if (!phone || !/^\d{11}$/.test(phone)) throw new TypeError('signInWithPassword: 手机号必须为 11 位数字');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`登录失败：${error.message}`);
  if (!data.session || !data.user) throw new Error('登录失败：未返回有效的 session/user');

  const userId = data.user.id;
  const userEmail = data.user.email ?? '';
  let profile: Awaited<ReturnType<typeof fetchUserProfile>>;
  try {
    profile = await fetchUserProfile(userId, userEmail, { failOnQueryError: true });
  } catch (profileError) {
    try {
      const { error: localSignOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (localSignOutError) {
        console.error('[auth] 清理本地会话失败:', localSignOutError.message);
      }
    } catch (signOutError) {
      console.error('[auth] 清理本地会话异常:', signOutError);
    }
    clearSessionCache();
    console.error('[auth] 登录后读取 user_roles 失败:', profileError);
    throw new Error('登录验证已通过，但系统数据服务暂时不可用。请稍后重试，无需重置密码。');
  }

  // 邮箱和密码由 Supabase Auth 校验；手机号作为本系统的第三项登录凭据，必须与用户档案严格一致。
  // 资料查询失败会在上一步明确报系统服务异常；只有手机号不匹配才归类为凭据错误。
  if (profile.phone === undefined || profile.phone !== phone) {
    await supabase.auth.signOut({ scope: 'local' });
    clearSessionCache();
    throw new Error('登录失败：邮箱、手机号或密码不匹配');
  }

  const sessionId = generateSessionId();
  const { role, displayName } = profile;

  // 第三凭据验证通过后，再建立单设备会话状态。
  const sessionIdUpdate = updateSessionId(userId, sessionId);
  const metadataUpdate = supabase.auth.updateUser({
    data: { session_id: sessionId },
  });

  const [sessionIdSettled, metadataSettled] = await Promise.allSettled([
    sessionIdUpdate,
    metadataUpdate,
  ]);

  // 非关键操作失败仅日志记录，不阻断已完成三项凭据校验的登录。
  if (sessionIdSettled.status === 'rejected') console.error('更新 session_id 失败:', sessionIdSettled.reason);
  if (metadataSettled.status === 'rejected') console.error('更新 user metadata 失败:', metadataSettled.reason);

  const result = { user: data.user, session: data.session, role, displayName, sessionId };

  // 缓存预热：登录成功后立即写入缓存（跳转到首页后瞬间命中，无需再查库）
  prewarmSessionCache(result);

  return result;
}

export async function signOut(): Promise<void> {
  // 获取当前用户 ID
  const { data: { user } } = await supabase.auth.getUser();

  // 清除数据库中的 session_id（防止令牌重放攻击）
  if (user?.id) {
    await updateSessionId(user.id, null);
  }

  // 清除客户端缓存
  clearSessionCache();

  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(`登出失败：${error.message}`);
}

export async function getSession(): Promise<AuthSessionResult | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`获取会话失败：${error.message}`);
  if (!data.session) return null;

  const user = data.session.user;
  if (!user) return null;

  const { role, displayName, sessionId } = await readRestoredProfile(data.session);
  return { user, session: data.session, role, displayName, sessionId };
}

/**
 * 从中间件注入的 HTTP Headers 读取用户信息
 *
 * 优化策略：
 * 1. 优先从 Headers 读取用户信息（中间件已完成验证）
 * 2. 避免重复的数据库查询
 * 3. 如果 Headers 不存在，返回 null（降级到其他方法）
 */
export function getSessionFromHeaders(): AuthSessionResult | null {
  if (typeof window === 'undefined') {
    return null; // 服务端无法访问响应 Headers
  }

  try {
    // 注意：在客户端，我们无法直接访问响应 Headers
    // 这个函数主要用于服务端组件或通过其他方式传递的 Headers
    // 在实际使用中，Headers 信息会通过其他机制传递（如 cookies 或 props）
    return null;
  } catch (err) {
    console.warn('从 Headers 读取会话信息失败:', err);
    return null;
  }
}

/**
 * 获取真实的管理员会话（不含模拟拦截，避免递归）
 */
async function getRealSession(): Promise<AuthSessionResult | null> {
  // Never share request state across server renders or users.
  if (typeof window === 'undefined') return getSession();
  const headerSession = getSessionFromHeaders();
  if (headerSession) return headerSession;

  const cached = readSessionCache();
  if (cached) return cached;

  if (pendingRealSession) return pendingRealSession;
  const generation = sessionCacheGeneration;
  const request = getSession().then((session) => {
    // A sign-out, token refresh or account change supersedes this response.
    if (generation !== sessionCacheGeneration) return getRealSession();
    if (session) writeSessionCache(session);
    return session;
  });
  pendingRealSession = request;
  try {
    return await request;
  } finally {
    if (pendingRealSession === request) pendingRealSession = null;
  }
}

/**
 * 快速获取会话信息（优先使用缓存）
 *
 * 优化策略：
 * 1. 首次调用时查询数据库并缓存到 sessionStorage
 * 2. 后续调用直接从缓存读取，避免重复查询
 * 3. 缓存有效期：10 分钟（从 5 分钟增加到 10 分钟）
 * 4. 优先尝试从 Headers 读取（如果可用）
 *
 * 模拟模式：
 * - 如果 sessionStorage 中存在 __impersonation_state，返回被模拟用户的合成 session
 * - session.access_token 始终保留真实管理员 JWT；调用应用 API 时必须通过
 *   impersonationHeaders 显式携带被模拟 user id，由服务端验证管理员身份后再解析有效权限
 */
export async function getSessionFast(): Promise<AuthSessionResult | null> {
  // --- 模拟模式拦截 ---
  if (typeof window !== 'undefined') {
    try {
      const impRaw = sessionStorage.getItem('__impersonation_state');
      if (impRaw) {
        const imp = JSON.parse(impRaw);
        if (imp.targetUserId && imp.targetEmail) {
          const realSession = await getRealSession();
          if (realSession) {
            // 使用邮箱前缀作为 full_name，与 update_drafts.user_name 一致
            const emailPrefix = imp.targetEmail ? imp.targetEmail.split('@')[0] : '';
            return {
              user: {
                ...realSession.user,
                id: imp.targetUserId,
                email: imp.targetEmail,
                user_metadata: {
                  ...realSession.user.user_metadata,
                  full_name: emailPrefix,
                },
              } as User,
              session: realSession.session, // 真实管理员 JWT；服务端授权上下文由受验证的 impersonation header 决定
              role: imp.targetRole || 'viewer',
              displayName: imp.targetDisplayName || imp.targetEmail.split('@')[0],
              sessionId: realSession.sessionId,
            };
          }
        }
      }
    } catch {
      // fall through to normal flow
    }
  }
  // --- 模拟模式拦截结束 ---

  return getRealSession();
}

/**
 * 缓存预热：将会话信息写入缓存
 *
 * 使用场景：
 * 1. 登录成功后立即写入缓存
 * 2. 数据库查询后更新缓存
 */
export function prewarmSessionCache(session: AuthSessionResult): void {
  if (typeof window === 'undefined') return;
  sessionCacheGeneration += 1;
  pendingRealSession = null;
  pendingRestoredProfile = null;
  clearMapReadCache();
  writeSessionCache(session);
}

function writeSessionCache(session: AuthSessionResult): void {
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(AUTH_SESSION_CACHE_KEY, JSON.stringify({
        version: AUTH_SESSION_CACHE_VERSION,
        scope: getAuthCacheScope(),
        data: session,
        timestamp: Date.now(),
      }));
    } catch (err) {
      console.warn('缓存预热失败:', err);
    }
  }
}

/**
 * 清除会话缓存
 *
 * 使用场景：
 * 1. 登出时清除缓存
 * 2. 角色变更时清除缓存
 *
 * 优化：不在其他场景清除缓存（如普通页面切换）
 */
export function clearSessionCache({ reuseInFlightProfileFor }: { reuseInFlightProfileFor?: Session } = {}): void {
  if (typeof window !== 'undefined') {
    sessionCacheGeneration += 1;
    pendingRealSession = null;
    if (!reuseInFlightProfileFor || !pendingRestoredProfile ||
        !sameCredential(pendingRestoredProfile.session, reuseInFlightProfileFor)) {
      pendingRestoredProfile = null;
    }
    clearMapReadCache();
    try {
      sessionStorage.removeItem(AUTH_SESSION_CACHE_KEY);
    } catch (err) {
      console.warn('清除会话缓存失败:', err);
    }
  }
}

/**
 * 清除会话缓存（仅在角色变更时调用）
 *
 * 使用场景：
 * - 管理员修改用户角色后
 * - 用户权限发生变化时
 */
export function clearSessionCacheOnRoleChange(): void {
  clearSessionCache();
}

/**
 * 清除模拟状态缓存
 *
 * 使用场景：
 * - 退出模拟模式时
 */
export function clearImpersonationCache(): void {
  if (typeof window !== 'undefined') {
    clearMapReadCache();
    try {
      sessionStorage.removeItem('__impersonation_state');
    } catch {}
  }
}

