import { z } from 'zod';
import { ModelProviderError, type ModelCompletion, type ModelToolCall } from './modelProvider';

const toolDeltaSchema = z.object({
  index: z.number().int().min(0).max(7),
  id: z.string().max(128).optional(),
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string().max(100).optional(),
    arguments: z.string().max(5000).optional(),
  }).optional(),
});
const chunkSchema = z.object({
  id: z.string().min(1).max(150),
  model: z.string().min(1).max(120),
  choices: z.array(z.object({
    index: z.number().int().min(0).max(0),
    delta: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(toolDeltaSchema).max(8).optional(),
    }),
    finish_reason: z.string().nullable().optional(),
  })).max(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).nullable().optional(),
});
const MAX_STREAM_BYTES = 1_000_000;
const MAX_ASSISTANT_CHARS = 12_000;
const MAX_EVENT_BYTES = 128_000;

type ToolAccumulator = { id: string; name: string; arguments: string };

/** Read official DeepSeek Chat Completions SSE with bounded text and indexed
 * native tool-call argument fragments. Tool results and model text are never
 * invented, and the stream is only complete after the vendor's [DONE] frame. */
export async function parseDeepSeekStream(
  response: Response, requestedModel: string,
  onDelta: (text: string) => Promise<void>, signal: AbortSignal,
): Promise<ModelCompletion> {
  if (!response.body) throw new ModelProviderError('invalid_response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const observedTools = new Map<number, ToolAccumulator>();
  let buffer = '', totalBytes = 0, text = '', finishReason: string | null = null;
  let completed = false;
  const accounting: { usage: { prompt_tokens?: number; completion_tokens?: number } | null } = { usage: null };
  let providerRequestId = '', actualModel = requestedModel;
  const consume = async (raw: string) => {
    const lines = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());
    if (!lines.length) return;
    const data = lines.join('\n');
    if (data === '[DONE]') { completed = true; return; }
    if (completed) throw new ModelProviderError('invalid_response');
    const parsed = chunkSchema.safeParse(JSON.parse(data));
    if (!parsed.success) throw new ModelProviderError('invalid_response');
    const frame = parsed.data;
    if (providerRequestId && providerRequestId !== frame.id) throw new ModelProviderError('invalid_response');
    providerRequestId = frame.id;
    actualModel = frame.model;
    if (frame.usage) accounting.usage = frame.usage;
    const choice = frame.choices[0];
    // DeepSeek's stream_options.include_usage sends a final accounting frame
    // with choices=[] before [DONE]. This is not a model text/tool delta.
    if (!choice) {
      if (!frame.usage) throw new ModelProviderError('invalid_response');
      return;
    }
    if (choice.finish_reason) {
      if (finishReason && finishReason !== choice.finish_reason) throw new ModelProviderError('invalid_response');
      finishReason = choice.finish_reason;
    }
    if (choice.delta.content) {
      if (text.length + choice.delta.content.length > MAX_ASSISTANT_CHARS) throw new ModelProviderError('invalid_response');
      text += choice.delta.content;
      await onDelta(choice.delta.content);
    }
    for (const delta of choice.delta.tool_calls ?? []) {
      let entry = observedTools.get(delta.index);
      if (!entry) { entry = { id: '', name: '', arguments: '' }; observedTools.set(delta.index, entry); }
      if (delta.id) {
        if (entry.id && entry.id !== delta.id) throw new ModelProviderError('invalid_response');
        entry.id = delta.id;
      }
      if (delta.function?.name) {
        if (entry.name && entry.name !== delta.function.name) throw new ModelProviderError('invalid_response');
        entry.name = delta.function.name;
      }
      entry.arguments += delta.function?.arguments ?? '';
      if (entry.arguments.length > 5000) throw new ModelProviderError('invalid_response');
    }
  };
  try {
    while (!completed) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      if (totalBytes > MAX_STREAM_BYTES) throw new ModelProviderError('invalid_response');
      buffer += decoder.decode(part.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      if (Buffer.byteLength(buffer, 'utf8') > MAX_EVENT_BYTES && !buffer.includes('\n\n'))
        throw new ModelProviderError('invalid_response');
      for (let index = buffer.indexOf('\n\n'); index !== -1; index = buffer.indexOf('\n\n')) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        await consume(raw);
        if (completed) break;
      }
    }
    if (!completed) throw new ModelProviderError('stream_interrupted');
    if (!finishReason || !providerRequestId) throw new ModelProviderError('invalid_response');
    const tools: ModelToolCall[] = Array.from(observedTools).sort((a, b) => a[0] - b[0]).map(([, value]) => {
      if (!value.id || !value.name || !value.arguments) throw new ModelProviderError('invalid_response');
      return { id: value.id, type: 'function', function: { name: value.name, arguments: value.arguments } };
    });
    if (finishReason !== 'stop' && finishReason !== 'tool_calls') throw new ModelProviderError('invalid_response');
    if (finishReason === 'tool_calls' && !tools.length || finishReason === 'stop' && (!text.trim() || tools.length))
      throw new ModelProviderError('invalid_response');
    return {
      model: actualModel, providerRequestId,
      message: { role: 'assistant', content: text || null, ...(tools.length ? { tool_calls: tools } : {}) },
      inputTokens: accounting.usage?.prompt_tokens ?? null, outputTokens: accounting.usage?.completion_tokens ?? null,
    };
  } catch (error) {
    if (signal.aborted) {
      if (signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError')
        throw new ModelProviderError('timeout');
      throw error;
    }
    if (error instanceof Error && error.message === 'QUERY_DENIED') throw error;
    if (error instanceof ModelProviderError) throw error;
    throw new ModelProviderError('invalid_response');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
