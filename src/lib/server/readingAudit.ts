import type { EffectiveRequestIdentity } from './impersonationAuth';
import { readingEntry } from '@/src/utils/readingAuditContext';
/** Client context is attribution only. Authorization always comes from the resolved identity. */
export function readingAuditContext(request: Request, identity: EffectiveRequestIdentity, fallback = 'unknown') {
  const origin=request.headers.get('x-reading-origin-id');
  const id = request.headers.get('x-reading-id');
  return {
    entry: readingEntry(request.headers.get('x-reading-entry') ?? fallback),
    ...(id && /^[0-9a-f-]{36}$/i.test(id) ? { correlation_id: id } : {}),
    ...(origin && /^[0-9a-f-]{36}$/i.test(origin)?{origin_request_id:origin}:{}),
    effective_user_id: identity.effectiveUserId, is_impersonating: identity.isImpersonating,
  };
}
