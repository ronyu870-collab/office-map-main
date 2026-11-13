import type { CandidatePage } from '@/src/lib/leaseExpiry/contracts';
import { withImpersonationHeaders } from './impersonationHeaders';
import { LeaseReviewError } from './leaseExpiryApi';

export async function listLeaseExpiries(token: string, page: number, signal?: AbortSignal): Promise<CandidatePage> {
  const response = await fetch(`/api/lease-transactions/expiry?page=${page}&scope=window`, {
    signal, cache: 'no-store', headers: withImpersonationHeaders({ Authorization: `Bearer ${token}` }),
  });
  const body = await response.json();
  if (!response.ok) throw new LeaseReviewError(body.error || '到期记录读取失败，请重试', response.status);
  return body;
}
