import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const checks: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};
  let allHealthy = true;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey || !supabaseSecretKey) {
    return NextResponse.json(
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
      { status: 503 },
    );
  }

  // 1. Supabase Database
  try {
    const t0 = Date.now();
    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from('buildings').select('id').limit(1);
    const latency = Date.now() - t0;
    if (error) {
      checks.database = { ok: false, latencyMs: latency, error: error.message };
      allHealthy = false;
    } else {
      checks.database = { ok: true, latencyMs: latency };
    }
  } catch (e) {
    checks.database = { ok: false, latencyMs: 0, error: String(e) };
    allHealthy = false;
  }

  // 2. Supabase Auth
  try {
    const t0 = Date.now();
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.auth.getSession();
    const latency = Date.now() - t0;
    if (error) {
      checks.auth = { ok: false, latencyMs: latency, error: error.message };
      allHealthy = false;
    } else {
      checks.auth = { ok: true, latencyMs: latency };
    }
  } catch (e) {
    checks.auth = { ok: false, latencyMs: 0, error: String(e) };
    allHealthy = false;
  }

  const status = allHealthy ? 200 : 503;

  return NextResponse.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status }
  );
}
