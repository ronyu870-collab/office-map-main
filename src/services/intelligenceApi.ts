import type { RequirementParseResult } from '@/src/lib/intelligence/requirementSchema';

export async function parseIntelligenceRequirement(
  requirement: string,
  accessToken: string,
): Promise<RequirementParseResult> {
  const response = await fetch('/api/intelligence/parse-requirement', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ requirement }),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => null) as (RequirementParseResult & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(payload?.error || '客户需求解析失败，请稍后重试');
  }
  if (!payload) throw new Error('客户需求解析返回为空，请重试');
  return payload;
}
