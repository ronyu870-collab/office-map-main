type AreaAnchor = { name: string; center: [number, number] };

const AREA_ANCHORS: readonly AreaAnchor[] = [
  // Use the midpoint of the two verified stock projects when neither is positioned.
  { name: '玉渊潭', center: [116.296894, 39.9249965] },
  // AMap 四季青桥站 (BV09179854), GCJ-02. This is an orientation point, not a boundary or building.
  { name: '四季青', center: [116.274193, 39.942414] },
];

export const NAME_ONLY_BUBBLE_CLASS = 'map-submarket-bubble map-submarket-bubble--name-only';

export function isNameOnlyArea(name: string): boolean {
  return AREA_ANCHORS.some(area => area.name === name);
}

export function getAreaPlaceholders(overview: boolean, positionedNames: ReadonlySet<string>) {
  return overview ? AREA_ANCHORS.filter(({ name }) => !positionedNames.has(name)) : [];
}

export function createAreaPlaceholder(name: string, open: () => void): HTMLButtonElement {
  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.title = name;
  bubble.className = NAME_ONLY_BUBBLE_CLASS;

  const heading = document.createElement('span');
  heading.className = 'map-submarket-bubble__name';
  heading.textContent = name;
  bubble.append(heading);
  bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
  return bubble;
}
