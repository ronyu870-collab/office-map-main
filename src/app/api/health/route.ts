import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type HealthCheck = {
  ok: boolean;
  latencyMs: number;
  code?: string;
  error?: string;
};

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
};

function healthJson(
  body: Record<string, unknown>,
  status: number,
) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

async function checkDataApi(
  supabaseUrl: string,
  supabaseSecretKey: string,
): Promise<HealthCheck> {
  const startedAt = Date.now();
  try {
    // 健康检查只做一次真实探测，不参与 supabase-js 的自动重试。
    // 这样故障能尽快暴露，也避免健康检查在连接池紧张时进一步放大压力。
    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { retry: false },
    });

    // 登录成功后必须读取 user_roles 做手机号/角色校验，所以健康检查直接覆盖登录关键路径。
    const { error } = await supabase
      .from('user_roles')
      .select('user_id')
      .limit(1);

    const latencyMs = Date.now() - startedAt;
    if (error) {
      return {
        ok: false,
        latencyMs,
        code: error.code || undefined,
        error: error.message,
      };
    }

    return { ok: true, latencyMs };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkAuth(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<HealthCheck> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);

  try {
    // getSession() 可能只读取本地状态，不能作为远端 Auth 健康检查。
    // GoTrue 官方健康端点才真正覆盖 Auth 服务。
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`,
      {
        method: 'GET',
        headers: { apikey: supabaseKey },
        cache: 'no-store',
        signal: controller.signal,
      },
    );

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        latencyMs,
        code: String(response.status),
        error: `Auth health check returned HTTP ${response.status}`,
      };
    }

    return { ok: true, latencyMs };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey || !supabaseSecretKey) {
    return healthJson(
      {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        checks: {
          configuration: {
            ok: false,
            latencyMs: 0,
            error: '缺少 Supabase 环境变量',
          },
        },
      },
      503,
    );
  }

  const [database, auth] = await Promise.all([
    checkDataApi(supabaseUrl, supabaseSecretKey),
    checkAuth(supabaseUrl, supabaseKey),
  ]);

  const allHealthy = database.ok && auth.ok;

  return healthJson(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: { database, auth },
    },
    allHealthy ? 200 : 503,
  );
}
