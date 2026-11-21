import { randomUUID } from 'node:crypto';
import type { ResponseInput, ResponseOutputItem, Response as OpenAIResponse } from 'openai/resources/responses/responses';
import { AGENT_TOOLS, ModelProviderError } from './modelProvider';
import type { AgentMessage, AgentCompletion, ModelAdapter } from './modelProtocol';

/** One instance per authenticated request: encrypted reasoning is opaque to the
 * orchestrator, never sent to another vendor or stored as conversation facts. */
export function createOpenAIAdapter(): ModelAdapter {
  const continuations = new Map<string, ResponseOutputItem[]>();
  return async (messages, signal, onDelta, options) => {
    if (!process.env.OPENAI_API_KEY?.trim()) throw new ModelProviderError('not_configured');
    if (!options?.model || !/^(?:gpt-|o[134](?:-|$))[a-zA-Z0-9._-]*$/.test(options.model)) throw new ModelProviderError('invalid_configuration');
    // Deliberately do not inherit OPENAI_BASE_URL, organization URLs or redirects.
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim(), baseURL: 'https://api.openai.com/v1',
      maxRetries: 0, timeout: options.timeoutMs, logLevel: 'off',
      fetch: (url, init) => fetch(url, { ...init, redirect: 'error', cache: 'no-store' }) });
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
    const input: ResponseInput = [];
    for (const message of messages) {
      const restored = message.continuation && continuations.get(message.continuation);
      if (restored) { input.push(...restored as ResponseInput); continue; }
      if (message.role === 'tool') {
        if (!message.callId) throw new ModelProviderError('invalid_response');
        input.push({ type: 'function_call_output', call_id: message.callId, output: message.content ?? '' });
      } else {
        if (message.content) input.push({ role: message.role === 'system' ? 'developer' : message.role, content: message.content });
        for (const call of message.calls ?? []) input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
      }
    }
    const body = { model: options.model, input, store: false, background: false,
      include: ['reasoning.encrypted_content' as const], max_output_tokens: options.maxOutputTokens,
      parallel_tool_calls: false, tool_choice: 'auto' as const,
      // Existing schemas contain optional fields. Server Zod validation remains
      // authoritative; do not let Responses silently rewrite them as required.
      tools: (options.tools ?? AGENT_TOOLS.map(t => t.function)).map(t => ({ type: 'function' as const,
        name: t.name, description: t.description, parameters: t.parameters, strict: false })) };
    let response: OpenAIResponse | undefined;
    try {
      if (onDelta) {
        const stream = await client.responses.create({ ...body, stream: true }, { signal: deadline });
        let bytes = 0, chars = 0;
        try {
          for await (const event of stream) {
            deadline.throwIfAborted();
            bytes += Buffer.byteLength(JSON.stringify(event));
            if (bytes > 1_000_000) throw new ModelProviderError('invalid_response');
            if (event.type === 'response.output_text.delta') {
              chars += event.delta.length;
              if (chars > 12000) throw new ModelProviderError('invalid_response');
              await onDelta(event.delta);
            } else if (event.type === 'response.completed') {
              if (response) throw new ModelProviderError('invalid_response');
              response = event.response;
            } else if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
              throw new ModelProviderError('invalid_response');
            }
          }
        } finally { stream.controller.abort(); }
        if (!response) throw new ModelProviderError('stream_interrupted');
      } else response = await client.responses.create({ ...body, stream: false }, { signal: deadline });
      deadline.throwIfAborted();
      if (response.status !== 'completed' || typeof response.id !== 'string' || !response.id || response.id.length > 150
        || typeof response.model !== 'string' || !response.model || response.model.length > 120 || !Array.isArray(response.output)
        || Buffer.byteLength(JSON.stringify(response)) > 1_000_000) throw new ModelProviderError('invalid_response');
      const calls: NonNullable<AgentMessage['calls']> = [], texts: string[] = [];
      for (const item of response.output) {
        if (!item || typeof item !== 'object') throw new ModelProviderError('invalid_response');
        if (item.type === 'function_call') {
          if (typeof item.call_id !== 'string' || !item.call_id || item.call_id.length > 128
            || typeof item.name !== 'string' || !item.name || item.name.length > 100
            || typeof item.arguments !== 'string' || item.arguments.length > 5000)
            throw new ModelProviderError('invalid_response');
          calls.push({ id: item.call_id, name: item.name, arguments: item.arguments });
        } else if (item.type === 'message') {
          if (item.status !== 'completed' || !Array.isArray(item.content)) throw new ModelProviderError('invalid_response');
          for (const part of item.content) {
            if (!part || part.type !== 'output_text' || typeof part.text !== 'string') throw new ModelProviderError('invalid_response');
            texts.push(part.text);
          }
        } else if (item.type !== 'reasoning') throw new ModelProviderError('invalid_response');
      }
      const text = texts.join('');
      if (calls.length > 8 || new Set(calls.map(c => c.id)).size !== calls.length || text.length > 12000 || !calls.length && !text.trim())
        throw new ModelProviderError('invalid_response');
      const continuation = randomUUID(); continuations.set(continuation, response.output);
      const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0 ? Number(n) : null;
      const result: AgentCompletion = { provider: 'openai', model: response.model,
        providerRequestId: response.id,
        inputTokens: count(response.usage?.input_tokens), outputTokens: count(response.usage?.output_tokens),
        cachedInputTokens: count(response.usage?.input_tokens_details?.cached_tokens),
        reasoningTokens: count(response.usage?.output_tokens_details?.reasoning_tokens),
        message: { role: 'assistant', content: text || null, ...(calls.length ? { calls } : {}), continuation,
          continuationBudgetBytes: Buffer.byteLength(JSON.stringify(response.output)) } };
      return result;
    } catch (error) {
      if (signal.aborted || error instanceof Error && error.message === 'QUERY_DENIED') throw error;
      if (error instanceof ModelProviderError) throw error;
      if (deadline.aborted || error instanceof OpenAI.APIConnectionTimeoutError) throw new ModelProviderError('timeout');
      if (error instanceof SyntaxError || error instanceof TypeError) throw new ModelProviderError('invalid_response');
      if (error instanceof OpenAI.APIError) {
        throw new ModelProviderError(error.status === 401 || error.status === 403 ? 'unauthorized'
          : error.status === 429 ? (error.code === 'insufficient_quota' ? 'payment_required' : 'rate_limited')
          : error.status === 404 ? 'model_not_found' : error.status === 402 ? 'payment_required'
          : error.status && error.status < 500 ? 'invalid_response' : 'provider_unavailable');
      }
      throw new ModelProviderError('provider_unavailable');
    }
  };
}
