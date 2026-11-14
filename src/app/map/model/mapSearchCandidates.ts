import { hasBuildingLocation, type FullListBuilding } from './fullBuildingList';

export type MapSearchCandidate = FullListBuilding;

const normalize = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();

function relevance(building: MapSearchCandidate, query: string): number {
  const name = normalize(building.name);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (building.former_names?.some(former => normalize(former).includes(query))) return 3;
  return 4; // matched via submarket, owner or property management upstream
}

/** Rank only the already-authorized, already-filtered and locatable map results. */
export function rankMapSearchCandidates(
  buildings: MapSearchCandidate[],
  query: string,
  limit = 6,
): { total: number; items: MapSearchCandidate[] } {
  const normalized = normalize(query);
  if (!normalized) return { total: 0, items: [] };
  const positioned = buildings
    .filter(hasBuildingLocation)
    .map((building, index) => ({ building, index, score: relevance(building, normalized) }))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  return {
    total: positioned.length,
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
