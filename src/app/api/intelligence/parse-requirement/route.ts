import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import {
  IntelligenceAIError,
  parseRequirementWithDeepSeek,
} from '@/src/lib/intelligence/deepSeekRequirementParser';
import {
  RequirementParseInputSchema,
  type RequirementParseResult,
} from '@/src/lib/intelligence/requirementSchema';
import {
  normalizeRequirementAgainstVocabulary,
  resolveRequirementCapabilities,
  type RequirementVocabulary,
} from '@/src/lib/intelligence/requirementResolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES = 8 * 1024;

type IntelligenceContext = {
  client: SupabaseClient;
  caller: User;
  role: string;
};

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Server misconfiguration');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function requireIntelligenceAccess(request: NextRequest): Promise<IntelligenceContext | NextResponse> {
  let client: SupabaseClient;
  try {
    client = createAdminClient();
  } catch {
    return NextResponse.json({ error: '服务端认证配置缺失' }, { status: 500 });
  }

  const accessToken = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return NextResponse.json({ error: '未认证' }, { status: 401 });

  const { data: { user: caller }, error: authError } = await client.auth.getUser(accessToken);
  if (authError || !caller) return NextResponse.json({ error: '登录状态已失效' }, { status: 401 });

  const { data: roleRow, error: roleError } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .maybeSingle();

  if (roleError || !roleRow?.role || !isIntelligencePreviewEnabled(roleRow.role)) {
    return NextResponse.json({ error: '当前账号未开放 Intelligence Preview' }, { status: 403 });
  }

  return { client, caller, role: roleRow.role };
}

function isIntelligenceContext(value: IntelligenceContext | NextResponse): value is IntelligenceContext {
  return !(value instanceof NextResponse);
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

async function loadVocabularyAndPeriod(client: SupabaseClient) {
  const [buildingsResult, latestMetricResult] = await Promise.all([
    client
      .from('buildings')
      .select('district,submarket,grade')
      .eq('is_active', true)
      .limit(2000),
    client
      .from('building_metrics')
      .select('record_year,record_quarter')
      .order('record_year', { ascending: false })
      .order('record_quarter', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (buildingsResult.error) throw new Error(`读取楼宇词表失败：${buildingsResult.error.message}`);

  const rows = buildingsResult.data ?? [];
  const vocabulary: RequirementVocabulary = {
    districts: unique(rows.map(row => row.district)),
    submarkets: unique(rows.map(row => row.submarket)),
    grades: unique(rows.map(row => row.grade)),
  };

  const latestMetric = latestMetricResult.data;
  const latestMetricPeriod = latestMetric?.record_year && latestMetric?.record_quarter
    ? `${latestMetric.record_year} Q${latestMetric.record_quarter}`
    : null;

  return { vocabulary, latestMetricPeriod };
}

async function auditAIParse(
  client: SupabaseClient,
  caller: User,
  result: RequirementParseResult,
  requirementLength: number,
) {
  const { error } = await client.from('audit_logs').insert({
    user_id: caller.id,
    action_type: 'AI_REQUIREMENT_PARSE',
    module: 'intelligence',
    target_name: '客户需求结构化解析',
    duration_ms: result.meta.durationMs,
    details: {
      model: result.meta.model,
      input_tokens: result.meta.inputTokens,
      output_tokens: result.meta.outputTokens,
      requirement_length: requirementLength,
      capability_statuses: result.capabilities.map(item => ({ key: item.key, status: item.status })),
    },
  });
  if (error) console.warn('[intelligence] AI 解析审计写入失败', error.code, error.message);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: '客户需求内容过长' }, { status: 413 });
  }

  const context = await requireIntelligenceAccess(request);
  if (!isIntelligenceContext(context)) return context;

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: '客户需求内容过长' }, { status: 413 });

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
    }

    const input = RequirementParseInputSchema.safeParse(json);
    if (!input.success) {
      return NextResponse.json({ error: input.error.issues[0]?.message || '客户需求格式无效' }, { status: 400 });
    }

    const { vocabulary, latestMetricPeriod } = await loadVocabularyAndPeriod(context.client);
    const startedAt = Date.now();
    const aiResult = await parseRequirementWithDeepSeek(input.data.requirement, vocabulary);
    const parsed = normalizeRequirementAgainstVocabulary(aiResult.parsed, vocabulary);
    const capabilities = resolveRequirementCapabilities(parsed, { latestMetricPeriod });

    const result: RequirementParseResult = {
      parsed,
      capabilities,
      meta: {
        ...aiResult.meta,
        durationMs: Date.now() - startedAt,
      },
    };

    void auditAIParse(context.client, context.caller, result, input.data.requirement.length);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof IntelligenceAIError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('[intelligence] parse-requirement failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '客户需求解析失败，请稍后重试' }, { status: 500 });
  }
}
