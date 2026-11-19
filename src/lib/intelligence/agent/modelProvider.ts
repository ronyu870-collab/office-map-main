import { z } from 'zod';
import { SPECIALIST_DATA_TOOLS } from './toolRegistry';

export type ModelToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ModelMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ModelToolCall[];
  tool_call_id?: string;
};
export type ModelCompletion = {
  model: string;
  message: ModelMessage;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId?: string;
};

export const DATA_TOOL = {
  type: 'function',
  function: {
    name: 'query_verified_real_estate',
    description: '查询高力国际北京区现有授权楼宇、季度租金、空置率、面积、跨季度比较、市场趋势与统计结果。可以连续调用获取不同市场和期间；不查询成交客户、私人合同或外部网页。先明确统计口径，缺少必要条件时让助手向用户澄清。',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: '要交给获权房地产可信查询引擎的完整中文问题；明确地区、指标、期间与必要筛选条件。' } },
      required: ['question'],
      additionalProperties: false,
    },
  },
} as const;

export const AGENT_TOOLS = [DATA_TOOL, ...SPECIALIST_DATA_TOOLS] as const;
export const DEFAULT_AGENT_MODEL = 'deepseek-flash';
const SUPPORTED_AGENT_MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash']);
function configuredModel(): string {
  const model = process.env.DEEPSEEK_CHAT_MODEL?.trim() || process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_AGENT_MODEL;
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
      tool_calls: z.array(z.object({
        id: z.string().min(1).max(128), type: z.literal('function'),
        function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(5000) }),
      })).max(8).optional(),
    }),
  })).length(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional() }).optional(),
});

export class ModelProviderError extends Error {
  constructor(public readonly code: 'not_configured' | 'invalid_configuration' | 'unauthorized' | 'payment_required'
    | 'model_not_found' | 'rate_limited' | 'timeout' | 'provider_unavailable' | 'invalid_response') {
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
  } catch { throw new ModelProviderError('invalid_response'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** One real DeepSeek completion; no mock or rule-generated text is substituted on failure. */
export async function completeWithDeepSeek(messages: ModelMessage[], signal: AbortSignal,
  onDelta?: (delta: string) => Promise<void>): Promise<ModelCompletion> {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new ModelProviderError('not_configured');
  const model = configuredModel();
  const url = providerUrl();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(18000)]);
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', cache: 'no-store', redirect: 'error', signal: deadline,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages, tools: AGENT_TOOLS, tool_choice: 'auto',
        thinking: { type: 'disabled' }, stream: !!onDelta,
        ...(onDelta ? { stream_options: { include_usage: true } } : {}), max_tokens: 1800 }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ModelProviderError(deadline.aborted ? 'timeout' : 'provider_unavailable');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ModelProviderError(response.status === 401 ? 'unauthorized'
      : response.status === 402 ? 'payment_required'
      : response.status === 404 ? 'model_not_found'
      : response.status === 429 ? 'rate_limited'
      : 'provider_unavailable');
  }
  if (onDelta) {
    const { parseDeepSeekStream } = await import('./modelStream');
    return parseDeepSeekStream(response, model, onDelta, deadline);
  }
  const parsed = responseSchema.safeParse(await boundedJson(response));
  if (!parsed.success) throw new ModelProviderError('invalid_response');
  const choice = parsed.data.choices[0], message = choice.message;
  if (!['stop', 'tool_calls'].includes(choice.finish_reason)
    || (choice.finish_reason === 'tool_calls' && !message.tool_calls?.length)
    || (!message.tool_calls?.length && !message.content?.trim())) throw new ModelProviderError('invalid_response');
  return { model: parsed.data.model || model,
    message: { role: 'assistant', content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) },
    inputTokens: parsed.data.usage?.prompt_tokens ?? null,
    outputTokens: parsed.data.usage?.completion_tokens ?? null,
    ...(parsed.data.id ? { providerRequestId: parsed.data.id } : {}),
  };
}

