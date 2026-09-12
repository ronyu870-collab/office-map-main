import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

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

async function auditAIParse(
  client: SupabaseClient,
  callerId: string,
  result: RequirementParseResult,
  requirementLength: number,
) {
  const { error } = await client.from('audit_logs').insert({
    user_id: callerId,
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

    void auditAIParse(context.client, context.caller.id, result, input.data.requirement.length);
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