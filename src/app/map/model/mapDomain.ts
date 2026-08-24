import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import { getLatestMetric } from '@/src/utils/filterBuildings';

export const MAP_SUBMARKETS = ['CBD', '中关村', '亚奥', '望京-酒仙桥', '东城商务区', '燕莎', '丽泽', '金融街', '通州', '其他'] as const;
export const MAP_SUBMARKETS_SECONDARY = ['上地', '亦庄', '北清路', '通惠河传媒走廊', '丰台科技园'] as const;
export const MAP_DISTRICTS = ['朝阳区', '海淀区', '西城区', '东城区', '丰台区', '石景山区', '大兴区', '通州区', '昌平区'] as const;
export const MAP_LEEDS = ['Platinum', 'Gold', 'Silver', 'NULL'] as const;
export const MAP_SUBWAYS = [
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
] as const;

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
};

export type ActiveFilterChip = {
  id: string;
  label: string;
  patch: Partial<SidebarFilterState>;
};

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

export function isDefaultFilterState(state: SidebarFilterState): boolean {
  return (
    hasSameSelections(state.districts, MAP_DISTRICTS) &&
    hasSameSelections(state.submarkets, [...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY]) &&
    hasSameSelections(state.leeds, MAP_LEEDS) &&
    hasSameSelections(state.projectTypes, ['甲级写字楼', '乙级写字楼', '产业园区']) &&
    !state.showBoundaries &&
    !state.subwayLine &&
    !state.subwayStation &&
    state.numericFilters.length === 0 &&
    !state.showFutureSupply
  );
}

export function computeStatsFromBuildings(buildingsData: unknown[]): MapStatsState {
  const items = Array.isArray(buildingsData) ? buildingsData : [];
  const projectCount = items.length;
  let visibleProjectCount = 0;
  let totalArea = 0;
  let vacantArea = 0;
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
    const vacArea = Number(latest.vacant_area);

    if (Number.isFinite(area) && area > 0) {
      totalArea += area;
      vacantArea += Number.isFinite(vacArea) ? vacArea : 0;
    }

    if (Number.isFinite(area) && area > 0 && Number.isFinite(rent) && rent > 0) {
      rentWeightAreaSum += area;
      rentWeightSum += rent * area;
    }
  }

  const avgRent = rentWeightAreaSum > 0 ? (rentWeightSum / rentWeightAreaSum).toFixed(1) : '-';
  const overallVacancyPct = totalArea > 0 ? ((vacantArea / totalArea) * 100).toFixed(1) : '-';

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
    '2026': { total: 0, office: 0, park: 0 },
    '2027': { total: 0, office: 0, park: 0 },
    '2028': { total: 0, office: 0, park: 0 },
    '2029AndAfter': { total: 0, office: 0, park: 0 },
    'noDate': { total: 0, office: 0, park: 0 },
  };

  for (const supply of supplies) {
    const category = categorizeSupply(supply);
    calendar[category].total += 1;

    const grade = (supply.grade || '').toUpperCase();
    if (grade.includes('BP')) calendar[category].park += 1;
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

  if (filterState.showFutureSupply) {
    const grades = filterState.futureSupplyGrades.length === 3 ? '全部类型' : filterState.futureSupplyGrades.join('、');
    const years = filterState.futureSupplyYears.length === 5
      ? '全部年份'
      : filterState.futureSupplyYears.map(formatSupplyYearLabel).join('、') || '未选择';
    chips.push({
      id: 'futureSupply',
      label: `未来供应：${grades} · ${years}`,
      patch: { showFutureSupply: false },
    });
  }

  return chips;
}
