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

async function getMapRequest(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const session = await getSessionFast();
  signal?.throwIfAborted();
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
      ...(signal ? { signal } : {}),
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

async function fetchMapJson(path: string, reuseSnapshot = false, signal?: AbortSignal): Promise<JsonObject> {
  const { scope, load } = await getMapRequest(path, signal);
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


export type SubmarketDetailPayload = {
  submarket: string;
  stockCount: number;
  scope?: 'authorized_market';
  membershipTime?: 'current_catalog';
  publication?: 'locked_non_draft';
  profileAvailable: boolean;
  profile: import('@/src/app/map/model/submarketProfile').SubmarketProfile;
  /** Accessible only to an actual administrator, never a viewer or impersonator. */
  draftProfile?: import('@/src/app/map/model/submarketProfile').SubmarketProfile;
  profilePublished: boolean;
  trendError: boolean;
  trends: import('@/src/app/map/model/submarketMarketTrend').SubmarketTrendSeries;
  quarterMethod: string;
  source: string;
};

/** Read only when an area brief is opened. Auth and impersonation mirror the map endpoint. */
export async function fetchSubmarketDetailPayload(name: string, signal?: AbortSignal): Promise<SubmarketDetailPayload> {
  const params = new URLSearchParams({ submarket: name });
  const payload = await fetchMapJson(`/api/map/submarket?${params.toString()}`, false, signal);
  if (!payload || typeof payload !== 'object' || !payload.trends || !payload.profile) {
    throw new Error('子市场资料响应不完整');
  }
  return payload as SubmarketDetailPayload;
}

export async function fetchSubmarketResearchHistory(name: string, offset: number, signal?: AbortSignal) {
  const params = new URLSearchParams({ submarket: name, researchHistory: String(offset) });
  return await fetchMapJson(`/api/map/submarket?${params}`, false, signal) as {
    versions: import('@/src/app/map/model/submarketIntelligence').SubmarketResearchVersion[];
    nextOffset: number | null;
  };
}

/** Admin-only editorial update; the API revalidates role and refuses impersonated mutations. */
export async function saveSubmarketProfile(
  name: string,
  draft: import('@/src/app/map/model/submarketProfile').SubmarketProfileDraft,
  publish = false,
  expectedUpdatedAt?: string | null,
) {
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录状态已失效');
  const headers = withImpersonationHeaders({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  const response = await fetch(`/api/map/submarket?${new URLSearchParams({ submarket: name })}`, {
    method: 'PUT', cache: 'no-store', headers,
    body: JSON.stringify({ ...draft, publicationIntent: publish ? 'publish' : 'draft', expectedUpdatedAt }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error ?? '子市场资料保存失败'));
  return {
    profile: payload.profile as import('@/src/app/map/model/submarketProfile').SubmarketProfile,
    profilePublished: payload.profilePublished === true,
  };
}
