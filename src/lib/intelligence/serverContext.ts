import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import type { RequirementVocabulary } from './requirementResolver';

export type IntelligenceContext = {
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

export async function requireIntelligenceAccess(request: NextRequest): Promise<IntelligenceContext | NextResponse> {
  let client: SupabaseClient;
  try {
    client = createAdminClient();
  } catch {
    return NextResponse.json({ error: '服务端认证配置缺失' }, { status: 500 });
  }

  const identityResult = await resolveEffectiveRequestIdentity(request, client);
  if ('response' in identityResult) return identityResult.response;
  const { identity } = identityResult;

  if (!identity.effectiveRole || !isIntelligencePreviewEnabled(identity.effectiveRole)) {
    return NextResponse.json({ error: '当前账号未开放 Intelligence Preview' }, { status: 403 });
  }

  return { client, caller: identity.caller, role: identity.effectiveRole };
}

export function isIntelligenceContext(value: IntelligenceContext | NextResponse): value is IntelligenceContext {
  return !(value instanceof NextResponse);
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export async function loadVocabularyAndPeriod(client: SupabaseClient) {
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
