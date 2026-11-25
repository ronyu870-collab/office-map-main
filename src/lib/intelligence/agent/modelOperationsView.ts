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
  const contents = documents.map(document => {
    const wrapped = z.object({ content: z.unknown() }).safeParse(document);
    return wrapped.success ? wrapped.data.content : document;
  });
  const attempts = contents.flatMap(document => {
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
  const requests = contents.flatMap(value => {
    const parsed = z.object({ provider: z.literal('server_policy'), executionRoute: z.string().max(50), taskType: z.string().max(50),
      status: z.string().max(40), durationMs: z.number().nonnegative(), modelCalls: z.number().int().nonnegative().optional(),
      operations: z.object({ budgetRejection: z.string().nullable().optional() }).optional(),
    }).safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  const countBy = (values: string[]) => [...new Set(values)].map(value => ({ value, count: values.filter(v => v === value).length }));
  const durations = requests.map(r => r.durationMs).sort((a, b) => a - b);
  const execution = { requests: requests.length, completed: requests.filter(r => r.status === 'completed').length,
    fast: requests.filter(r => ['direct_response', 'deterministic_query'].includes(r.executionRoute)).length,
    routes: countBy(requests.map(r => r.executionRoute)), tasks: countBy(requests.map(r => r.taskType)),
    budgetReasons: countBy(requests.flatMap(r => r.operations?.budgetRejection ? [r.operations.budgetRejection] : [])),
    averageMs: durations.length ? durations.reduce((sum, n) => sum + n, 0) / durations.length : null,
    p95Ms: durations.length ? durations[Math.ceil(durations.length * .95) - 1] : null,
  };
  return { execution, calls: attempts.length, failures: attempts.filter(a => a.state === 'failed').length,
    fallbackCalls: attempts.filter(a => a.fallback).length, unknownUsage: attempts.filter(a => a.usageStatus === 'unknown_reserved').length,
    estimatedUsd: groups.reduce((n, g) => n + g.estimatedUsd, 0), actualBilledUsd: null,
    groups, errors: [...errors].map(([code, count]) => ({ code, count })) };
}
