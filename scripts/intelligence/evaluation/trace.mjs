import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function recordingAdapter(adapter, trace) {
  if (trace.environment !== 'synthetic-local') throw Error('SYNTHETIC_ONLY_RECORDING');
  return async (messages, signal, onDelta, options) => {
    const inputHash = hash({ messages, options });
    const output = await adapter(messages, signal, onDelta, options);
    // Allowlist output fields; no native reasoning/continuation or credentials.
    const safe = { provider: output.provider, model: output.model,
      message: { role: output.message.role, content: output.message.content,
        ...(output.message.calls ? { calls: output.message.calls } : {}) },
      inputTokens: output.inputTokens, outputTokens: output.outputTokens,
      cachedInputTokens: output.cachedInputTokens, reasoningTokens: output.reasoningTokens,
      providerRequestId: output.providerRequestId };
    trace.requests.push({ inputHash, schemaHash: hash(options.tools), output: safe });
    return output;
  };
}
export function replayAdapter(trace, contract) {
  if (trace.contractHash !== hash(contract)) throw Error('REPLAY_CONTRACT_MISMATCH');
  let cursor = 0;
  const adapter = async (messages, _signal, _onDelta, options) => {
    const entry = trace.requests[cursor];
    if (!entry || entry.inputHash !== hash({ messages, options }) || entry.schemaHash !== hash(options.tools)) throw Error('REPLAY_INPUT_MISMATCH');
    cursor++; return structuredClone(entry.output);
  };
  return { adapter, finish: () => { if (cursor !== trace.requests.length) throw Error('REPLAY_INCOMPLETE'); } };
}
