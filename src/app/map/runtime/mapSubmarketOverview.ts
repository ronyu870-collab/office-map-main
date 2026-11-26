import type { SubmarketSummary } from '../model/submarketOverview';

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
export function createAreaPlaceholder(name: string, open: () => void, _mode: AreaRenderMode = 'default', summary?: SubmarketSummary): HTMLButtonElement {
  void _mode;
  const bubble = document.createElement('button');
  bubble.type = 'button'; bubble.title = name;
  bubble.setAttribute('aria-label', `查看${name}子市场介绍`);
  const hasStock = (summary?.officeCount ?? 0) + (summary?.parkCount ?? 0) > 0;
  bubble.className = hasStock ? 'map-submarket-bubble' : NAME_ONLY_BUBBLE_CLASS;
  const heading = document.createElement('span');
  heading.className = 'map-submarket-bubble__name'; heading.textContent = name; bubble.append(heading);
  if (hasStock) {
    const metrics = document.createElement('div'); metrics.className = 'map-submarket-bubble__metrics';
    const rent = document.createElement('span'); rent.className = 'map-submarket-bubble__primary';
    rent.textContent = summary?.rent != null ? `¥${summary.rent.toFixed(1)}` : '¥—';
    const vacant = document.createElement('span'); vacant.className = 'map-submarket-bubble__secondary';
    vacant.textContent = summary?.vacancyPct != null ? `${summary.vacancyPct.toFixed(1)}%` : '—';
    metrics.append(rent, vacant);
    const count = document.createElement('div'); count.className = 'map-submarket-bubble__count';
    count.textContent = summary?.officeCount ? `甲乙级 ${summary.officeCount} 个` : `产业园 ${summary?.parkCount ?? 0} 个`;
    bubble.append(metrics, count);
  }
  bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
  return bubble;
}
