import type { CompareGroup, SidebarFilterState } from '@/src/components/SidebarFilter';
import type { BuildingWithMetrics } from '@/src/types';
import { getLatestMetric } from '@/src/utils/filterBuildings';

export type MapRole = 'viewer' | 'editor' | 'admin' | string;

export type MapFilterRequest = {
  filterState: SidebarFilterState;
  compareGroups: CompareGroup[];
  keyword?: string;
  role?: MapRole;
  calculateDistance?: (buildingPoint: [number, number], stationPoint: [number, number]) => number;
};

type StringIndex = Map<string, Set<string>>;

type MapDataIndexes = {
  buildingIdIndex: Map<string, BuildingWithMetrics>;
  districtIndex: StringIndex;
  submarketIndex: StringIndex;
  gradeIndex: StringIndex;
  leedIndex: StringIndex;
  projectTypeIndex: StringIndex;
};

const EMPTY_VALUE = '__EMPTY__';

function addToIndex(index: StringIndex, key: string, id: string) {
  const bucket = index.get(key);
  if (bucket) bucket.add(id);
  else index.set(key, new Set([id]));
}

function normalizedString(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || EMPTY_VALUE;
}

function normalizedLeed(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || 'NULL';
}

function buildingProjectTypes(grade: unknown): string[] {
  const normalized = String(grade ?? '').toUpperCase();
  const types: string[] = [];
  if (normalized.includes('BP')) types.push('产业园区');
  else {
    if (normalized.includes('A') || normalized.includes('P')) types.push('甲级写字楼');
    if (normalized.includes('B')) types.push('乙级写字楼');
  }
  return types;
}

function unionBuckets(index: StringIndex, keys: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const key of keys) {
    const bucket = index.get(key);
    if (!bucket) continue;
    for (const id of bucket) result.add(id);
  }
  return result;
}

function intersectIds(current: Set<string> | null, next: Set<string>): Set<string> {
  if (current === null) return next;
  if (current.size > next.size) return intersectIds(next, current);
  const result = new Set<string>();
  for (const id of current) if (next.has(id)) result.add(id);
  return result;
}

function matchesCompareGroup(building: BuildingWithMetrics, group: CompareGroup): boolean {
  if (group.submarkets.length > 0 && (!building.submarket || !group.submarkets.includes(building.submarket))) {
    return false;
  }

  if (group.grades.length > 0) {
    const buildingGrade = String(building.grade || '').toUpperCase();
    const gradeMatch = group.grades.some(filterGrade => {
      if (filterGrade === '产业园') return buildingGrade.includes('BP');
      if (filterGrade === '甲级') {
        return (buildingGrade.includes('A') || buildingGrade.includes('P')) && !buildingGrade.includes('BP');
      }
      if (filterGrade === '乙级') return buildingGrade.includes('B') && !buildingGrade.includes('BP');
      return false;
    });
    if (!gradeMatch) return false;
  }

  if (group.districts.length > 0 && (!building.district || !group.districts.includes(building.district))) {
    return false;
  }

  return true;
}

function matchesNumericFilters(building: BuildingWithMetrics, filterState: SidebarFilterState): boolean {
  if (filterState.numericFilters.length === 0) return true;
  const latest = getLatestMetric(building.metrics);

  for (const condition of filterState.numericFilters) {
    if (condition.value === '' || condition.value === null || condition.value === undefined) continue;

    if (condition.field === 'owner' || condition.field === 'property_management') {
      const target = String(building[condition.field] || '').toLowerCase();
      const query = String(condition.value).trim().toLowerCase();
      if (query && !target.includes(query)) return false;
      continue;
    }

    if (!latest) return false;
    if (Number.isNaN(Number(condition.value))) continue;

    let metricValue = Number(latest[condition.field as keyof typeof latest]);
    const filterValue = Number(condition.value);
    if (!Number.isFinite(metricValue)) return false;
    if (condition.field === 'vacancy_rate') metricValue *= 100;

    switch (condition.operator) {
      case '>=':
        if (!(metricValue >= filterValue)) return false;
        break;
      case '<=':
        if (!(metricValue <= filterValue)) return false;
        break;
      case '=':
        if (!(metricValue === filterValue)) return false;
        break;
      case '>':
        if (!(metricValue > filterValue)) return false;
        break;
      case '<':
        if (!(metricValue < filterValue)) return false;
        break;
    }
  }

  return true;
}

export class MapDataStore {
  private buildings: BuildingWithMetrics[] = [];
  private indexes: MapDataIndexes = this.createEmptyIndexes();

  constructor(buildings: BuildingWithMetrics[] = []) {
    this.replaceBuildings(buildings);
  }

  private createEmptyIndexes(): MapDataIndexes {
    return {
      buildingIdIndex: new Map(),
      districtIndex: new Map(),
      submarketIndex: new Map(),
      gradeIndex: new Map(),
      leedIndex: new Map(),
      projectTypeIndex: new Map(),
    };
  }

  replaceBuildings(buildings: BuildingWithMetrics[]) {
    this.buildings = Array.isArray(buildings) ? buildings : [];
    const indexes = this.createEmptyIndexes();

    for (const building of this.buildings) {
      indexes.buildingIdIndex.set(building.id, building);
      addToIndex(indexes.districtIndex, normalizedString(building.district), building.id);
      addToIndex(indexes.submarketIndex, normalizedString(building.submarket), building.id);
      addToIndex(indexes.gradeIndex, normalizedString(building.grade).toUpperCase(), building.id);
      addToIndex(indexes.leedIndex, normalizedLeed(building.leed_certification), building.id);
      for (const projectType of buildingProjectTypes(building.grade)) {
        addToIndex(indexes.projectTypeIndex, projectType, building.id);
      }
    }

    this.indexes = indexes;
  }

  getAll(): BuildingWithMetrics[] {
    return this.buildings;
  }

  getById(buildingId: string): BuildingWithMetrics | undefined {
    return this.indexes.buildingIdIndex.get(buildingId);
  }

  getRoleVisible(role: MapRole = 'viewer'): BuildingWithMetrics[] {
    if (role === 'admin' || role === 'editor') return this.buildings;
    return this.buildings.filter(building => {
      const grade = String(building.grade || '').toUpperCase();
      return grade === 'A' || grade === 'P';
    });
  }

  getIndexSnapshot() {
    return this.indexes;
  }

  filter(request: MapFilterRequest): BuildingWithMetrics[] {
    const { filterState, compareGroups } = request;
    const keyword = request.keyword?.trim() ?? '';

    // Preserve the existing comparison contract: compare groups operate on the
    // complete fetched dataset and ignore the global filter state.
    if (compareGroups.length > 0) {
      return this.buildings.filter(building => {
        if (keyword && !(building.name?.includes(keyword) || building.submarket?.includes(keyword))) return false;
        return compareGroups.some(group => matchesCompareGroup(building, group));
      });
    }

    let candidateIds: Set<string> | null = null;

    if (filterState.districts.length > 0) {
      candidateIds = intersectIds(candidateIds, unionBuckets(this.indexes.districtIndex, filterState.districts));
    }

    if (filterState.projectTypes.length === 0) return [];
    candidateIds = intersectIds(candidateIds, unionBuckets(this.indexes.projectTypeIndex, filterState.projectTypes));

    if (filterState.leeds.length > 0) {
      candidateIds = intersectIds(candidateIds, unionBuckets(this.indexes.leedIndex, filterState.leeds));
    }

    if (filterState.submarkets.length > 0) {
      const submarketIds = unionBuckets(this.indexes.submarketIndex, filterState.submarkets);
      const emptySubmarketIds = this.indexes.submarketIndex.get(EMPTY_VALUE);
      if (emptySubmarketIds) for (const id of emptySubmarketIds) submarketIds.add(id);
      candidateIds = intersectIds(candidateIds, submarketIds);
    }

    const visibleIds = new Set(this.getRoleVisible(request.role).map(building => building.id));
    candidateIds = intersectIds(candidateIds, visibleIds);

    const candidates = candidateIds
      ? Array.from(candidateIds, id => this.indexes.buildingIdIndex.get(id)).filter((building): building is BuildingWithMetrics => Boolean(building))
      : this.getRoleVisible(request.role);

    return candidates.filter(building => {
      if (keyword && !(building.name?.includes(keyword) || building.submarket?.includes(keyword))) return false;
      if (!matchesNumericFilters(building, filterState)) return false;

      if (filterState.subwayStation && filterState.subwayDistance && request.calculateDistance) {
        const stationCenter = filterState.subwayStation?.center;
        if (Array.isArray(stationCenter)) {
          const distance = request.calculateDistance(
            [building.location_lng, building.location_lat],
            stationCenter as [number, number],
          );
          if (distance > filterState.subwayDistance) return false;
        }
      }

      return true;
    });
  }
}
