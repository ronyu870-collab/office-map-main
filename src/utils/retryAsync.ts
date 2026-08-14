export interface RetryAsyncOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 1_000;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a short-lived client request with bounded exponential backoff.
 * The default total wait is below one second (250ms + 500ms).
 */
export async function retryAsync<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryAsyncOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < attempts && (options.shouldRetry?.(error, attempt) ?? true);
      if (!canRetry) throw error;
      await wait(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
    }
  }

  throw lastError;
}
