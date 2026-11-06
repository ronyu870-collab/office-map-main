import { setTimeout as pause } from 'node:timers/promises';

const statuses = new Set([408, 429, 500, 502, 503, 504]);
const codes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
function transient(error, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  const status = Number(error.status);
  if (status >= 400 && status <= 599) return statuses.has(status);
  return codes.has(error.code) || error.name === 'TimeoutError' ||
    transient(error.cause, seen) || transient(error.originalError, seen);
}
// Only repeat read operations. Permission, integrity and local disk errors must
// fail immediately; create-only writes are never retried here.
export async function retryRead(action) {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (attempt === 2 || !transient(error)) throw error;
      console.error(JSON.stringify({ stage: 'source-read', code: 'TRANSIENT_READ_RETRY', attempt: attempt + 2, maxAttempts: 3 }));
      await pause([250, 1000][attempt]);
    }
  }
}
