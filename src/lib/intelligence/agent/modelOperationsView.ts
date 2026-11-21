import { z } from 'zod';

const attempt = z.object({ protocol: z.literal('agent-model-attempt/1'), provider: z.enum(['deepseek', 'openai']),
  mode: z.enum(['quick', 'professional', 'deep']), state: z.enum(['completed', 'failed']), model: z.string().max(120),
  errorCode: z.string().max(80).optional(), fallback: z.boolean(), durationMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  estimateUsd: z.number().finite().nonnegative(), usageStatus: z.enum(['provider_reported', 'unknown_reserved', 'not_sent']),
});
/** Browser-safe aggregation of already authorized, decrypted audit events only.
 * Never estimates an invoice or treats a missing usage report as zero tokens. */
export function summarizeModelOperations(documents: unknown[]) {
  const attempts = documents.flatMap(document => {
    const content = z.object({ content: z.unknown() }).safeParse(document);
    const value = attempt.safeParse(content.success ? content.data.content : document);
    return value.success ? [value.data] : [];
  });
  const groups = [...new Set(attempts.map(a => a.provider))].map(provider => {
    const rows = attempts.filter(a => a.provider === provider), known = rows.every(a => a.inputTokens !== null && a.outputTokens !== null && a.usageStatus === 'provider_reported');
    return { provider, calls: rows.length, failures: rows.filter(a => a.state === 'failed').length,
      inputTokens: known ? rows.reduce((n, a) => n + a.inputTokens!, 0) : null,
      outputTokens: known ? rows.reduce((n, a) => n + a.outputTokens!, 0) : null,
      durationMs: rows.reduce((n, a) => n + a.durationMs, 0), estimatedUsd: rows.reduce((n, a) => n + a.estimateUsd, 0) };
  });
  const errors = new Map<string, number>();
  for (const row of attempts) if (row.errorCode) errors.set(row.errorCode, (errors.get(row.errorCode) ?? 0) + 1);
  return { calls: attempts.length, failures: attempts.filter(a => a.state === 'failed').length,
    fallbackCalls: attempts.filter(a => a.fallback).length, unknownUsage: attempts.filter(a => a.usageStatus === 'unknown_reserved').length,
    estimatedUsd: groups.reduce((n, g) => n + g.estimatedUsd, 0), actualBilledUsd: null,
    groups, errors: [...errors].map(([code, count]) => ({ code, count })) };
}
