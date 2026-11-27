'use client';

import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders, getImpersonationTargetUserId } from '@/src/services/impersonationHeaders';
import type { MarketAssetResearchPayload } from '@/src/app/map/model/marketAssetAnalytics';

export async function fetchMarketAssetResearch(names: readonly string[], period: number, signal: AbortSignal): Promise<MarketAssetResearchPayload> {
  const session = await getSessionFast();
  signal.throwIfAborted();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录状态已失效');
  const target = getImpersonationTargetUserId();
  const params = new URLSearchParams({ mode: 'research-assets', year: String(Math.floor(period / 4)), quarter: String(period % 4 + 1) });
  for (const name of names) params.append('submarket', name);
  const response = await fetch('/api/map/data?' + params, {
    headers: withImpersonationHeaders({ Authorization: 'Bearer ' + token, Accept: 'application/json' }),
    cache: 'no-store', signal,
  });
  if (!response.ok) throw new Error('市场分析暂不可用');
  const data = await response.json() as MarketAssetResearchPayload;
  const current = await getSessionFast();
  signal.throwIfAborted();
  if (current?.session?.access_token !== token || current?.user?.id !== session?.user?.id || target !== getImpersonationTargetUserId()) {
    throw new Error('登录身份已变化');
  }
  if (data.period !== period || !Array.isArray(data.assets) || (data.supplies !== null && !Array.isArray(data.supplies))
    || typeof data.demandAvailable !== 'boolean' || !data.demand) throw new Error('市场分析数据不完整');
  return data;
}


/** Reuse selected-building compare authorization and identity-scoped cache. */
export async function fetchRepresentativeBrochures(ids: readonly string[], signal: AbortSignal) {
  const session = await getSessionFast();
  signal.throwIfAborted();
  const token = session?.session?.access_token;
  if (!token || !session) throw new Error('登录状态已失效');
  const target = getImpersonationTargetUserId();
  const { fetchComparePayload } = await import('@/src/services/mapDataClient');
  const payload = await fetchComparePayload({ token, userId: session.user.id, role: session.role, targetUserId: target }, { scope: 'selected', ids });
  const current = await getSessionFast();
  signal.throwIfAborted();
  if (current?.session?.access_token !== token || current?.user?.id !== session.user.id || current?.role !== session.role || target !== getImpersonationTargetUserId()) {
    throw new Error('登录身份已变化');
  }
  const allowed = new Set(payload.buildings.map((row: { id?: unknown }) => row.id).filter((id: unknown): id is string => typeof id === 'string' && ids.includes(id)));
  return payload.brochures.filter((row: { building_id?: unknown }) => typeof row.building_id === 'string' && allowed.has(row.building_id));
}
