import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createIsolatedRequestTiming } from '@/src/lib/server/isolatedRequestTiming';

import {
  IntelligenceAIError,
  parseRequirementWithDeepSeek,
} from '@/src/lib/intelligence/deepSeekRequirementParser';
import {
  buildRecommendationPlan,
  RECOMMENDATION_RANKING_VERSION,
  type RecommendationResponse,
} from '@/src/lib/intelligence/recommendationEngine';
import {
  buildRecommendationUniverse,
  loadRecommendationCatalog,
  loadRecommendationEvidence,
} from '@/src/lib/intelligence/recommendationServer';
import { RequirementParseInputSchema, type RequirementParseResult } from '@/src/lib/intelligence/requirementSchema';
import {
  normalizeRequirementAgainstVocabulary,
  resolveRequirementCapabilities,
} from '@/src/lib/intelligence/requirementResolver';
import {
  createIntelligenceRequestScope,
  isIntelligenceContext,
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
  try {
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
    if (error) {
      console.error('[audit][intelligence] AI_RECOMMENDATION write failed', error.code, error.message);
    }
  } catch (error) {
    console.error(
      '[audit][intelligence] AI_RECOMMENDATION write threw',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function POST(request: NextRequest) {
  const timing = createIsolatedRequestTiming(request);
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: '客户需求内容过长' }, { status: 413 });
  }

  const { signal, deadline, close } = createIntelligenceRequestScope(request);
  try {
    const context = await timing.measure('auth', () => requireIntelligenceAccess(request));
    if (!isIntelligenceContext(context)) return context;
    signal.throwIfAborted();
    const startedAt = Date.now();
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

    const catalog = loadRecommendationCatalog(context.client, context.catalogScope, signal);
    const facts = timing.measure('candidates', () => Promise.all([catalog, loadRecommendationEvidence(context.client, signal)]));
    const parsing = (async () => {
      const vocabulary = await timing.measure('vocabulary', async () => (await catalog).vocabulary);
      signal.throwIfAborted();
      const aiStartedAt = Date.now();
      const aiResult = await timing.measure('model', () => parseRequirementWithDeepSeek(input.data.requirement, vocabulary, signal));
      return {
        parsed: normalizeRequirementAgainstVocabulary(aiResult.parsed, vocabulary),
        meta: { ...aiResult.meta, durationMs: Date.now() - aiStartedAt },
      };
    })();

    const [[{ buildings }, evidence], ai] = await Promise.all([facts, parsing]);
    signal.throwIfAborted();

    const rankStarted = timing.start();
    const { latestMetricPeriod } = evidence;
    const universe = buildRecommendationUniverse(buildings, evidence);
    const result: RequirementParseResult = {
      ...ai,
      capabilities: resolveRequirementCapabilities(ai.parsed, { latestMetricPeriod }),
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

    timing.finish('rank', rankStarted);
    signal.throwIfAborted();
    const auditStarted = timing.start();
    await auditRecommendation(
      context.client,
      context.caller.id,
      result,
      response,
      input.data.requirement.length,
      Date.now() - startedAt,
    );
    timing.finish('audit', auditStarted);

    return timing.response(() => NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } }));
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    if (deadline.aborted) return NextResponse.json({ error: '推荐生成超时，请稍后重试' }, { status: 504 });
    if (error instanceof IntelligenceAIError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('[intelligence] recommend failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'AI 推荐生成失败，请稍后重试' }, { status: 500 });
  } finally {
    close();
  }
}
