/** 
 * Conservative 2026-11-19 USD planning range. This is NOT a DeepSeek bill.
 * Published official rates vary by peak hours and cache hits; a response may
 * omit cache-hit breakdown. Unknown / future model IDs yield no estimate.
 * Reference: https://api-docs.deepseek.com/quick_start/pricing/
 */
const USD_PER_MILLION = {
  flash: { inputLow: 0.003, inputHigh: 0.3, outputLow: 0.6, outputHigh: 1.2 },
  pro: { inputLow: 0.022, inputHigh: 1.32, outputLow: 1.98, outputHigh: 3.96 },
} as const;

export type AgentCostRange = {
  kind: 'planning_range_not_invoice';
  currency: 'USD';
  asOf: '2026-11-19';
  minUsd: number;
  maxUsd: number;
};

export function estimateAgentCostRange(
  model: string | null, inputTokens: number | null, outputTokens: number | null,
): AgentCostRange | null {
  const prices = model === 'deepseek-flash' || model === 'deepseek-v4-flash'
    ? USD_PER_MILLION.flash
    : model === 'deepseek-v4-pro' ? USD_PER_MILLION.pro : null;
  if (!prices || inputTokens === null || outputTokens === null
    || !Number.isSafeInteger(inputTokens) || inputTokens < 0
    || !Number.isSafeInteger(outputTokens) || outputTokens < 0) return null;
  const minUsd = (prices.inputLow * inputTokens + prices.outputLow * outputTokens) / 1e6;
  const maxUsd = (prices.inputHigh * inputTokens + prices.outputHigh * outputTokens) / 1e6;
  return { kind: 'planning_range_not_invoice', currency: 'USD', asOf: '2026-11-19',
    minUsd: Number(minUsd.toFixed(8)), maxUsd: Number(maxUsd.toFixed(8)) };
}
