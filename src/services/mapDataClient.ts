'use client';

import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';

type JsonObject = Record<string, any>;

async function fetchMapJson(path: string): Promise<JsonObject> {
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('未登录，无法读取地图数据');

  const response = await fetch(path, {
    method: 'GET',
    headers: withImpersonationHeaders({
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    }),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : '地图数据读取失败');
  }
  return payload as JsonObject;
}

export async function fetchMapBuildingPayload(metrics: 'latest' | 'all' = 'latest') {
  const payload = await fetchMapJson(`/api/map/data?mode=map&metrics=${metrics}`);
  return {
    buildings: Array.isArray(payload.buildings) ? payload.buildings : [],
    displayOverrides: Array.isArray(payload.display_overrides) ? payload.display_overrides : [],
  };
}

export async function fetchFutureSupplyPayload() {
  const payload = await fetchMapJson('/api/map/data?mode=future');
  return Array.isArray(payload.future_supplies) ? payload.future_supplies : [];
}

export async function fetchComparePayload() {
  const payload = await fetchMapJson('/api/map/data?mode=compare');
  return {
    buildings: Array.isArray(payload.buildings) ? payload.buildings : [],
    brochures: Array.isArray(payload.brochures) ? payload.brochures : [],
  };
}

export async function fetchBuildingTrendPayload(buildingId: string) {
  const params = new URLSearchParams({ mode: 'trend', building_id: buildingId });
  const payload = await fetchMapJson(`/api/map/data?${params.toString()}`);
  return Array.isArray(payload.metrics) ? payload.metrics : [];
}
