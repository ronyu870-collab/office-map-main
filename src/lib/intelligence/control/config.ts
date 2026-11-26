import { z } from 'zod';

/** Shared by the editor and execution plane. No credentials, URLs or grants. */
export const providerSchema = z.enum(['deepseek', 'openai']);
export const modeSchema = z.enum(['quick', 'professional', 'deep']);
export const purposeSchema = z.enum(['agent', 'semantic_intent', 'synthesis']);
export const managementCapabilitySchema = z.enum(['operations:read', 'models:write', 'budgets:write', 'tests:run', 'emergency:write', 'grants:write']);
export type ManagementCapability = z.infer<typeof managementCapabilitySchema>;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/);
export const modelSchema = z.strictObject({
  id, provider: providerSchema, model: id, name: z.string().trim().min(1).max(120), enabled: z.boolean(),
  verification: z.enum(['unverified', 'verified', 'environment_legacy']), verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  tools: z.boolean(), structured: z.boolean(), streaming: z.boolean(), reasoning: z.boolean().nullable(), continuation: z.boolean(),
  contextLimit: z.number().int().positive().nullable(), outputLimit: z.number().int().positive().nullable(),
  inputRate: z.number().finite().min(0).max(1000), cachedInputRate: z.number().finite().min(0).max(1000).nullable(),
  outputRate: z.number().finite().min(0).max(1000), currency: z.literal('USD'),
  priceSource: z.string().trim().min(1).max(300), priceDate: z.iso.date().nullable(),
});
export type RegisteredModel = z.infer<typeof modelSchema>;
export const requestLimitsSchema = z.strictObject({
  tokens: z.number().int().min(1000).max(60000), usd: z.number().min(.000001).max(5),
  outputTokens: z.number().int().min(256).max(4096), timeoutMs: z.number().int().min(1000).max(18000),
  attempts: z.number().int().min(1).max(10), tools: z.number().int().min(1).max(12),
});
export type RequestLimits = z.infer<typeof requestLimitsSchema>;
export const modePolicySchema = z.strictObject({ model: id, fallback: id.nullable(), limits: requestLimitsSchema });
const scopeBudget = z.strictObject({dailyUsd:z.number().positive().max(10000),monthlyUsd:z.number().positive().max(100000)});
const budget = z.strictObject({ kind: z.enum(['observe', 'soft', 'hard']), dailyUsd: z.number().positive().max(10000), monthlyUsd: z.number().positive().max(100000) });
export const controlConfigSchema = z.strictObject({
  protocol: z.literal('ai-control-config/1'),
  modes: z.strictObject({ quick: modePolicySchema, professional: modePolicySchema, deep: modePolicySchema }),
  purposes: z.strictObject({ semantic_intent: id.nullable(), synthesis: id.nullable() }),
  budget: budget.extend({ testDailyUsd: z.number().nonnegative().max(100), warningPercent: z.array(z.number().int().min(1).max(100)).min(1).max(5),
    providerLimits:z.strictObject({deepseek:scopeBudget.nullable(),openai:scopeBudget.nullable()}).default({deepseek:null,openai:null}),
    modelLimits:z.record(id,scopeBudget).refine(v=>Object.keys(v).length<=100).default({}) }),
  // These restrict existing registered tools; they never confer data grants.
  disabledTools: z.array(z.string().regex(/^[a-z_]{1,100}$/)).max(80),
});
export type ControlConfig = z.infer<typeof controlConfigSchema>;
export type ControlSnapshot = { version: string; config: ControlConfig; models: RegisteredModel[] };
export type LiveControl = { revision: string; paused: boolean; disabledProviders: z.infer<typeof providerSchema>[]; disabledModels: string[] };

export function deploymentLimits(env: NodeJS.ProcessEnv = process.env): Omit<RequestLimits, 'attempts' | 'tools'> {
  const read = (name: string, fallback: number, min: number, max: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isFinite(value) || !env[name]?.trim() && env[name] !== undefined || value < min || value > max) throw new Error('CONTROL_INVALID_DEPLOYMENT');
    return value;
  };
  return { tokens: Math.floor(read('AI_AGENT_MAX_TOKENS', 60000, 1000, 60000)),
    usd: read('AI_AGENT_MAX_ESTIMATED_USD', .25, .000001, 5),
    outputTokens: Math.floor(read('AI_AGENT_MAX_OUTPUT_TOKENS', 1800, 256, 4096)),
    timeoutMs: Math.floor(read('AI_AGENT_PROVIDER_TIMEOUT_MS', 18000, 1000, 18000)) };
}

/** Validate against CURRENT registry and deployment boundaries, including rollback. */
export function validateControlConfig(raw: unknown, models: RegisteredModel[], env: NodeJS.ProcessEnv = process.env): ControlConfig {
  const value = controlConfigSchema.parse(raw), hard = deploymentLimits(env);
  const find = (key: string, needsTools: boolean, output: number) => {
    const model = models.find(m => m.id === key);
    if (!model || !model.enabled || model.verification === 'unverified' || !model.verifiedAt && model.verification === 'verified') throw new Error('CONTROL_MODEL_NOT_APPROVED');
    if (model.provider === 'deepseek' && (!env.DEEPSEEK_API_KEY?.trim() || !['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'].includes(model.model))
      || model.provider === 'openai' && (env.AI_OPENAI_ENABLED !== 'true' || !env.OPENAI_API_KEY?.trim() || !/^(?:gpt-|o[134](?:-|$))[a-zA-Z0-9._-]*$/.test(model.model))) throw new Error('CONTROL_PROVIDER_UNAVAILABLE');
    if (needsTools && (!model.tools || !model.streaming) || model.outputLimit !== null && output > model.outputLimit) throw new Error('CONTROL_MODEL_CAPABILITY');
    return model;
  };
  for (const [mode, policy] of Object.entries(value.modes)) {
    for (const key of ['tokens', 'usd', 'outputTokens', 'timeoutMs'] as const) if (policy.limits[key] > hard[key]) throw new Error('CONTROL_DEPLOYMENT_LIMIT');
    const modeHard = mode === 'quick' ? { attempts: 4, tools: 4 } : mode === 'professional' ? { attempts: 8, tools: 10 } : { attempts: 10, tools: 12 };
    if (policy.limits.attempts > modeHard.attempts || policy.limits.tools > modeHard.tools) throw new Error('CONTROL_DEPLOYMENT_LIMIT');
    find(policy.model, true, policy.limits.outputTokens);
    if (policy.fallback) {
      if (env.AI_MODEL_FALLBACK_ENABLED !== 'true') throw new Error('CONTROL_FALLBACK_DISABLED');
      const main = find(policy.model, true, policy.limits.outputTokens), alternate = find(policy.fallback, true, policy.limits.outputTokens);
      // The current runtime supports one cross-provider fallback, never a retry loop.
      if (main.provider === alternate.provider) throw new Error('CONTROL_FALLBACK_UNSUPPORTED');
    }
  }
  for (const [purpose, model] of Object.entries(value.purposes)) if (model) {
    const selected = find(model, purpose !== 'semantic_intent', Math.max(...Object.values(value.modes).map(m => m.limits.outputTokens)));
    if (purpose === 'semantic_intent' && !selected.structured) throw new Error('CONTROL_MODEL_CAPABILITY');
  }
  return value;
}

export function selectConfiguredModel(snapshot: ControlSnapshot, mode: z.infer<typeof modeSchema>, purpose: z.infer<typeof purposeSchema>, fallback: boolean) {
  const policy = snapshot.config.modes[mode];
  const key = fallback ? policy.fallback : purpose === 'agent' ? policy.model : snapshot.config.purposes[purpose] ?? policy.model;
  const found = snapshot.models.find(model => model.id === key);
  if (!found) throw new Error('CONTROL_MODEL_NOT_APPROVED');
  return found;
}
