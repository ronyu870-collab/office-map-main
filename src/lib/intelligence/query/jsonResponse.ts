import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';

const compress = promisify(gzip);
const MIN_BYTES = 16 * 1024;

/** Only negotiate a supported wire encoding. An explicit refusal overrides a
 * wildcard; malformed or contradictory gzip entries conservatively use JSON. */
function acceptsGzip(header: string | null): boolean {
  if (!header || header.length > 4096) return false;
  const values = header.split(',').map(value => {
    const [coding, ...parameters] = value.trim().toLowerCase().split(';').map(part => part.trim());
    const quality = parameters.length === 0 ? 1 : parameters.length === 1 && /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(parameters[0])
      ? Number(parameters[0].slice(2)) : 0;
    return { coding, quality };
  });
  const explicit = values.filter(value => value.coding === 'gzip');
  const allowed = explicit.length ? explicit : values.filter(value => value.coding === '*');
  return allowed.length > 0 && allowed.every(value => value.quality > 0);
}

/** Prepare only an already-authorized successful JSON response. HTTP clients
 * decode gzip before validating the existing SHA-256 delivery receipt, so the
 * full JSON, audit archive, source references and token stay byte-for-byte the
 * same. Callers must perform their final live authority check AFTER this await.
 * This is per-request compression, never a shared result or permission cache. */
export async function prepareQueryJsonResponse(request: Request, body: unknown, extraHeaders: Record<string, string>): Promise<Response> {
  const serialized = JSON.stringify(body), bytes = Buffer.from(serialized, 'utf8');
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
    Vary: `Authorization, ${IMPERSONATION_REQUEST_HEADER}, Accept-Encoding`, 'X-Content-Type-Options': 'nosniff', ...extraHeaders,
  });
  if (bytes.length >= MIN_BYTES && acceptsGzip(request.headers.get('accept-encoding'))) {
    const compressed = await compress(bytes, { level: 6 });
    if (compressed.length < bytes.length) {
      headers.set('Content-Encoding', 'gzip');
      return new Response(new Uint8Array(compressed), { status: 200, headers });
    }
  }
  return new Response(serialized, { status: 200, headers });
}
