import { hasBuildingLocation, type FullListBuilding } from './fullBuildingList';
import { normalizeMapSearchText as normalize } from './mapSearchText';

export type MapSearchCandidate = FullListBuilding;
export type MapSearchMatch = '项目名称' | '曾用名' | '子市场' | '行政区' | '业主' | '物业公司' | '其他';

function relevance(building: MapSearchCandidate, query: string): number {
  const name = normalize(building.name);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (building.former_names?.some(former => normalize(former).includes(query))) return 3;
  if (normalize(building.submarket).includes(query)) return 4;
  if (normalize(building.district).includes(query)) return 5;
  if (normalize(building.owner).includes(query)) return 6;
  if (normalize(building.property_management).includes(query)) return 7;
  return 8;
}

/** Show how an already-authorized record matched, without querying any new data source. */
export function describeMapSearchMatch(building: MapSearchCandidate, keyword: string): MapSearchMatch {
  const query = normalize(keyword);
  if (!query) return '其他';
  if (normalize(building.name).includes(query)) return '项目名称';
  if (building.former_names?.some(former => normalize(former).includes(query))) return '曾用名';
  if (normalize(building.submarket).includes(query)) return '子市场';
  if (normalize(building.district).includes(query)) return '行政区';
  if (normalize(building.owner).includes(query)) return '业主';
  if (normalize(building.property_management).includes(query)) return '物业公司';
  return '其他';
}

/** Rank only the already-authorized, already-filtered map results. */
export function rankMapSearchCandidates(
  buildings: MapSearchCandidate[],
  query: string,
  limit = 6,
): { total: number; matchedCount: number; missingCoordinates: number; items: MapSearchCandidate[] } {
  const normalized = normalize(query);
  if (!normalized) return { total: 0, matchedCount: 0, missingCoordinates: 0, items: [] };
  const positioned = buildings
    .filter(hasBuildingLocation)
    .map((building, index) => ({ building, index, score: relevance(building, normalized) }))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  return {
    total: positioned.length,
    matchedCount: buildings.length,
    missingCoordinates: buildings.length - positioned.length,
    items: positioned.slice(0, Math.max(0, limit)).map(item => item.building),
  };
}

/** One exact name takes precedence over broader owner/submarket keyword matches. */
export function searchViewportTargets(buildings: MapSearchCandidate[], query: string): MapSearchCandidate[] {
  const positioned = buildings.filter(hasBuildingLocation);
  const normalized = normalize(query);
  const exact = normalized ? positioned.filter(building => normalize(building.name) === normalized) : [];
  return exact.length === 1 ? exact : positioned;
}
