import { z } from 'zod';
import { SPECIALIST_DATA_TOOLS, WORKSET_TOOLS, PRESENTATION_TOOLS } from './toolRegistry';

export type ModelToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ModelMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ModelToolCall[];
  tool_call_id?: string;
  /** Native DeepSeek wire field. Keep within the request-local adapter. */
  reasoning_content?: string;
};
export type ModelCompletion = {
  model: string;
  message: ModelMessage;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  providerRequestId?: string;
};

export const DATA_TOOL = {
  type: 'function',
  function: {
    name: 'query_verified_real_estate',
    description: '旧版兼容只读自然语言查询。仅用于用户使用最新有效季度、楼宇名字消歧或多轮模糊条件等尚无法转换成结构化参数的场景；明确范围与季度优先使用专业结构化工具。已弃用，不再新增调用场景。',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: '要交给获权房地产可信查询引擎的完整中文问题；明确地区、指标、期间与必要筛选条件。' } },
      required: ['question'],
      additionalProperties: false,
    },
  },
} as const;

export const AGENT_TOOLS = [DATA_TOOL, ...SPECIALIST_DATA_TOOLS, ...WORKSET_TOOLS, ...PRESENTATION_TOOLS] as const;
export const DEFAULT_AGENT_MODEL = 'deepseek-flash';
export const MAX_DEEPSEEK_REASONING_CHARS = 120_000;
const SUPPORTED_AGENT_MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash']);
export function deepSeekModelForMode(mode?: 'quick' | 'professional' | 'deep', env: NodeJS.ProcessEnv = process.env) {
  const modeModel = mode && env[`DEEPSEEK_CHAT_MODEL_${mode.toUpperCase()}`]?.trim();
  return { model: modeModel || env.DEEPSEEK_CHAT_MODEL?.trim() || env.DEEPSEEK_MODEL?.trim() || DEFAULT_AGENT_MODEL,
    thinkingConfigured: !!modeModel && mode !== 'quick' };
}
function configuredModel(): string {
  const { model } = deepSeekModelForMode();
  if (!SUPPORTED_AGENT_MODELS.has(model)) throw new ModelProviderError('invalid_configuration');
  return model;
}

const responseSchema = z.object({
  id: z.string().min(1).max(150).optional(),
  model: z.string().min(1).max(120).optional(),
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({
      role: z.literal('assistant'),
      content: z.string().nullable().optional(),
      reasoning_content: z.string().max(MAX_DEEPSEEK_REASONING_CHARS).nullable().optional(),
      tool_calls: z.array(z.object({
        id: z.string().min(1).max(128), type: z.literal('function'),
        function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(5000) }),
      })).max(8).optional(),
    }),
  })).length(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),prompt_cache_hit_tokens:z.number().int().nonnegative().optional(),completion_tokens_details:z.object({reasoning_tokens:z.number().int().nonnegative().optional()}).optional() }).optional(),
});

export class ModelProviderError extends Error {
  constructor(public readonly code: 'not_configured' | 'invalid_configuration' | 'unauthorized' | 'payment_required'
    | 'model_not_found' | 'rate_limited' | 'timeout' | 'provider_unavailable' | 'invalid_response' | 'stream_interrupted'
    | 'budget_exceeded' | 'disclosure_denied', public readonly budgetReason?: 'global_daily' | 'global_monthly' | 'provider_daily' | 'provider_monthly' | 'model_daily' | 'model_monthly' | 'test_daily' | 'account_admission' | 'admission_service_unavailable' | 'attempt_limit' | 'token_reservation' | 'cost_reservation' | 'actual_token_limit' | 'actual_cost_limit') {
    super('AGENT_MODEL_' + code.toUpperCase());
  }
}

function providerUrl(): string {
  const value = process.env.DEEPSEEK_API_BASE_URL?.trim() || 'https://api.deepseek.com';
  let url: URL;
  try { url = new URL(value); } catch { throw new ModelProviderError('invalid_configuration'); }
  if (url.protocol !== 'https:' || url.hostname !== 'api.deepseek.com'
    || url.username || url.password || url.search || url.hash
    || !['/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new ModelProviderError('invalid_configuration');
  }
  return url.toString().replace(/\/$/, '') + '/chat/completions';
}

/** Publication eligibility is distinct from an API key merely being present.
 * Local protocol-test providers are not production DeepSeek agents. */
export function deepseekAgentConfigured(): boolean {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) return false;
  try { configuredModel(); providerUrl(); return true; }
  catch { return false; }
}

async function boundedJson(response: Response, maximum = 160000): Promise<unknown> {
  if (!response.body) throw new ModelProviderError('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new ModelProviderError('invalid_response');
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** One real DeepSeek completion; no mock or rule-generated text is substituted on failure. */
export async function completeWithDeepSeek(messages: ModelMessage[], signal: AbortSignal,
  onDelta?: (delta: string) => Promise<void>, options?: import('./modelProtocol').AdapterOptions): Promise<ModelCompletion> {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new ModelProviderError('not_configured');
  const model = options?.model ?? configuredModel();
  if (!SUPPORTED_AGENT_MODELS.has(model)) throw new ModelProviderError('invalid_configuration');
  const url = providerUrl();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(options?.timeoutMs ?? 18000)]);
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', cache: 'no-store', redirect: 'error', signal: deadline,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages, ...(!options?.tools || options.tools.length ? { tools: options?.tools?.map(tool => ({ type: 'function', function: tool })) ?? AGENT_TOOLS, tool_choice: 'auto' } : {}),
        ...(options?.responseFormat ? { response_format: { type: options.responseFormat }, ...(!options.reasoningEffort ? { temperature: 0 } : {}) } : {}),
        thinking: { type: options?.reasoningEffort ? 'enabled' : 'disabled' },
        ...(options?.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}), stream: !!onDelta,
        ...(onDelta ? { stream_options: { include_usage: true } } : {}), max_tokens: options?.maxOutputTokens ?? 1800 }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ModelProviderError(deadline.aborted ? 'timeout' : 'provider_unavailable');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ModelProviderError(response.status === 401 || response.status === 403 ? 'unauthorized'
      : response.status === 402 ? 'payment_required'
      : response.status === 404 ? 'model_not_found'
      : response.status === 429 ? 'rate_limited'
      : 'provider_unavailable');
  }
  if (onDelta) {
    const { parseDeepSeekStream } = await import('./modelStream');
    return parseDeepSeekStream(response, model, onDelta, deadline);
  }
  let body: unknown;
  try {
    body = await boundedJson(response, options?.maxResponseBytes ?? (options?.reasoningEffort ? 1_000_000 : undefined));
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ModelProviderError(deadline.aborted ? 'timeout' : 'invalid_response');
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new ModelProviderError('invalid_response');
  const choice = parsed.data.choices[0], message = choice.message;
  if (!['stop', 'tool_calls'].includes(choice.finish_reason)
    || (choice.finish_reason === 'tool_calls' && !message.tool_calls?.length)
    || (choice.finish_reason === 'stop' && (message.tool_calls?.length || !message.content?.trim()))) throw new ModelProviderError('invalid_response');
  return { model: parsed.data.model || model,
    message: { role: 'assistant', content: message.content ?? null,
      ...(message.tool_calls?.length && typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}),
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) },
    inputTokens: parsed.data.usage?.prompt_tokens ?? null,
    outputTokens: parsed.data.usage?.completion_tokens ?? null,
    ...(parsed.data.usage?.prompt_cache_hit_tokens!==undefined?{cachedInputTokens:parsed.data.usage.prompt_cache_hit_tokens}:{}),
    ...(parsed.data.usage?.completion_tokens_details?.reasoning_tokens!==undefined?{reasoningTokens:parsed.data.usage.completion_tokens_details.reasoning_tokens}:{}),
    ...(parsed.data.id ? { providerRequestId: parsed.data.id } : {}),
  };
}

