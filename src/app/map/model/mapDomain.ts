import type { CompareGroup, SidebarFilterState } from '@/src/components/SidebarFilter';
import { getLatestMetric } from '@/src/utils/filterBuildings';
import { observedVacantArea } from './vacancyMetrics';
import { isPendingFutureSupply } from '@/src/lib/future-supply-status';

export const MAP_SUBMARKETS: string[] = ['CBD', '中关村', '亚奥', '望京-酒仙桥', '东城商务区', '燕莎', '丽泽', '金融街', '通州', '其他'];
export const MAP_SUBMARKETS_SECONDARY: string[] = ['上地', '亦庄', '北清路', '通惠河传媒走廊', '丰台科技园', '玉渊潭', '四季青'];
export const MAP_DISTRICTS: string[] = ['朝阳区', '海淀区', '西城区', '东城区', '丰台区', '石景山区', '大兴区', '通州区', '昌平区'];
export const MAP_LEEDS: string[] = ['Platinum', 'Gold', 'Silver', 'NULL'];
export const MAP_SUBWAYS: string[] = [
  '地铁1号线',
  '地铁2号线',
  '地铁4号线',
  '地铁5号线',
  '地铁6号线',
  '地铁7号线',
  '地铁8号线',
  '地铁9号线',
  '地铁10号线',
  '地铁13号线',
  '地铁14号线',
  '地铁15号线',
  '地铁16号线',
  '地铁17号线',
  '地铁八通线',
  '地铁昌平线',
  '地铁亦庄线',
  '地铁房山线',
  '地铁大兴线',
];

export const SUPPLY_CALENDAR_YEARS = ['2026', '2027', '2028'] as const;
export const SUPPLY_CALENDAR_SPECIAL = ['2029AndAfter', 'noDate'] as const;
export const SUPPLY_CALENDAR_CATEGORIES = [...SUPPLY_CALENDAR_YEARS, ...SUPPLY_CALENDAR_SPECIAL] as const;
export type SupplyCalendarCategory = (typeof SUPPLY_CALENDAR_CATEGORIES)[number];

export const SUPPLY_CALENDAR_LABELS: Record<SupplyCalendarCategory, string> = {
  '2026': '2026年',
  '2027': '2027年',
  '2028': '2028年',
  '2029AndAfter': '2029年及以后',
  'noDate': '暂无供应时间',
};

export type RenderMode = 'default' | 'rent' | 'vacancy' | 'leed';

export type MapStatsState = {
  totalArea: string;
  avgRent: string;
  overallVacancyPct: string;
  projectCount: string;
  visibleProjectCount: string;
};

export type SupplyCalendarBucket = {
  total: number;
  office: number;
  park: number;
  commercial: number;
};

export type ActiveFilterChip = {
  id: string;
  label: string;
  patch: Partial<SidebarFilterState>;
};

export function createDefaultFilterState(): SidebarFilterState {
  return {
    districts: [...MAP_DISTRICTS],
    submarkets: [...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY],
    leeds: [...MAP_LEEDS],
    projectTypes: ['甲级写字楼', '乙级写字楼', '产业园区'],
    showBoundaries: false,
    subwayLine: null,
    subwayStation: null,
    subwayDistance: 1000,
    numericFilters: [],
    showFutureSupply: true,
    futureSupplyGrades: [...FUTURE_SUPPLY_TYPES],
    futureSupplyYears: ['2026', '2027', '2028', '2029AndAfter', 'noDate'],
  };
}

export function normalizeMapSubmarket(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const key = raw
    .replace(/[\s·]/g, '')
    .replace(/[—–－]/g, '-')
    .replace(/[\/\\]/g, '-');
  if (key === '望京酒仙桥' || key === '望京-酒仙桥') return '望京-酒仙桥';
  if (key === '亦庄经济开发区' || key === '北京经济技术开发区' || key === '亦庄') return '亦庄';
  if (key.startsWith('其他-') || key.startsWith('其他')) return '其他';
  return raw;
}


export function isCompareGroupConfigured(group: CompareGroup): boolean {
  return group.submarkets.length > 0 || group.grades.length > 0 || group.districts.length > 0;
}

export function getConfiguredCompareGroups(groups: CompareGroup[]): CompareGroup[] {
  return groups.filter(isCompareGroupConfigured);
}

export const FUTURE_SUPPLY_TYPES = ['A', 'B', 'BP', 'commercial', 'pending'] as const;
export const STOCK_PROJECT_TYPES = ['甲级写字楼', '乙级写字楼', '产业园区'] as const;

export function isCommercialFutureSupply(supply: { type?: unknown }): boolean {
  return supply.type === '商业';
}

export function futureSupplyDisplayLabel(supply: { status?: unknown; type?: unknown }): string {
  if (isPendingFutureSupply(supply)) return '待核实项目';
  return isCommercialFutureSupply(supply) ? '商业未来供应' : '未来供应';
}

export function filterFutureSupplies(
  supplies: Array<Record<string, any>>,
  filterState: SidebarFilterState,
  keyword: string,
  calculateDistance?: (buildingPoint: [number, number], stationPoint: [number, number]) => number,
): Array<Record<string, any>> {
  const selectedSubmarkets = new Set(filterState.submarkets.map(normalizeMapSubmarket));
  const normalizeQuery = (value: unknown) => String(value ?? '').replace(/\s+/g, '').toLocaleLowerCase();
  const query = normalizeQuery(keyword);
  const allSubmarkets = hasSameSelections(filterState.submarkets, [...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY]);

  return supplies.filter((supply) => {
    const district = String(supply?.district ?? '').trim();
    const submarket = normalizeMapSubmarket(supply?.submarket);
    const pending = isPendingFutureSupply(supply);
    const commercial = isCommercialFutureSupply(supply);
    if (!filterState.districts.includes(district) || (!selectedSubmarkets.has(submarket) && !(commercial && !submarket && allSubmarkets))) return false;

    if (query && ![supply?.name, ...(Array.isArray(supply?.former_names) ? supply.former_names : []), supply?.submarket, supply?.district, supply?.owner]
      .some(value => normalizeQuery(value).includes(query))) {
      return false;
    }

    const grade = String(supply?.grade ?? '').trim().toUpperCase();
    if (filterState.futureSupplyGrades.length === 0) return false;
    const gradeMatches = pending ? filterState.futureSupplyGrades.includes('pending')
      : commercial ? filterState.futureSupplyGrades.includes('commercial') :
      (filterState.futureSupplyGrades.includes('BP') && grade.includes('BP'))
      || (filterState.futureSupplyGrades.includes('A') && (grade.includes('A') || grade.includes('P')) && !grade.includes('BP'))
      || (filterState.futureSupplyGrades.includes('B') && grade.includes('B') && !grade.includes('BP'));
    if (!gradeMatches) return false;

    if (filterState.futureSupplyYears.length === 0) return false;
    if (!filterState.futureSupplyYears.includes(categorizeSupply(supply))) return false;

    if (filterState.subwayStation && filterState.subwayDistance && calculateDistance) {
      const stationCenter = filterState.subwayStation?.center;
      const lng = Number(supply?.location_lng);
      const lat = Number(supply?.location_lat);
      if (!Array.isArray(stationCenter) || !Number.isFinite(lng) || !Number.isFinite(lat)) return false;
      const distance = calculateDistance([lng, lat], stationCenter as [number, number]);
      if (distance > filterState.subwayDistance) return false;
    }

    return true;
  });
}

const NUMERIC_FILTER_LABELS: Record<string, string> = {
  net_effective_rent: '净有效租金',
  vacancy_rate: '空置率',
  vacant_area: '空置面积',
  total_area: '总面积',
  management_fee: '物业费',
  owner: '项目业主',
  property_management: '物业公司',
};

function hasSameSelections(selected: string[], options: readonly string[]): boolean {
  return selected.length === options.length && options.every(option => selected.includes(option));
}

export function isDefaultStockFilterState(state: SidebarFilterState): boolean {
  return (
    hasSameSelections(state.districts, MAP_DISTRICTS) &&
    hasSameSelections(state.submarkets, [...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY]) &&
    hasSameSelections(state.leeds, MAP_LEEDS) &&
    hasSameSelections(state.projectTypes, STOCK_PROJECT_TYPES) &&
    !state.showBoundaries &&
    !state.subwayLine &&
    !state.subwayStation &&
    state.numericFilters.length === 0
  );
}

function hasDefaultFutureSupply(state: SidebarFilterState): boolean {
  return state.showFutureSupply
    && hasSameSelections(state.futureSupplyGrades, FUTURE_SUPPLY_TYPES)
    && hasSameSelections(state.futureSupplyYears, SUPPLY_CALENDAR_CATEGORIES);
}

export function isDefaultFilterState(state: SidebarFilterState): boolean {
  return isDefaultStockFilterState(state) && hasDefaultFutureSupply(state);
}

export function computeStatsFromBuildings(buildingsData: unknown[]): MapStatsState {
  const items = Array.isArray(buildingsData) ? buildingsData : [];
  const projectCount = items.length;
  let visibleProjectCount = 0;
  let totalArea = 0;
  let vacantArea = 0;
  let vacancyObservedArea = 0;
  let rentWeightSum = 0;
  let rentWeightAreaSum = 0;

  for (const building of items as Array<Record<string, any>>) {
    if (Number.isFinite(building.location_lng) && Number.isFinite(building.location_lat)) {
      visibleProjectCount += 1;
    }

    const latest = getLatestMetric(building.metrics);
    if (!latest) continue;

    const area = Number(latest.total_area);
    const rent = Number(latest.net_effective_rent);
    const vacArea = observedVacantArea(latest);

    if (Number.isFinite(area) && area > 0) {
      totalArea += area;
      if (Number.isFinite(vacArea)) {
        vacantArea += vacArea;
        vacancyObservedArea += area;
      }
    }

    if (Number.isFinite(area) && area > 0 && Number.isFinite(rent) && rent > 0) {
      rentWeightAreaSum += area;
      rentWeightSum += rent * area;
    }
  }

  const avgRent = rentWeightAreaSum > 0 ? (rentWeightSum / rentWeightAreaSum).toFixed(1) : '-';
  const overallVacancyPct = vacancyObservedArea > 0 ? ((vacantArea / vacancyObservedArea) * 100).toFixed(1) : '-';

  return {
    totalArea: totalArea > 0 ? Math.round(totalArea).toLocaleString('zh-CN') : '-',
    avgRent,
    overallVacancyPct,
    projectCount: projectCount.toString(),
    visibleProjectCount: visibleProjectCount.toString(),
  };
}

export function buildDistrictLeedStats(buildings: Array<Record<string, any>>): Map<string, { totalCount: number; leedCount: number }> {
  const districtMap = new Map<string, { totalCount: number; leedCount: number }>();

  for (const building of buildings) {
    const district = building.district?.trim?.() ?? '';
    if (!district) continue;

    const current = districtMap.get(district) ?? { totalCount: 0, leedCount: 0 };
    current.totalCount += 1;

    const leed = (building.leed_certification || '').trim().toUpperCase();
    if (leed && leed !== 'NULL') current.leedCount += 1;

    districtMap.set(district, current);
  }

  return districtMap;
}

export function safeParseSupplyYear(supply: Record<string, any>): number | null {
  try {
    const year = supply.launch_year || supply.launchYear || supply.year;
    if (year === null || year === undefined || year === '') return null;

    const yearNum = typeof year === 'number' ? year : parseInt(String(year), 10);
    if (!Number.isFinite(yearNum) || yearNum < 1900 || yearNum > 2100) return null;

    return yearNum;
  } catch {
    return null;
  }
}

export function categorizeSupply(supply: Record<string, any>): SupplyCalendarCategory {
  const yearNum = safeParseSupplyYear(supply);
  if (yearNum === null) return 'noDate';
  if (yearNum === 2026) return '2026';
  if (yearNum === 2027) return '2027';
  if (yearNum === 2028) return '2028';
  if (yearNum >= 2029) return '2029AndAfter';
  return 'noDate';
}

export function buildFutureSupplyCalendar(supplies: Array<Record<string, any>>): Record<SupplyCalendarCategory, SupplyCalendarBucket> {
  const calendar: Record<SupplyCalendarCategory, SupplyCalendarBucket> = {
    '2026': { total: 0, office: 0, park: 0, commercial: 0 },
    '2027': { total: 0, office: 0, park: 0, commercial: 0 },
    '2028': { total: 0, office: 0, park: 0, commercial: 0 },
    '2029AndAfter': { total: 0, office: 0, park: 0, commercial: 0 },
    'noDate': { total: 0, office: 0, park: 0, commercial: 0 },
  };

  for (const supply of supplies) {
    if (isPendingFutureSupply(supply)) continue;
    const category = categorizeSupply(supply);
    calendar[category].total += 1;

    const grade = (supply.grade || '').toUpperCase();
    if (isCommercialFutureSupply(supply)) calendar[category].commercial += 1;
    else if (grade.includes('BP')) calendar[category].park += 1;
    else calendar[category].office += 1;
  }

  return calendar;
}

function formatSupplyYearLabel(year: string): string {
  if (year === '2029AndAfter') return '2029年及以后';
  if (year === 'noDate') return '暂无时间';
  return `${year}年`;
}

function compactListLabel(items: string[], total: number, emptyLabel: string): string {
  if (items.length === 0) return emptyLabel;
  const visible = items.slice(0, 2).join('、');
  return items.length > 2 || items.length < total ? `${visible} 等${items.length}项` : visible;
}

export function buildActiveFilterChips(filterState: SidebarFilterState | null): ActiveFilterChip[] {
  if (!filterState) return [];

  const chips: ActiveFilterChip[] = [];
  const allSubmarkets = [...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY];
  const allProjectTypes = ['甲级写字楼', '乙级写字楼', '产业园区'];

  if (filterState.projectTypes.length < allProjectTypes.length) {
    chips.push({
      id: 'projectTypes',
      label: `项目类型：${compactListLabel(filterState.projectTypes, allProjectTypes.length, '未选择')}`,
      patch: { projectTypes: allProjectTypes },
    });
  }

  if (filterState.districts.length < MAP_DISTRICTS.length) {
    chips.push({
      id: 'districts',
      label: `行政区：${compactListLabel(filterState.districts, MAP_DISTRICTS.length, '未选择')}`,
      patch: { districts: [...MAP_DISTRICTS] },
    });
  }

  if (filterState.submarkets.length < allSubmarkets.length) {
    chips.push({
      id: 'submarkets',
      label: `子市场：${compactListLabel(filterState.submarkets, allSubmarkets.length, '未选择')}`,
      patch: { submarkets: allSubmarkets },
    });
  }

  if (filterState.leeds.length < MAP_LEEDS.length) {
    chips.push({
      id: 'leeds',
      label: `LEED：${compactListLabel(filterState.leeds, MAP_LEEDS.length, '未选择')}`,
      patch: { leeds: [...MAP_LEEDS] },
    });
  }

  if (filterState.subwayLine) {
    const station = filterState.subwayStation?.name ? ` · ${filterState.subwayStation.name}` : '';
    const distance = filterState.subwayStation && filterState.subwayDistance
      ? ` · ${filterState.subwayDistance >= 1000 ? `${filterState.subwayDistance / 1000}km` : `${filterState.subwayDistance}m`}`
      : '';
    chips.push({
      id: 'subway',
      label: `地铁：${filterState.subwayLine}${station}${distance}`,
      patch: { subwayLine: null, subwayStation: null, subwayDistance: 1000 },
    });
  }

  filterState.numericFilters
    .filter(filter => filter.value !== '' && filter.value !== null && filter.value !== undefined)
    .forEach(filter => {
      chips.push({
        id: `numeric-${filter.id}`,
        label: `${NUMERIC_FILTER_LABELS[filter.field] ?? filter.field} ${filter.operator} ${filter.value}`,
        patch: { numericFilters: filterState.numericFilters.filter(item => item.id !== filter.id) },
      });
    });

  if (filterState.showBoundaries) {
    chips.push({ id: 'boundaries', label: '行政区边界', patch: { showBoundaries: false } });
  }

  if (filterState.showFutureSupply && !hasDefaultFutureSupply(filterState)) {
    const grades = filterState.futureSupplyGrades.length === FUTURE_SUPPLY_TYPES.length ? '全部类型' : filterState.futureSupplyGrades.map(type => type === 'commercial' ? '商业' : type === 'pending' ? '待核实' : type).join('、');
    const years = filterState.futureSupplyYears.length === 5
      ? '全部年份'
      : filterState.futureSupplyYears.map(formatSupplyYearLabel).join('、') || '未选择';
    chips.push({
      id: 'futureSupply',
      label: `未来供应：${grades} · ${years}`,
      patch: { showFutureSupply: true, futureSupplyGrades: [...FUTURE_SUPPLY_TYPES], futureSupplyYears: [...SUPPLY_CALENDAR_CATEGORIES] },
    });
  }

  return chips;
}
