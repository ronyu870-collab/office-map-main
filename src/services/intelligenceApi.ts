import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import type { RecommendationResponse } from '@/src/lib/intelligence/recommendationEngine';
import type { RequirementParseResult } from '@/src/lib/intelligence/requirementSchema';

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error || fallback);
  if (!payload) throw new Error(`${fallback}：返回为空`);
  return payload;
}

export async function parseIntelligenceRequirement(
  requirement: string,
  accessToken: string,
): Promise<RequirementParseResult> {
  const response = await fetch('/api/intelligence/parse-requirement', {
    method: 'POST',
    headers: withImpersonationHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    }),
    body: JSON.stringify({ requirement }),
    cache: 'no-store',
  });
  return readJson<RequirementParseResult>(response, '客户需求解析失败，请稍后重试');
}

export async function recommendIntelligenceBuildings(
  requirement: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<RecommendationResponse> {
  const response = await fetch('/api/intelligence/recommend', {
    method: 'POST',
    headers: withImpersonationHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    }),
    body: JSON.stringify({ requirement }),
    cache: 'no-store',
    signal,
  });
  return readJson<RecommendationResponse>(response, 'AI 推荐生成失败，请稍后重试');
}
