import type { LeaseCompanyDeal, LeaseCompanyLookupResult } from '@/src/app/lease-submission/leaseCompanyLookup';
import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';

async function getHeaders(signal: AbortSignal) {
  const session = await getSessionFast();
  signal.throwIfAborted();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录状态已失效');
  return withImpersonationHeaders({ Authorization: `Bearer ${token}` });
}

async function request<T>(mode: 'suggestions' | 'recent', company: string, signal: AbortSignal): Promise<T> {
  const params = new URLSearchParams({ company_lookup: mode, company });
  const response = await fetch(`/api/lease-transactions/read?${params}`, {
    headers: await getHeaders(signal),
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('暂时无法查询企业成交');
  return response.json();
}

export function searchLeaseCompanies(company: string, signal: AbortSignal) {
  return request<LeaseCompanyLookupResult>('suggestions', company, signal);
}

export function readRecentCompanyDeals(company: string, signal: AbortSignal) {
  return request<{ records: LeaseCompanyDeal[] }>('recent', company, signal);
}

export async function scheduleLeaseCompanyAssessment(company: string, signal: AbortSignal) {
  const headers = new Headers(await getHeaders(signal));
  headers.set('Content-Type', 'application/json');
  await fetch('/api/lease-transactions/read?company_lookup=assess', {
    method: 'POST', headers, body: JSON.stringify({ company }), signal, cache: 'no-store',
  });
}
