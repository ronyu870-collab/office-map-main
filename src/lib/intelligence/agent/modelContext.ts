import type { AgentMessage, AgentToolDefinition, ProviderId } from './modelProtocol';
import { toLegacyMessages } from './deepseekAdapter';

/** Never remove a call/result pair or touch provider-owned continuation state.
 * Old successful observations keep references and limits; the last two tool
 * observations retain their previews for the current decision. */
export function compactModelContext(messages: AgentMessage[]): AgentMessage[] {
  const toolIndexes = messages.flatMap((m, i) => m.role === 'tool' ? [i] : []);
  const compact = new Set(toolIndexes.slice(0, -2));
  return messages.map((message, i) => {
    if (!compact.has(i) || !message.content || message.content.length < 1200) return message;
    try {
      const value = JSON.parse(message.content);
      if (value.status !== 'ready' || !value.resultId) return message;
      const { preview: _preview, rows: _rows, summary: _summary, ...metadata } = value;
      void _preview; void _rows; void _summary;
      return { ...message, content: JSON.stringify({ ...metadata, observationCompacted: true }) };
    } catch { return message; }
  });
}

export function modelContextEnvelope(provider: ProviderId, messages: AgentMessage[], tools: AgentToolDefinition[]) {
  const wireMessages = provider === 'deepseek' ? toLegacyMessages(messages) : messages.map(m => {
    if (m.continuation) return { opaqueContinuationBytes: m.continuationBudgetBytes ?? 0 };
    return m.role === 'tool' ? { type: 'function_call_output', call_id: m.callId, output: m.content ?? '' }
      : { role: m.role === 'system' ? 'developer' : m.role, content: m.content,
        calls: m.calls?.map(c => ({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.arguments })) };
  });
  const messageBytes = Buffer.byteLength(JSON.stringify(wireMessages));
  const toolBytes = Buffer.byteLength(JSON.stringify(tools.map(t => provider === 'deepseek'
    ? { type: 'function', function: t } : { type: 'function', ...t, strict: false })));
  const opaqueBytes = provider === 'openai' ? messages.reduce((n, m) => n + (m.continuationBudgetBytes ?? 0), 0) : 0;
  // No compatible, calibrated tokenizer is installed. Keep an explicit byte
  // hard envelope rather than presenting a heuristic as exact token usage.
  return { inputUpperTokens: messageBytes + toolBytes + opaqueBytes + 1024,
    basis: 'wire_utf8_hard_envelope' as const, messageBytes, toolBytes, opaqueBytes,
    systemBytes: messages.filter(m => m.role === 'system').reduce((n, m) => n + Buffer.byteLength(m.content ?? ''), 0),
    observationBytes: messages.filter(m => m.role === 'tool').reduce((n, m) => n + Buffer.byteLength(m.content ?? ''), 0),
    toolCount: tools.length };
}
