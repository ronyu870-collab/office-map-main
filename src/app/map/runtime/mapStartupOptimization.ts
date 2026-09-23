'use client';

import type { MapController } from '@/src/services/MapController';
import { fetchMapBuildingPayload } from '@/src/services/mapDataClient';
import type { BuildingMetric, BuildingWithMetrics } from '@/src/types';

type DisplayOverride = {
  display_label: string;
  display_value: string;
};

type ControllerStartupInternals = {
  fetchMapData?: () => Promise<BuildingWithMetrics[]>;
  initMap?: MapController['initMap'];
  loadLocalMapData?: () => Promise<unknown>;
  _cachedMapDataPromise?: Promise<BuildingWithMetrics[]> | null;
  _allBuildingsCache?: BuildingWithMetrics[];
  _displayOverridesCache?: Map<string, Map<string, DisplayOverride>>;
};


function toFiniteNumber(input: unknown): number {
  const n =
    typeof input === 'number'
      ? input
      : typeof input === 'string'
        ? Number(input.trim())
        : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function toNullableFiniteNumber(input: unknown): number | null {
  const n =
    typeof input === 'number'
      ? input
      : typeof input === 'string'
        ? Number(input.trim())
        : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function transformBuildingRow(row: Record<string, unknown>): BuildingWithMetrics {
  const metricsRaw = Array.isArray(row.building_metrics)
    ? row.building_metrics as Record<string, unknown>[]
    : [];

  const metrics: BuildingMetric[] = metricsRaw
    .map((metric) => ({
      id: String(metric.id ?? ''),
      building_id: String(metric.building_id ?? ''),
      total_area: toFiniteNumber(metric.total_area),
      asking_rent: toFiniteNumber(metric.asking_rent),
      management_fee: toFiniteNumber(metric.management_fee),
      face_rent: toFiniteNumber(metric.face_rent),
      rent_free_period: toFiniteNumber(metric.rent_free_period),
      net_effective_rent: toFiniteNumber(metric.net_effective_rent),
      vacancy_rate: toFiniteNumber(metric.vacancy_rate),
      vacant_area: toFiniteNumber(metric.vacant_area),
      record_year: toFiniteNumber(metric.record_year),
      record_quarter: toFiniteNumber(metric.record_quarter),
    }))
    .filter((metric) => metric.id !== '' && metric.building_id !== '');

  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    submarket: String(row.submarket ?? ''),
    grade: String(row.grade ?? ''),
    city: String(row.city ?? ''),
    district: String(row.district ?? ''),
    location_lng: toNullableFiniteNumber(row.location_lng) as number,
    location_lat: toNullableFiniteNumber(row.location_lat) as number,
    completion_year: String(row.completion_year ?? ''),
    leed_certification: String(row.leed_certification ?? ''),
    owner: row.owner ? String(row.owner) : undefined,
    property_management: row.property_management ? String(row.property_management) : undefined,
    contact_phone: row.contact_phone ? String(row.contact_phone) : undefined,
    metrics,
  };
}

async function fetchSlimStartupData(
  internals: ControllerStartupInternals,
): Promise<BuildingWithMetrics[]> {
  const payload = await fetchMapBuildingPayload('latest');

  const overrideCache = new Map<string, Map<string, DisplayOverride>>();
  for (const override of payload.displayOverrides) {
    if (!overrideCache.has(override.building_id)) {
      overrideCache.set(override.building_id, new Map());
    }
    overrideCache.get(override.building_id)!.set(override.field_name, {
      display_label: override.display_label,
      display_value: override.display_value,
    });
  }
  internals._displayOverridesCache = overrideCache;

  const buildings = payload.buildings
    .map((row) => transformBuildingRow(row as Record<string, unknown>))
    .filter((building) => building.id !== '' && building.name !== '');

  internals._allBuildingsCache = buildings;
  return buildings;
}

/**
 * Apply startup-only optimizations without changing MapController's durable
 * behavior. The instance falls back to the original full-history query if the
 * optimized PostgREST shape ever becomes unavailable.
 *
 * The local Beijing boundary/subway JSON is also suppressed only while
 * MapController.initMap() runs. The original loader is restored immediately,
 * so the first real district/subway interaction still loads and caches it.
 */
export function installMapStartupOptimization(controller: MapController): () => void {
  const internals = controller as unknown as ControllerStartupInternals;
  if (typeof internals.fetchMapData !== 'function' || typeof internals.initMap !== 'function') {
    return () => {};
  }

  const originalFetchMapData = internals.fetchMapData.bind(controller);
  const originalInitMap = internals.initMap.bind(controller);
  const originalLocalLoader = internals.loadLocalMapData?.bind(controller);

  internals.fetchMapData = async () => {
    if (internals._cachedMapDataPromise) return internals._cachedMapDataPromise;

    const optimizedPromise = fetchSlimStartupData(internals);
    internals._cachedMapDataPromise = optimizedPromise;

    try {
      const buildings = await optimizedPromise;
      if (buildings.length === 0) internals._cachedMapDataPromise = null;
      return buildings;
    } catch (error) {
      internals._cachedMapDataPromise = null;
      console.warn('[MapStartup] slim map query failed; falling back to legacy query', error);
      return originalFetchMapData();
    }
  };

  if (originalLocalLoader) {
    internals.initMap = (async (...args: Parameters<MapController['initMap']>) => {
      // initMap only fire-and-forgets this preload. Temporarily replace it with
      // a resolved no-op, then restore the real lazy loader before init returns.
      internals.loadLocalMapData = async () => ({
        version: 'deferred',
        generatedAt: '',
        districts: [],
        subways: [],
      });
      try {
        await originalInitMap(...args);
      } finally {
        internals.loadLocalMapData = originalLocalLoader;
      }
    }) as MapController['initMap'];
  }

  return () => {
    internals.fetchMapData = originalFetchMapData;
    internals.initMap = originalInitMap;
    if (originalLocalLoader) internals.loadLocalMapData = originalLocalLoader;
  };
}
