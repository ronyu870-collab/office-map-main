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
): HTMLButtonElement {
  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.title = name;

  const fixedRent = getAreaFixedRent(name);
  const showRent = fixedRent !== null && !isNameOnlyArea(name, mode);
  bubble.className = showRent ? 'map-submarket-bubble' : NAME_ONLY_BUBBLE_CLASS;

  const heading = document.createElement('span');
  heading.className = 'map-submarket-bubble__name';
  heading.textContent = name;
  bubble.append(heading);

  if (showRent) {
    const metrics = document.createElement('div');
    metrics.className = 'map-submarket-bubble__metrics';
    const primary = document.createElement('span');
    primary.className = 'map-submarket-bubble__primary';
    primary.textContent = `¥${fixedRent}`;
    metrics.append(primary);
    bubble.append(metrics);
  }

  bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
  return bubble;
}
