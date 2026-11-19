import type { SubmarketSummary } from '../model/submarketOverview';

type AreaRenderMode = 'default' | 'rent' | 'vacancy' | 'leed';

type AreaAnchor = {
  name: string;
  center: [number, number];
  // Supplied by the area lead when the stock list has no usable rent data for
  // the market, so the bubble does not have to derive a weighted average.
  fixedRent?: number;
};

const AREA_ANCHORS: readonly AreaAnchor[] = [
  // Use the midpoint of the two verified stock projects when neither is positioned.
  { name: '玉渊潭', center: [116.296894, 39.9249965], fixedRent: 150 },
  // AMap 四季青桥站 (BV09179854), GCJ-02. This is an orientation point, not a boundary or building.
  { name: '四季青', center: [116.274193, 39.942414], fixedRent: 140 },
];

export const NAME_ONLY_BUBBLE_CLASS = 'map-submarket-bubble map-submarket-bubble--name-only';

export function getAreaFixedRent(name: string): number | null {
  return AREA_ANCHORS.find(area => area.name === name)?.fixedRent ?? null;
}

export function isNameOnlyArea(name: string, mode: AreaRenderMode = 'default'): boolean {
  const anchor = AREA_ANCHORS.find(area => area.name === name);
  if (!anchor) return false;
  // Areas without a fixed rent never show metrics; areas with one show it only
  // where rent is the metric being read.
  if (anchor.fixedRent === undefined) return true;
  return mode !== 'default' && mode !== 'rent';
}

export function getAreaPlaceholders(overview: boolean, positionedNames: ReadonlySet<string>) {
  return overview ? AREA_ANCHORS.filter(({ name }) => !positionedNames.has(name)) : [];
}

export function createAreaPlaceholder(
  name: string,
  open: () => void,
  mode: AreaRenderMode = 'default',
  summary?: SubmarketSummary,
): HTMLButtonElement {
  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.title = name;
  bubble.setAttribute('aria-label', `查看${name}子市场介绍`);

  const fixedRent = getAreaFixedRent(name);
  const hasOffice = (summary?.officeCount ?? 0) > 0;
  const showReference = !hasOffice && fixedRent !== null && !isNameOnlyArea(name, mode);
  bubble.className = hasOffice || showReference ? 'map-submarket-bubble' : NAME_ONLY_BUBBLE_CLASS;

  const heading = document.createElement('span');
  heading.className = 'map-submarket-bubble__name';
  heading.textContent = name;
  bubble.append(heading);

  if (hasOffice) {
    const metrics = document.createElement('div');
    metrics.className = 'map-submarket-bubble__metrics';
    const rent = document.createElement('span');
    rent.className = 'map-submarket-bubble__primary';
    rent.textContent = summary?.rent != null ? `¥${summary.rent.toFixed(1)}` : fixedRent !== null ? `¥${fixedRent}*` : '¥—';
    const separator = document.createElement('span');
    separator.className = 'map-submarket-bubble__sep';
    separator.textContent = '·';
    const vacant = document.createElement('span');
    vacant.className = 'map-submarket-bubble__secondary';
    vacant.textContent = summary?.vacancyPct != null ? `${summary.vacancyPct.toFixed(1)}%` : '—';
    metrics.append(rent, separator, vacant);
    const count = document.createElement('div');
    count.className = 'map-submarket-bubble__count';
    count.textContent = `甲乙级 ${summary?.officeCount ?? 0} 个`;
    bubble.append(metrics, count);
  } else if (showReference) {
    const metrics = document.createElement('div');
    metrics.className = 'map-submarket-bubble__metrics';
    const primary = document.createElement('span');
    primary.className = 'map-submarket-bubble__primary';
    primary.textContent = `¥${fixedRent}*`;
    metrics.append(primary);
    bubble.append(metrics);
    bubble.title = `${name} · *区域参考租金，非加权均值`;
  }

  bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
  return bubble;
}
