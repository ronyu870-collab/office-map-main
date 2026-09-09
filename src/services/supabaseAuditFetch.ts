import {
  reportSupabaseMutation,
  type SupabaseMutationNotice,
  type SupabaseMutationOperation,
} from '@/src/utils/auditMutationBridge';

const EXCLUDED_TABLES = new Set(['audit_logs', 'update_drafts']);
const READ_ONLY_RPCS = new Set([
  'get_all_tables',
  'get_table_columns',
  'get_all_memo_tags',
  'verify_backup_password',
  'admin_get_auth_audit_logs',
  'get_quarterly_submission_summary',
]);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function mergedHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

function bodyText(init?: RequestInit): string | null {
  const body = init?.body;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return null;
}

function isSessionIdOnlyMutation(body: string | null): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const keys = Object.keys(parsed as Record<string, unknown>);
    return keys.length === 1 && keys[0] === 'session_id';
  } catch {
    return false;
  }
}

function operationFor(method: string, headers: Headers): SupabaseMutationOperation {
  if (method === 'DELETE') return 'DELETE';
  if (method === 'PATCH' || method === 'PUT') return 'UPDATE';
  return (headers.get('prefer') || '').toLowerCase().includes('resolution=merge-duplicates') ? 'UPSERT' : 'INSERT';
}

function describeMutation(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  status: number,
): SupabaseMutationNotice | null {
  const method = requestMethod(input, init);
  if (!WRITE_METHODS.has(method)) return null;

  let url: URL;
  try { url = new URL(requestUrl(input), typeof window === 'undefined' ? 'https://local.invalid' : window.location.origin); }
  catch { return null; }

  const marker = '/rest/v1/';
  const index = url.pathname.indexOf(marker);
  if (index < 0) return null;
  const restPath = decodeURIComponent(url.pathname.slice(index + marker.length)).replace(/^\/+/, '');
  if (!restPath) return null;

  if (restPath.startsWith('rpc/')) {
    const rpcName = restPath.slice(4).split('/')[0];
    if (!rpcName || READ_ONLY_RPCS.has(rpcName)) return null;
    return {
      kind: 'rpc',
      target: rpcName,
      method: method as SupabaseMutationNotice['method'],
      operation: 'RPC',
      status,
      occurredAt: new Date().toISOString(),
    };
  }

  const table = restPath.split('/')[0];
  if (!table || EXCLUDED_TABLES.has(table)) return null;
  if (table === 'user_roles' && method === 'PATCH' && isSessionIdOnlyMutation(bodyText(init))) return null;

  const headers = mergedHeaders(input, init);
  return {
    kind: 'table',
    target: table,
    method: method as SupabaseMutationNotice['method'],
    operation: operationFor(method, headers),
    status,
    occurredAt: new Date().toISOString(),
  };
}

/**
 * Observes successful browser-side PostgREST writes without touching the request
 * or response body. The original response is returned before any audit parsing
 * runs; all coverage work is deferred to a microtask.
 */
export function createAuditAwareFetch(baseFetch?: typeof fetch): typeof fetch {
  const transport: typeof fetch = baseFetch ?? ((input, init) => globalThis.fetch(input, init));
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await transport(input, init);
    if (response.ok && typeof window !== 'undefined') {
      const status = response.status;
      queueMicrotask(() => {
        const notice = describeMutation(input, init, status);
        if (notice) reportSupabaseMutation(notice);
      });
    }
    return response;
  }) as typeof fetch;
}
