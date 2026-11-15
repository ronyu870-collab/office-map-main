/** Browser Origin must match the actual HTTP Host, not Next's internal listener
 * hostname. Forwarded-Host is deliberately ignored. Browsers cannot set Host;
 * bearer authentication and current authorization are still independently required. */
export function isQuerySameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true; // Non-browser authenticated API clients.
  try {
    const url = new URL(request.url);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = request.headers.get('host');
    if (!host) return origin === url.origin;
    if (!/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) return false;
    return origin === new URL(`${url.protocol}//${host}`).origin;
  } catch { return false; }
}
