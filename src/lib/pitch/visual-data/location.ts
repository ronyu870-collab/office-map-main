import { mercatorPoint } from '@/src/app/map/runtime/mapExtent';
import { coordinateIssue } from '@/src/lib/map-coordinates';
import { normalizeMapSubmarket } from '@/src/app/map/model/marketIdentity';
import { sceneFont, wrapText } from '../layout/metrics';
import { svgText } from './svg-text';

const WIDTH = 1920, HEIGHT = 1080;
const FRAME = { left: 78, top: 184, right: 1322, bottom: 890 };
const CENTER = [(FRAME.left + FRAME.right) / 2, (FRAME.top + FRAME.bottom) / 2] as const;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const ASSET_SOURCE = '高力楼宇目录 · 现有地图点位';

export type LocationBuilding = {
  id: string;
  name: string;
  submarket: string | null;
  location_lat: number | null;
  location_lng: number | null;
};
type Point = { x: number; y: number };
type Marker = { building: LocationBuilding; number: number; target: boolean; point: Point | null; callout: Point | null };
export type LocationSchematic = {
  kind: 'coordinate-schematic';
  source: typeof ASSET_SOURCE;
  coordinateFrame: 'existing-amap-display';
  projection: 'web-mercator-schematic';
  title: string;
  width: number;
  height: number;
  asOf: null;
  markers: Marker[];
  scale: { meters: number; pixels: number };
  marketCoverage: { name: string; located: number; selected: number }[];
};

function placeCallouts(markers: Marker[]) {
  const placed: Point[] = [];
  const points = markers.flatMap(marker => marker.point ? [marker.point] : []);
  const distant = (candidate: Point, others: Point[], distance: number) =>
    others.every(other => Math.hypot(other.x - candidate.x, other.y - candidate.y) >= distance);
  for (const marker of [...markers].sort((a, b) => Number(b.target) - Number(a.target))) {
    if (!marker.point) continue;
    const { x, y } = marker.point;
    const candidates: Point[] = [];
    for (const radius of [46, 84, 124, 162, 200]) {
      for (let i = 0; i < 12; i++) {
        const angle = (i - 1) * Math.PI / 6;
        candidates.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
      }
    }
    marker.callout = candidates.find(candidate => candidate.x >= FRAME.left + 25 && candidate.x <= FRAME.right - 25
      && candidate.y >= FRAME.top + 25 && candidate.y <= FRAME.bottom - 25
      && (candidate.x < FRAME.right - 108 || candidate.y > FRAME.top + 122)
      && distant(candidate, points, 24) && distant(candidate, placed, 44)) ?? null;
    if (marker.callout) placed.push(marker.callout);
  }
}

/** Input is the same native coordinate pair passed to the existing AMap markers. No basemap geometry is copied. */
export function createLocationSchematic(buildings: readonly LocationBuilding[], targetId?: string, market = false): LocationSchematic | null {
  if (!buildings.length || (!market && buildings.length > 20)) throw new Error('PITCH_LOCATION_SELECTION');
  if (new Set(buildings.map(building => building.id)).size !== buildings.length
      || targetId && !buildings.some(building => building.id === targetId)) throw new Error('PITCH_LOCATION_SELECTION');
  const located = buildings.flatMap(building => coordinateIssue(building) === null
    ? [{ id: building.id, point: mercatorPoint(building.location_lng!, building.location_lat!) }] : []);
  if (!located.length) return null;
  const xs = located.map(({ point }) => point[0]), ys = located.map(({ point }) => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const midLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * midY)));
  const metersPerUnit = EARTH_CIRCUMFERENCE_M * Math.cos(midLat);
  const scale = Math.min((FRAME.right - FRAME.left - 180) / Math.max(maxX - minX, 1e-12),
    (FRAME.bottom - FRAME.top - 175) / Math.max(maxY - minY, 1e-12), 690 * metersPerUnit / 1000);
  const pixelsPerMeter = scale / metersPerUnit;
  const suggestedMeters = 215 / pixelsPerMeter;
  const magnitude = 10 ** Math.floor(Math.log10(suggestedMeters));
  const meters = ([5, 2, 1].find(step => step * magnitude <= suggestedMeters) ?? 1) * magnitude;
  const positions = new Map(located.map(({ id, point }) => [id, {
    x: CENTER[0] + (point[0] - midX) * scale,
    y: CENTER[1] + (point[1] - midY) * scale,
  }]));
  const ordered = market ? [...buildings].sort((a, b) => a.id.localeCompare(b.id, 'en')) : buildings;
  const markers = ordered.map((building, index) => ({ building, number: index + 1, target: building.id === targetId,
    point: positions.get(building.id) ?? null, callout: null }));
  if (!market) placeCallouts(markers);
  const groups = new Map<string, { name: string; located: number; selected: number }>();
  if (market) for (const marker of markers) {
    const name = normalizeMapSubmarket(marker.building.submarket) || '子市场未标注';
    const group = groups.get(name) ?? { name, located: 0, selected: 0 };
    group.selected++;
    if (marker.point) group.located++;
    groups.set(name, group);
  }
  return { kind: 'coordinate-schematic', coordinateFrame: 'existing-amap-display', projection: 'web-mercator-schematic',
    source: ASSET_SOURCE, asOf: null, title: market ? '子市场项目分布' : buildings.length === 1 ? '项目区位' : '竞品区位比较',
    width: WIDTH, height: HEIGHT, markers, scale: { meters, pixels: meters * pixelsPerMeter },
    marketCoverage: [...groups.values()].sort((a, b) => b.located - a.located || a.name.localeCompare(b.name, 'zh-CN')) };
}

const palette = ['#246781', '#4B775E', '#80663B', '#74577A', '#46579B', '#A35246', '#68694E', '#637C83',
  '#8E6A54', '#396B55', '#7F5D4E', '#766D86', '#546D9A', '#945D7A', '#7B745A', '#4E8587', '#926922', '#6E5865'];
const INK = '#20363F';
const TEXT = 23;

export async function locationSchematicSvg(scene: LocationSchematic) {
  const font = await sceneFont();
  const drawText = svgText(font);
  const drawLine = (x: number, y: number, tx: number, ty: number, stroke = '#C6D0CD') =>
    `<line x1="${x}" y1="${y}" x2="${tx}" y2="${ty}" stroke="${stroke}" stroke-width="2"/>`;
  const drawLabel = (label: string, x: number, y: number, width: number) =>
    wrapText(label.replace(/[\p{Cc}\p{Cf}]/gu, ' '), width / 96, TEXT * .75, font)
      .map((line, i, lines) => i < 2 ? drawText(x, y + i * 26, i === 1 && lines.length > 2 ? `${line.slice(0, -1)}…` : line, TEXT, INK) : '').join('');
  const market = scene.marketCoverage.length > 0;
  const overflow = scene.marketCoverage.length > palette.length ? scene.marketCoverage.slice(palette.length - 1) : [];
  const legend = overflow.length ? [...scene.marketCoverage.slice(0, palette.length - 1), {
    name: `其余 ${overflow.length} 个子市场`,
    located: overflow.reduce((count, group) => count + group.located, 0),
    selected: overflow.reduce((count, group) => count + group.selected, 0),
  }] : scene.marketCoverage;
  const groups = new Map(legend.map((item, index) => [item.name, overflow.length && index === legend.length - 1 ? '#8A9794' : palette[index]]));
  const missing = scene.markers.filter(marker => !marker.point).length;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#F8F8F5"/>`,
    drawText(FRAME.left, 108, scene.title, 46, INK, 700),
    drawText(FRAME.left, 151, `坐标示意图 · ${scene.markers.length - missing} 个已定位${missing ? ` · ${missing} 个缺坐标` : ''}`, TEXT, INK),
    `<rect x="${FRAME.left}" y="${FRAME.top}" width="${FRAME.right - FRAME.left}" height="${FRAME.bottom - FRAME.top}" fill="#EDF1EE"/>`,
    drawText(FRAME.right - 54, FRAME.top + 56, '北', TEXT, INK, 600, 'middle'),
    `<path d="M${FRAME.right - 54} ${FRAME.top + 68} l-8 17 h16 z" fill="${INK}"/>`,
  ];
  for (const marker of [...scene.markers].sort((a, b) => Number(a.target) - Number(b.target))) {
    if (!marker.point) continue;
    const { x, y } = marker.point;
    const color = marker.target ? '#A6522E' : market
      ? groups.get(normalizeMapSubmarket(marker.building.submarket) || '子市场未标注') ?? '#8A9794' : palette[0];
    if (marker.callout) parts.push(drawLine(x, y, marker.callout.x, marker.callout.y, color));
    parts.push(`<circle cx="${x}" cy="${y}" r="${marker.target ? 11 : market ? 5 : 7}" fill="${color}" stroke="#F8F8F5" stroke-width="2"/>`);
    if (marker.callout) parts.push(
      `<circle cx="${marker.callout.x}" cy="${marker.callout.y}" r="18" fill="${color}"/>`,
      drawText(marker.callout.x, marker.callout.y + 8, String(marker.number).padStart(2, '0'), TEXT, '#FFFFFF', 600, 'middle'),
    );
  }
  const legendX = 1374;
  parts.push(drawText(legendX, 210, market ? '子市场 · 已定位 / 样本' : '项目编号', TEXT, INK, 700));
  if (market) for (const [i, group] of legend.entries()) {
    const y = 252 + i * 37;
    parts.push(`<circle cx="${legendX + 8}" cy="${y - 7}" r="6" fill="${groups.get(group.name)}"/>`,
      drawText(legendX + 30, y, group.name, TEXT, INK),
      drawText(1838, y, `${group.located} / ${group.selected}`, TEXT, INK, 400, 'end'));
  }
  else for (const [i, marker] of scene.markers.entries()) {
    const column = i < 10 ? 0 : 1, x = legendX + column * 238, y = 256 + (i % 10) * 62;
    const label = marker.building.name + (marker.target ? '（目标）' : '') + (marker.point ? '' : '（缺坐标）');
    parts.push(drawText(x, y, String(marker.number).padStart(2, '0'), TEXT, marker.target ? '#A6522E' : INK, 700),
      drawLabel(label, x + 42, y, scene.markers.length > 10 ? 187 : 416));
  }
  const end = FRAME.left + scene.scale.pixels;
  parts.push(drawLine(FRAME.left, 929, end, 929, INK), drawLine(FRAME.left, 922, FRAME.left, 936, INK),
    drawLine(end, 922, end, 936, INK), drawText(end + 18, 937,
      `约 ${scene.scale.meters >= 1000 ? `${scene.scale.meters / 1000} km` : `${scene.scale.meters} m`}`, TEXT, INK),
    drawText(FRAME.left, 999, market ? `${scene.source} · 按当前目录子市场归类 · 无边界与底图` : `${scene.source} · 无底图`, TEXT, INK),
    '</svg>');
  return parts.join('');
}
