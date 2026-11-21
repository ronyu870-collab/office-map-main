/** Provider-neutral orchestration contract. Native wire payloads stay in adapters. */
export type AgentToolCall = { id: string; name: string; arguments: string };
export type AgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null;
  calls?: AgentToolCall[]; callId?: string;
  /** Request-local opaque adapter handle; never persisted or interpreted by tools. */
  continuation?: string;
  continuationBudgetBytes?: number;
};
export type ProviderId = 'deepseek' | 'openai';
export type AgentCompletion = {
  provider: ProviderId; model: string; message: AgentMessage;
  inputTokens: number | null; outputTokens: number | null;
  cachedInputTokens?: number | null; reasoningTokens?: number | null;
  providerRequestId?: string;
};
export type AgentToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
export type AdapterOptions = { model: string; maxOutputTokens: number; timeoutMs: number; tools?: AgentToolDefinition[] };
export type ModelAdapter = (messages: AgentMessage[], signal: AbortSignal,
  onDelta?: (delta: string) => Promise<void>, options?: AdapterOptions) => Promise<AgentCompletion>;

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
