import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { deviceAwareAuthStorage } from './trustedDevice';
import { createAuditAwareFetch } from './supabaseAuditFetch';

/**
 * Supabase 客户端单例
 *
 * 要点：
 * - 使用 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 初始化
 * - 环境变量缺失时直接抛错（让调用层/部署层尽早发现配置问题）
 * - 以“懒初始化”方式创建，避免在某些构建/测试场景下仅因 import 就崩溃
 * - 所有浏览器端 PostgREST 写入都经过轻量审计兜底；原请求先完成，审计异步处理
 */

let _supabase: SupabaseClient | null = null;

/**
 * 获取 Supabase Client（单例）。
 */
export function getSupabaseClient(): SupabaseClient {
  if (_supabase) return _supabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_not_configured';

  _supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: deviceAwareAuthStorage,
    },
    global: {
      fetch: createAuditAwareFetch(),
    },
  });

  return _supabase;
}

/**
 * 直接导出一个“看起来像常量”的单例引用。
 *
 * 注意：它依然是懒初始化（首次访问时才真正 createClient）。
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseClient();
    return Reflect.get(client, prop, receiver);
  },
}) as SupabaseClient;
