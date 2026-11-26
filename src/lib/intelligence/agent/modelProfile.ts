import { z } from 'zod';
/** Server-owned workload profile. Does not grant access to source content. A
 * scoped workload never inherits the ordinary Agent's tools or fallback. */
export const scopedModelProfileSchema = z.strictObject({
  provider: z.enum(['deepseek', 'openai']), model: z.string().trim().min(1).max(100),
  maxTokens: z.number().int().min(1000).max(60000), maxOutputTokens: z.number().int().min(256).max(4096),
  timeoutMs: z.number().int().min(1000).max(18000), maxUsd: z.number().min(.000001).max(5),
  inputRate: z.number().positive().max(1000), outputRate: z.number().positive().max(1000),
});
export type ScopedModelProfile = z.infer<typeof scopedModelProfileSchema>;
