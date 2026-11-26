import { randomUUID } from 'node:crypto';
import { completeWithDeepSeek, ModelProviderError } from './modelProvider';
import type { AgentCompletion, AgentMessage, ModelAdapter } from './modelProtocol';

/** Only for the existing DeepSeek adapter and previously registered test providers. */
export function fromLegacyCompletion(value: import('./modelProvider').ModelCompletion): AgentCompletion {
  return { ...value, provider: 'deepseek', message: { role: value.message.role,
    content: value.message.content, ...(value.message.tool_calls ? { calls: value.message.tool_calls.map(c => ({
      id: c.id, name: c.function.name, arguments: c.function.arguments })) } : {}) } };
}
export function toLegacyMessages(messages: AgentMessage[]): import('./modelProvider').ModelMessage[] {
  return messages.map(m => ({ role: m.role, content: m.content,
    ...(m.calls ? { tool_calls: m.calls.map(c => ({ id: c.id, type: 'function' as const,
      function: { name: c.name, arguments: c.arguments } })) } : {}),
    ...(m.callId ? { tool_call_id: m.callId } : {}) }));
}

export function createDeepSeekAdapter(invoke: typeof completeWithDeepSeek = completeWithDeepSeek): ModelAdapter {
  const continuations = new Map<string, { model: string; reasoning: string }>();
  return async (messages, signal, onDelta, options) => {
    const wire = toLegacyMessages(messages);
    if (options?.reasoningEffort && options.tools?.length !== 0) {
      for (const [index, message] of messages.entries()) {
        if (message.continuation?.startsWith('deepseek:')) {
          const saved = continuations.get(message.continuation);
          if (!saved) throw new ModelProviderError('invalid_response');
          if (saved.model === options.model) wire[index].reasoning_content = saved.reasoning;
        }
        // Server-issued recovery calls and alternate-provider calls have no
        // DeepSeek reasoning to restore. Keep the native tool pair complete.
        if (message.calls?.length) wire[index].reasoning_content ??= '';
      }
    }
    const result = await invoke(wire, signal, onDelta, options);
    const completion = fromLegacyCompletion(result);
    if (options?.reasoningEffort && completion.message.calls?.length) {
      const reasoning = result.message.reasoning_content;
      if (typeof reasoning !== 'string') throw new ModelProviderError('invalid_response');
      const handle = 'deepseek:' + randomUUID();
      continuations.set(handle, { model: options.model, reasoning });
      completion.message.continuation = handle;
      completion.message.continuationBudgetBytes = Buffer.byteLength(JSON.stringify({ reasoning_content: reasoning }));
    }
    return completion;
  };
}
