import { createSubmarketBubble } from './mapSubmarketPresentation';
import { summarizeSubmarkets, type SubmarketSummary } from '../model/submarketOverview';
import { aggregateMarket, type MarketBuilding } from '../model/marketStatistics';
import { normalizeLeed, normalizeMapSubmarket, officeGrade } from '../model/marketIdentity';
import { hasMapCoordinates } from '@/src/lib/map-coordinates';

type BubbleBuilding = MarketBuilding & { leed_certification?: unknown };
export type BubbleMarketSummary = SubmarketSummary & {
  parkFacts?: ReturnType<typeof aggregateMarket>;
  leedFacts?: { certified: number; negative: number; unknown: number; total: number; percent: number | null };
};

/** Only an explicitly recorded level or negative is a certification observation. */
export function mapLeedLevel(value: unknown): string {
  return normalizeLeed(value).toUpperCase();
}

/** Keep the A/B fact contract intact; park facts and certification coverage are separate. */
export function summarizeBubbleMarkets(buildings: readonly BubbleBuilding[]): Map<string, BubbleMarketSummary> {
  const summaries = summarizeSubmarkets(buildings);
  const groups = new Map<string, BubbleBuilding[]>();
  const seen = new Set<string>();
  for (const building of buildings) {
    const name = normalizeMapSubmarket(building.submarket);
    if (!name || name === '其他' || !building.id || seen.has(building.id)) continue;
    seen.add(building.id);
    const group = groups.get(name) ?? [];
    group.push(building);
    groups.set(name, group);
  }
  const result = new Map<string, BubbleMarketSummary>();
  for (const [name, group] of groups) {
    const summary = summaries.get(name);
    if (!summary) continue;
    let certified = 0, negative = 0, unknown = 0;
    for (const building of group) {
      const level = mapLeedLevel(building.leed_certification);
      if (level === 'N') negative++;
      else if (level === 'NULL') unknown++;
      else certified++;
    }
    const total = group.length;
    const parks = group.filter(building => officeGrade(building.grade) === 'park');
    result.set(name, { ...summary, parkFacts: parks.length ? aggregateMarket(parks) : undefined,
      leedFacts: { certified, negative, unknown, total, percent: total > 0 && unknown === 0 ? certified / total * 100 : null } });
  }
  return result;
}

function centers(rows: readonly BubbleBuilding[]) {
  const sums = new Map<string, { lng: number; lat: number; count: number }>();
  const seen = new Set<string>();
  for (const row of rows) {
    const name = normalizeMapSubmarket(row.submarket);
    if (!name || name === '其他' || !row.id || seen.has(row.id) || !hasMapCoordinates(row)) continue;
    seen.add(row.id);
    const sum = sums.get(name) ?? { lng: 0, lat: 0, count: 0 };
    sum.lng += Number(row.location_lng); sum.lat += Number(row.location_lat); sum.count++;
    sums.set(name, sum);
  }
  return new Map([...sums].map(([name, sum]) => [name, [sum.lng / sum.count, sum.lat / sum.count] as [number, number]]));
}

/** Catalog coordinates determine position only. Every metric uses the supplied filtered scope. */
export function buildSubmarketBubbleEntries(visible: readonly BubbleBuilding[], scope: readonly BubbleBuilding[] = visible,
  authorizedCatalog: readonly BubbleBuilding[] = visible, showPlaceholders = false) {
  const facts = summarizeBubbleMarkets(scope);
  const catalogCenters = centers(authorizedCatalog);
  const filteredCenters = centers(visible);
  const names = new Set(visible.map(row => normalizeMapSubmarket(row.submarket)).filter(name => name && name !== '其他'));
  const entries: { name: string; center: [number, number]; summary?: BubbleMarketSummary; placeholder: boolean }[] = [];
  for (const name of names) {
    const center = catalogCenters.get(name) ?? filteredCenters.get(name);
    if (center) entries.push({ name, center, summary: facts.get(name), placeholder: false });
  }
  for (const { name, center } of getAreaPlaceholders(showPlaceholders, new Set(entries.map(entry => entry.name)))) {
    entries.push({ name, center, summary: facts.get(name), placeholder: true });
  }
  return entries;
}

type AreaRenderMode = 'default' | 'rent' | 'vacancy' | 'leed';
const AREA_ANCHORS = [
  { name: '玉渊潭', center: [116.296894, 39.9249965] as [number, number] },
  { name: '四季青', center: [116.274193, 39.942414] as [number, number] },
];

/** Retain legacy evidence without inventing its business date or responsible author. */
export const LEGACY_RENT_REFERENCES = [
  { region: '玉渊潭', value: 150 }, { region: '四季青', value: 140 },
].map(entry => ({ ...entry, kind: 'reference_estimate' as const, source: 'legacy mapSubmarketOverview AREA_ANCHORS',
  asOf: null, maintainedBy: null, unit: '元/㎡/月', status: 'unverified' as const, allowAggregation: false as const, allowDisplay: false as const }));

export const NAME_ONLY_BUBBLE_CLASS = 'map-submarket-bubble map-submarket-bubble--name-only';
export function isNameOnlyArea(name: string, _mode: AreaRenderMode = 'default'): boolean {
  void _mode;
  return AREA_ANCHORS.some(area => area.name === name);
}
export function getAreaPlaceholders(overview: boolean, positionedNames: ReadonlySet<string>) {
  return overview ? AREA_ANCHORS.filter(({ name }) => !positionedNames.has(name)) : [];
}
export function createAreaPlaceholder(name: string, open: () => void, _mode: AreaRenderMode = 'default', summary?: BubbleMarketSummary, selected = false): HTMLButtonElement {
  const bubble = createSubmarketBubble({ name, summary, mode: _mode, selected });
  bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
  return bubble;
}
