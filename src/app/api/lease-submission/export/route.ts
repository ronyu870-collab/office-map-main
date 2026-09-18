import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 1000;
const MAX_ROWS = 100000;

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: '服务器配置异常' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const identityResult = await resolveEffectiveRequestIdentity(req, supabaseAdmin);
    if ('response' in identityResult) return identityResult.response;
    const { identity } = identityResult;
    if (identity.effectiveRole !== 'admin') {
      return NextResponse.json({ error: '权限不足，仅管理员可导出成交数据' }, { status: 403 });
    }

    const records: Array<Record<string, unknown>> = [];
    let from = 0;

    while (from < MAX_ROWS) {
      const { data, error } = await supabaseAdmin
        .from('lease_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error('[lease-export] 查询成交数据失败:', error);
        return NextResponse.json({ error: '导出数据查询失败' }, { status: 500 });
      }

      const page = (data ?? []) as Array<Record<string, unknown>>;
      records.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (records.length >= MAX_ROWS) {
      return NextResponse.json(
        { error: `成交数据超过 ${MAX_ROWS.toLocaleString('zh-CN')} 条，请联系管理员拆分导出` },
        { status: 413 },
      );
    }

    return NextResponse.json(
      { records, count: records.length },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[lease-export] 异常:', error);
    return NextResponse.json({ error: '导出失败，请稍后重试' }, { status: 500 });
  }
}
