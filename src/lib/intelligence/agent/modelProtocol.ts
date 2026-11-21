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
