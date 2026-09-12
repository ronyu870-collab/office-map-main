import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  IntelligenceAIError,
  parseRequirementWithDeepSeek,
} from '@/src/lib/intelligence/deepSeekRequirementParser';
import {
  buildRecommendationPlan,
  RECOMMENDATION_RANKING_VERSION,
  type RecommendationResponse,
} from '@/src/lib/intelligence/recommendationEngine';
import { loadRecommendationUniverse } from '@/src/lib/intelligence/recommendationServer';
import { RequirementParseInputSchema, type RequirementParseResult } from '@/src/lib/intelligence/requirementSchema';
import {
  normalizeRequirementAgainstVocabulary,
  resolveRequirementCapabilities,
} from '@/src/lib/intelligence/requirementResolver';
import {
  isIntelligenceContext,
  loadVocabularyAndPeriod,
  requireIntelligenceAccess,
} from '@/src/lib/intelligence/serverContext';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES = 8 * 1024;
const MAX_RETURNED_RECOMMENDATIONS = 50;

async function auditRecommendation(
  client: SupabaseClient,
  callerId: string,
  result: RequirementParseResult,
  response: RecommendationResponse,
  requirementLength: number,
  totalDurationMs: number,
) {
  const { error } = await client.from('audit_logs').insert({
    user_id: callerId,
    action_type: 'AI_RECOMMENDATION',
    module: 'intelligence',
    target_name: 'AI选址推荐',
    duration_ms: totalDurationMs,
    details: {
      model: result.meta.model,
      input_tokens: result.meta.inputTokens,
      output_tokens: result.meta.outputTokens,
      requirement_length: requirementLength,
      candidate_count: response.plan.candidateCount,
      returned_count: response.meta.returnedCount,
      ranking_version: response.meta.rankingVersion,
      capability_statuses: result.capabilities.map(item => ({ key: item.key, status: item.status })),
    },
  });
  if (error) console.warn('[intelligence] 推荐审计写入失败', error.code, error.message);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: '客户需求内容过长' }, { status: 413 });
  }

  const context = await requireIntelligenceAccess(request);
  if (!isIntelligenceContext(context)) return context;

  const startedAt = Date.now();
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

    const [{ vocabulary, latestMetricPeriod }, universe] = await Promise.all([
      loadVocabularyAndPeriod(context.client),
      loadRecommendationUniverse(context.client),
    ]);

    const aiStartedAt = Date.now();
    const aiResult = await parseRequirementWithDeepSeek(input.data.requirement, vocabulary);
    const parsed = normalizeRequirementAgainstVocabulary(aiResult.parsed, vocabulary);
    const capabilities = resolveRequirementCapabilities(parsed, { latestMetricPeriod });

    const result: RequirementParseResult = {
      parsed,
      capabilities,
      meta: {
        ...aiResult.meta,
        durationMs: Date.now() - aiStartedAt,
      },
    };

    const fullPlan = buildRecommendationPlan(result, input.data.requirement, universe);
    const returnedRecommendations = fullPlan.recommendations.slice(0, MAX_RETURNED_RECOMMENDATIONS);
    const response: RecommendationResponse = {
      plan: {
        ...fullPlan,
        recommendations: returnedRecommendations,
      },
      meta: {
        generatedAt: new Date().toISOString(),
        universeCount: universe.length,
        latestMetricPeriod,
        returnedCount: returnedRecommendations.length,
        rankingVersion: RECOMMENDATION_RANKING_VERSION,
      },
    };

    void auditRecommendation(
      context.client,
      context.caller.id,
      result,
      response,
      input.data.requirement.length,
      Date.now() - startedAt,
    );

    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof IntelligenceAIError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('[intelligence] recommend failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'AI 推荐生成失败，请稍后重试' }, { status: 500 });
  }
}
