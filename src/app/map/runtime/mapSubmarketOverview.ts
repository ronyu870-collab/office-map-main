type AreaAnchor = { name: string; center: [number, number] };

const AREA_ANCHORS: readonly AreaAnchor[] = [
  // Use the midpoint of the two verified stock projects when neither is positioned.
  { name: '玉渊潭', center: [116.296894, 39.9249965] },
  // AMap 四季青桥站 (BV09179854), GCJ-02. This is an orientation point, not a boundary or building.
  { name: '四季青', center: [116.274193, 39.942414] },
];

export function getAreaPlaceholders(overview: boolean, positionedNames: ReadonlySet<string>) {
  return overview ? AREA_ANCHORS.filter(({ name }) => !positionedNames.has(name)) : [];
}

export function createAreaPlaceholder(name: string, open: () => void): HTMLButtonElement {
  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.title = name;
  bubble.className = 'map-submarket-bubble map-submarket-bubble--pending';
  bubble.setAttribute('aria-label', `${name}，资料待补`);

  const heading = document.createElement('span');
  heading.className = 'map-submarket-bubble__name';
  heading.textContent = name;
  const status = document.createElement('span');
  status.className = 'map-submarket-bubble__metrics';
  status.textContent = '资料待补';
  bubble.append(heading, status);
  bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
  return bubble;
}
