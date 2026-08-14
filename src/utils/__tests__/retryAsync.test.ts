import { describe, expect, it, vi } from 'vitest';

import { retryAsync } from '../retryAsync';

describe('retryAsync', () => {
  it('returns immediately when the first attempt succeeds', async () => {
    const operation = vi.fn().mockResolvedValue('ok');

    await expect(retryAsync(operation, { baseDelayMs: 0 })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and returns the successful result', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('recovered');

    await expect(retryAsync(operation, { attempts: 3, baseDelayMs: 0 })).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('stops after the configured number of attempts', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(retryAsync(operation, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow('offline');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('honors shouldRetry for non-transient errors', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('forbidden'));

    await expect(retryAsync(operation, {
      attempts: 3,
      baseDelayMs: 0,
      shouldRetry: () => false,
    })).rejects.toThrow('forbidden');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
