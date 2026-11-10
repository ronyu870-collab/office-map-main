'use client';

import { getSessionFast } from '@/src/services/Auth';
import { IMPERSONATION_REQUEST_HEADER, withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import { readMapDataWithCache } from './mapReadCache';
import { clearCompareSnapshot, readCompareSnapshot } from './compareSnapshot';
import type { CompareReadSlice } from '@/src/lib/compareReadContract';

type JsonObject = Record<string, any>;
export type CompareReadIdentity = { token: string; userId: string; role: string; targetUserId: string | null };
class MapDataRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function getMapRequest(path: string) {
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new MapDataRequestError('未登录，无法读取地图数据', 401);

  const headers = withImpersonationHeaders({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  });
  const load = async () => {
    const response = await fetch(path, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new MapDataRequestError(typeof payload.error === 'string' ? payload.error : '地图数据读取失败', response.status);
    }
    return payload as JsonObject;
  };
  // Include real credentials and effective identity; impersonation never shares results.
  const identity = { token, userId: session.user.id, role: session.role, targetUserId: headers.get(IMPERSONATION_REQUEST_HEADER) };
  const scope = () => JSON.stringify([process.env.NEXT_PUBLIC_SUPABASE_URL, identity, Array.from(headers.entries())]);
  return { scope, load, identity, sessionExpiresAt: session.session.expires_at ? session.session.expires_at * 1000 : undefined };
}

async function fetchMapJson(path: string, reuseSnapshot = false): Promise<JsonObject> {
  const { scope, load } = await getMapRequest(path);
  return reuseSnapshot ? readMapDataWithCache(scope(), path, load) : load();
}

export async function fetchMapBuildingPayload(metrics: 'latest' | 'all' = 'latest') {
  const payload = await fetchMapJson(`/api/map/data?mode=map&metrics=${metrics}`, true);
  return {
    buildings: Array.isArray(payload.buildings) ? payload.buildings : [],
    displayOverrides: Array.isArray(payload.display_overrides) ? payload.display_overrides : [],
  };
}

export async function fetchFutureSupplyPayload() {
  const payload = await fetchMapJson('/api/map/data?mode=future&include_pending=1', true);
  return Array.isArray(payload.future_supplies) ? payload.future_supplies : [];
}

export async function fetchComparePayload(expected?: CompareReadIdentity, slice?: CompareReadSlice) {
  const params = new URLSearchParams({ mode: 'compare' });
  if (slice) params.set('scope', slice.scope);
  if (slice?.scope === 'selected') for (const id of [...new Set(slice.ids)].sort()) params.append('id', id);
  const path = `/api/map/data?${params}`;
  const { scope, load, identity, sessionExpiresAt } = await getMapRequest(path);
  if (expected && (expected.token !== identity.token || expected.userId !== identity.userId ||
    expected.role !== identity.role || expected.targetUserId !== identity.targetUserId)) {
    throw new MapDataRequestError('登录身份已变化，请重试', 403);
  }
  if (sessionExpiresAt !== undefined && sessionExpiresAt <= Date.now()) throw new MapDataRequestError('登录状态已失效，请重新登录', 401);
  const credentialScope = scope();
  const { payload, expiresAt } = await readCompareSnapshot(credentialScope, async () => {
    try {
      const result = await load();
      if (!Array.isArray(result.buildings) || !Array.isArray(result.brochures)) throw new Error('楼宇对比数据不完整');
      return { buildings: result.buildings, brochures: result.brochures };
    } catch (error) {
      if (error instanceof MapDataRequestError && (error.status === 401 || error.status === 403)) clearCompareSnapshot(credentialScope);
      throw error;
    }
  }, path);
  return {
    ...payload,
    expiresAt: Math.min(expiresAt, sessionExpiresAt ?? Infinity),
  };
}

export async function fetchBuildingTrendPayload(buildingId: string) {
  const params = new URLSearchParams({ mode: 'trend', building_id: buildingId });
  const payload = await fetchMapJson(`/api/map/data?${params.toString()}`);
  return Array.isArray(payload.metrics) ? payload.metrics : [];
}

