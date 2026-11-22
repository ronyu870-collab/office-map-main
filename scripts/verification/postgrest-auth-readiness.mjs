/** Disposable integration stacks can issue a valid Auth JWT just ahead of the
 * Data API clock. Wait only for that exact readiness condition on a read;
 * never retry writes, expired tokens, role denials or other service failures. */
export async function waitForPostgrestAuth(probe, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await probe();
    if (response.status === 200 && !response.error) return;
    if (response.status !== 401 || response.error?.code !== 'PGRST303'
      || response.error?.message !== 'JWT issued at future') throw new Error('DISPOSABLE_AUTH_READINESS_REJECTED');
    if (attempt < 7) await pause(250);
  }
  throw new Error('DISPOSABLE_AUTH_CLOCK_NOT_READY');
}
