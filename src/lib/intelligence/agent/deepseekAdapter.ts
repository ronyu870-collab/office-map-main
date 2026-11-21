import { completeWithDeepSeek } from './modelProvider';
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
  return async (messages, signal, onDelta, options) => fromLegacyCompletion(
    await invoke(toLegacyMessages(messages), signal, onDelta, options));
}
