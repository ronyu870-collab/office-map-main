import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import type { RequirementVocabulary } from './requirementResolver';

export type IntelligenceContext = {
  client: SupabaseClient;
  caller: User;
  role: string;
  catalogScope: string;
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

  // Only already-authorized calls can reuse catalog data. A credential change
  // changes the key; the credential itself is never retained in the cache.
  const catalogScope = createHash('sha256').update(JSON.stringify([
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    identity.caller.id,
    identity.callerRole,
    identity.effectiveUserId,
    identity.effectiveRole,
    identity.isImpersonating,
    request.headers.get('authorization'),
  ])).digest('hex');

  return { client, caller: identity.caller, role: identity.effectiveRole, catalogScope };
}

export function isIntelligenceContext(value: IntelligenceContext | NextResponse): value is IntelligenceContext {
  return !(value instanceof NextResponse);
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

type VocabularyBuilding = { district?: string | null; submarket?: string | null; grade?: string | null };

export function recommendationVocabulary(rows: VocabularyBuilding[]): RequirementVocabulary {
  return {
    districts: unique(rows.map(row => row.district)),
    submarkets: unique(rows.map(row => row.submarket)),
    grades: unique(rows.map(row => row.grade)),
  };
}

export function latestRecommendationMetricPeriod(row?: { record_year?: number; record_quarter?: number } | null): string | null {
  return row?.record_year && row.record_quarter ? `${row.record_year} Q${row.record_quarter}` : null;
}

export function createIntelligenceRequestScope(request: Request) {
  const deadline = AbortSignal.timeout(26_000);
  const controller = new AbortController();
  return { deadline, signal: AbortSignal.any([request.signal, deadline, controller.signal]), close: () => controller.abort() };
}

export async function loadLatestRecommendationMetricPeriod(client: SupabaseClient, signal: AbortSignal) {
  const latestMetricResult = await client
    .from('building_metrics')
    .select('record_year,record_quarter')
    .order('record_year', { ascending: false })
    .order('record_quarter', { ascending: false })
    .limit(1)
    .abortSignal(signal)
    .maybeSingle();
  signal.throwIfAborted();
  return latestRecommendationMetricPeriod(latestMetricResult.data);
}
