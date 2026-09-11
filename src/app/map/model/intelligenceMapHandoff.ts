import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import type { RequirementCapability, RequirementParseResult } from '@/src/lib/intelligence/requirementSchema';
import {
  MAP_DISTRICTS,
  MAP_LEEDS,
  MAP_SUBMARKETS,
  MAP_SUBMARKETS_SECONDARY,
} from './mapDomain';

const DEFAULT_PROJECT_TYPES = ['甲级写字楼', '乙级写字楼', '产业园区'] as const;
const DAILY_TO_MONTHLY_FACTOR = 365 / 12;
const HANDOFF_VERSION = '1';
const ALLOWED_CAPABILITY_KEYS = new Set<RequirementCapability['key']>(['location', 'rent', 'grade']);

export type IntelligenceMapHandoff = {
  href: string;
  filterState: SidebarFilterState;
  appliedCapabilities: RequirementCapability['key'][];
  skippedCapabilities: Array<{
    key: RequirementCapability['key'];
    label: string;
    reason: string;
  }>;
};

export type IntelligenceMapRouteState = {
  source: 'intelligence';
  filterState: SidebarFilterState;
  appliedCapabilities: RequirementCapability['key'][];
};

type SearchParamReader = Pick<URLSearchParams, 'get' | 'getAll'>;

function unique(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function defaultFilterState(): SidebarFilterState {
  return {
    districts: [...MAP_DISTRICTS],
    submarkets: [...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY],
    leeds: [...MAP_LEEDS],
    projectTypes: [...DEFAULT_PROJECT_TYPES],
    showBoundaries: false,
    subwayLine: null,
    subwayStation: null,
    subwayDistance: 1000,
    numericFilters: [],
    showFutureSupply: false,
    futureSupplyGrades: ['A', 'B', 'BP'],
    futureSupplyYears: ['2026', '2027', '2028', '2029AndAfter', 'noDate'],
  };
}

function supportedCapabilityKeys(result: RequirementParseResult) {
  return new Set(result.capabilities.filter(item => item.status === 'supported').map(item => item.key));
}

function gradeToProjectType(grade: string): string | null {
  const normalized = grade.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.includes('BP')) return '产业园区';
  if (normalized.includes('B')) return '乙级写字楼';
  if (normalized.includes('A') || normalized.includes('P')) return '甲级写字楼';
  return null;
}

function toMonthlyRent(daily: number) {
  return Math.round(daily * DAILY_TO_MONTHLY_FACTOR * 10) / 10;
}

function safeNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5000) return null;
  return parsed;
}

function validRepeatedValues(reader: SearchParamReader, key: string, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return unique(reader.getAll(key)).filter(value => allowedSet.has(value));
}

export function createIntelligenceMapHandoff(result: RequirementParseResult): IntelligenceMapHandoff {
  const supported = supportedCapabilityKeys(result);
  const filterState = defaultFilterState();
  const appliedCapabilities: RequirementCapability['key'][] = [];
  const skippedCapabilities: IntelligenceMapHandoff['skippedCapabilities'] = [];
  const capabilityByKey = new Map(result.capabilities.map(item => [item.key, item]));

  if (supported.has('location')) {
    const locations = result.parsed.locations;
    const allSubmarkets = locations.length > 0 && locations.every(location => Boolean(location.normalizedSubmarket));
    const allDistrictOnly = locations.length > 0 && locations.every(location => Boolean(location.normalizedDistrict) && !location.normalizedSubmarket);

    if (allSubmarkets) {
      const allowed = new Set([...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY]);
      // Multiple natural-language aliases may legitimately resolve to the same canonical
      // submarket (e.g. “望京 or 酒仙桥” → “望京-酒仙桥”). De-duplication must not
      // invalidate an otherwise lossless OR expression.
      const values = unique(locations.map(location => location.normalizedSubmarket ?? ''));
      if (values.length > 0 && values.every(value => allowed.has(value))) {
        filterState.submarkets = values;
        appliedCapabilities.push('location');
      }
    } else if (allDistrictOnly) {
      const allowed = new Set(MAP_DISTRICTS);
      const values = unique(locations.map(location => location.normalizedDistrict ?? ''));
      if (values.length > 0 && values.every(value => allowed.has(value))) {
        filterState.districts = values;
        appliedCapabilities.push('location');
      }
    }

    if (!appliedCapabilities.includes('location')) {
      const capability = capabilityByKey.get('location');
      skippedCapabilities.push({
        key: 'location',
        label: capability?.label ?? '区域',
        reason: '区域表达包含未解析项或混合行政区/子市场的 OR 关系，当前地图筛选无法无损表达。',
      });
    }
  }

  if (supported.has('grade') && result.parsed.grades.length > 0) {
    const mapped = result.parsed.grades.map(gradeToProjectType);
    if (mapped.every((value): value is string => Boolean(value))) {
      filterState.projectTypes = unique(mapped);
      appliedCapabilities.push('grade');
    } else {
      const capability = capabilityByKey.get('grade');
      skippedCapabilities.push({
        key: 'grade',
        label: capability?.label ?? '项目等级',
        reason: '存在无法映射到现有甲级/乙级/产业园区筛选的等级。',
      });
    }
  }

  if (supported.has('rent')) {
    const { rent } = result.parsed;
    if (rent.basis === 'net_effective') {
      if (rent.minDailyRmbSqm !== null) {
        filterState.numericFilters.push({
          id: 'intelligence-rent-min',
          field: 'net_effective_rent',
          operator: '>=',
          value: toMonthlyRent(rent.minDailyRmbSqm),
        });
      }
      if (rent.maxDailyRmbSqm !== null) {
        filterState.numericFilters.push({
          id: 'intelligence-rent-max',
          field: 'net_effective_rent',
          operator: '<=',
          value: toMonthlyRent(rent.maxDailyRmbSqm),
        });
      }
      if (filterState.numericFilters.length > 0) appliedCapabilities.push('rent');
    }
  }

  for (const capability of result.capabilities) {
    if (appliedCapabilities.includes(capability.key)) continue;
    if (skippedCapabilities.some(item => item.key === capability.key)) continue;
    if (capability.status !== 'supported' || !ALLOWED_CAPABILITY_KEYS.has(capability.key)) {
      skippedCapabilities.push({
        key: capability.key,
        label: capability.label,
        reason: capability.explanation,
      });
    }
  }

  const params = new URLSearchParams();
  params.set('source', 'intelligence');
  params.set('v', HANDOFF_VERSION);
  for (const key of appliedCapabilities) params.append('cap', key);

  if (appliedCapabilities.includes('location')) {
    if (filterState.districts.length < MAP_DISTRICTS.length) {
      for (const district of filterState.districts) params.append('district', district);
    }
    if (filterState.submarkets.length < MAP_SUBMARKETS.length + MAP_SUBMARKETS_SECONDARY.length) {
      for (const submarket of filterState.submarkets) params.append('submarket', submarket);
    }
  }
  if (appliedCapabilities.includes('grade')) {
    for (const projectType of filterState.projectTypes) params.append('projectType', projectType);
  }
  for (const filter of filterState.numericFilters) {
    if (filter.id === 'intelligence-rent-min') params.set('rentMinMonthly', String(filter.value));
    if (filter.id === 'intelligence-rent-max') params.set('rentMaxMonthly', String(filter.value));
  }

  return {
    href: `/map?${params.toString()}`,
    filterState,
    appliedCapabilities,
    skippedCapabilities,
  };
}

export function parseIntelligenceMapHandoff(reader: SearchParamReader): IntelligenceMapRouteState | null {
  if (reader.get('source') !== 'intelligence' || reader.get('v') !== HANDOFF_VERSION) return null;

  const districts = validRepeatedValues(reader, 'district', MAP_DISTRICTS);
  const submarkets = validRepeatedValues(reader, 'submarket', [...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY]);
  if (districts.length > 0 && submarkets.length > 0) return null;

  const projectTypes = validRepeatedValues(reader, 'projectType', DEFAULT_PROJECT_TYPES);
  const rentMin = safeNumber(reader.get('rentMinMonthly'));
  const rentMax = safeNumber(reader.get('rentMaxMonthly'));
  if (rentMin !== null && rentMax !== null && rentMin > rentMax) return null;

  const filterState = defaultFilterState();
  if (districts.length > 0) filterState.districts = districts;
  if (submarkets.length > 0) filterState.submarkets = submarkets;
  if (projectTypes.length > 0) filterState.projectTypes = projectTypes;
  if (rentMin !== null) {
    filterState.numericFilters.push({ id: 'intelligence-rent-min', field: 'net_effective_rent', operator: '>=', value: rentMin });
  }
  if (rentMax !== null) {
    filterState.numericFilters.push({ id: 'intelligence-rent-max', field: 'net_effective_rent', operator: '<=', value: rentMax });
  }

  const appliedCapabilities = unique(reader.getAll('cap'))
    .filter((key): key is RequirementCapability['key'] => ALLOWED_CAPABILITY_KEYS.has(key as RequirementCapability['key']));

  const hasRealFilter = districts.length > 0 || submarkets.length > 0 || projectTypes.length > 0 || rentMin !== null || rentMax !== null;
  if (!hasRealFilter) return null;

  return {
    source: 'intelligence',
    filterState,
    appliedCapabilities,
  };
}
