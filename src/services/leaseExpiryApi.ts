import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import type { CandidatePage, Review, SaveReview } from '@/src/lib/leaseExpiry/contracts';
export class LeaseReviewError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(token: string, suffix: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/intelligence/lease-expiry${suffix}`, {
    ...init, cache: 'no-store', headers: withImpersonationHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
  });
  const body = await response.json();
  if (!response.ok) throw new LeaseReviewError(body.error || '请求未完成，请重试', response.status);
  return body as T;
}
export function listLeaseReviews(token: string, page: number, query: string, scope: string, signal?: AbortSignal) {
  return request<CandidatePage>(token, `?${new URLSearchParams({ page: String(page), query, scope })}`, { signal });
}
export function saveLeaseReview(token: string, input: SaveReview) {
  return request<Review>(token, '', { method: 'POST', body: JSON.stringify(input) });
}
