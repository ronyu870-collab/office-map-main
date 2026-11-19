import { describe, expect, it } from 'vitest';
import { estimateAgentCostRange } from './agentCost';

describe('DeepSeek cost is a conservative non-billing planning range', () => {
  it('includes peak/off-peak and cached/uncached input for Flash', () => {
    expect(estimateAgentCostRange('deepseek-flash', 1_000_000, 1_000_000)).toMatchObject({
      minUsd: 0.603, maxUsd: 1.5, currency: 'USD', kind: 'planning_range_not_invoice',
    });
    expect(estimateAgentCostRange('deepseek-v4-flash', 1_000_000, 1_000_000)?.maxUsd).toBe(1.5);
  });
  it('conservatively bounds Pro with official published rates', () => {
    expect(estimateAgentCostRange('deepseek-v4-pro', 1_000_000, 1_000_000)).toMatchObject({
      minUsd: 2.002, maxUsd: 5.28,
    });
  });
  it('never guesses a bill for invalid usage or unknown model', () => {
    expect(estimateAgentCostRange('new-unpriced-model', 100, 10)).toBeNull();
    expect(estimateAgentCostRange('deepseek-flash', null, 20)).toBeNull();
    expect(estimateAgentCostRange('deepseek-flash', -1, 0)).toBeNull();
    expect(estimateAgentCostRange('deepseek-flash', Number.NaN, 2)).toBeNull();
  });
});
