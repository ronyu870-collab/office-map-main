import {
  areaNumber, selectFloorRows, unitLayout,
  type OccupancyStatus, type PlanFloor, type PlanSpace, type SpaceFilter,
} from './stackingPlanModel';

export type PresentationTower = { id: string; code: string; display_name: string };
export type PresentationInput<F extends PlanFloor = PlanFloor, S extends PlanSpace = PlanSpace> = {
  projectName: string;
  sourceDate: string | null;
  sourceNotice?: string;
  towers: PresentationTower[];
  floors: F[];
  spaces: S[];
  filter: SpaceFilter;
  search: string;
  onlyMatching: boolean;
};

const colors: Record<OccupancyStatus, { fill: string; ink: string }> = {
  occupied: { fill: '#DCEAF4', ink: '#234E71' },
  vacant: { fill: '#EEF1F5', ink: '#516475' },
  other: { fill: '#E6EFE7', ink: '#456750' },
  unknown: { fill: '#F6EDDB', ink: '#775A32' },
};
const xml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
const format = (n: unknown) => {
  const area = areaNumber(n as number | string | null);
  return area === null ? '' : area.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + '㎡';
};
const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke = '') =>
  '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(0,w).toFixed(1) +
  '" height="' + Math.max(0,h).toFixed(1) + '" rx="' + radius +
  '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '"' : '') + '/>';
const svgText = (x: number, y: number, value: unknown, size: number, ink: string, weight = 400, anchor = 'start') =>
  '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" font-size="' + size +
  '" fill="' + ink + '" font-weight="' + weight + '" text-anchor="' + anchor +
  '" font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif">' + xml(value) + '</text>';
const label = (space: PlanSpace) => (space.tenant_name?.trim()
  || (space.occupancy_status === 'vacant' ? '空置'
    : space.occupancy_status === 'other' ? '其他用途'
      : space.occupancy_status === 'unknown' ? '待确认' : space.unit_code)) +
  (format(space.area_sqm) ? ' · ' + format(space.area_sqm) : '');

const WIDTH = 2048;
const CARD_WIDTH = 968;
const ROW_HEIGHT = 37;
const CARD_TOP = 174;

function drawTower<F extends PlanFloor, S extends PlanSpace>(
  tower: PresentationTower, input: PresentationInput<F, S>, x: number, height: number, text: typeof svgText,
): string {
  const floors = input.floors.filter(f => f.tower_id === tower.id)
    .sort((a, b) => b.level_order - a.level_order);
  const ids = new Set(floors.map(f => f.id));
  const spaces = input.spaces.filter(s => ids.has(s.floor_id));
  const subset = input.onlyMatching && (input.filter !== 'all' || input.search.trim().length > 0);
  const chosen = selectFloorRows(floors, spaces, subset ? input.filter : 'all',
    subset ? input.search : '');
  const matches = new Map(chosen.map(r => [r.floor.id, r.spaces]));
  const titleY = CARD_TOP + 49;
  const startY = CARD_TOP + 112;
  const stripX = x + 79, stripW = 726;
  const elements = [
    rect(x, CARD_TOP, CARD_WIDTH, height, '#FFFFFF', 10, '#DCE4EB'),
    rect(x, CARD_TOP, CARD_WIDTH, 5, '#163E67', 0),
    text(x + 29, titleY, tower.display_name, 29, '#20354B', 700),
    text(x + CARD_WIDTH - 28, titleY, floors.length + '层', 17, '#66788A', 400, 'end'),
    text(x + 53, startY - 21, '楼层', 14, '#718296', 400, 'middle'),
    text(stripX + 10, startY - 21, '租户 / 单元面积', 14, '#718296'),
    text(x + CARD_WIDTH - 25, startY - 21, '建筑面积', 14, '#718296', 400, 'end'),
    '<line x1="' + (x + 21) + '" y1="' + (startY - 9) + '" x2="' +
      (x + CARD_WIDTH - 21) + '" y2="' + (startY - 9) + '" stroke="#E1E8EE"/>',
  ];
  for (const [index, floor] of floors.entries()) {
    const fy = startY + index * ROW_HEIGHT;
    const all = spaces.filter(s => s.floor_id === floor.id);
    const shown = subset ? matches.get(floor.id) ?? [] : all;
    const layout = unitLayout(floor, shown, subset);
    const total = layout.items.reduce((sum, item) => sum + item.weight, 0) + layout.residual;
    const code = floor.floor_code.startsWith('B') ? floor.floor_code : floor.floor_code + 'F';
    elements.push(text(x + 53, fy + 24, code, 16, '#344D65', 600, 'middle'));
    elements.push(rect(stripX, fy + 3, stripW, ROW_HEIGHT - 6, '#F3F5F7', 3));
    let cursor = stripX;
    for (const space of shown) {
      const weight = layout.items.find(item => item.id === space.id)?.weight ?? 0;
      const width = total ? stripW * weight / total : 0;
      if (width >= 1) {
        const palette = colors[space.occupancy_status];
        elements.push(rect(cursor + 1, fy + 3, Math.max(0, width - 2),
          ROW_HEIGHT - 6, palette.fill, 2));
        if (width > 54) {
          const raw = label(space);
          const available = Math.max(2, Math.floor((width - 10) / 13.5));
          const value = raw.length > available ? raw.slice(0, available - 1) + '…' : raw;
          elements.push(text(cursor + width / 2, fy + 24, value, 14, palette.ink, 500, 'middle'));
        }
      }
      cursor += width;
    }
    if (layout.residual > 0.1 && total > 0) {
      const remainder = stripW * layout.residual / total;
      elements.push(rect(cursor, fy + 3, remainder, ROW_HEIGHT - 6, '#F3F5F7', 2));
    }
    elements.push(text(x + CARD_WIDTH - 25, fy + 24, format(floor.floor_area_sqm) || '—',
      14, '#627487', 400, 'end'));
    elements.push('<line x1="' + (x + 21) + '" y1="' + (fy + ROW_HEIGHT) + '" x2="' +
      (x + CARD_WIDTH - 21) + '" y2="' + (fy + ROW_HEIGHT) + '" stroke="#EFF2F5"/>');
  }
  if (!floors.length) elements.push(text(x + CARD_WIDTH / 2, startY + 55, '暂无楼层记录',
    18, '#7A8998', 400, 'middle'));
  return elements.join('');
}

export function stackingPresentationSize(input: Pick<PresentationInput, 'towers' | 'floors'>) {
  const maxFloors = Math.max(1, ...input.towers.slice(0, 2).map(tower =>
    input.floors.filter(f => f.tower_id === tower.id).length));
  const cardHeight = 131 + ROW_HEIGHT * maxFloors;
  return { width: WIDTH, height: CARD_TOP + cardHeight + 88, cardHeight };
}

/**
 * Dynamic-height vector master. The PNG path rasterizes this at a bounded
 * high-density scale. The output height grows with the actual tower floors,
 * so no rows get squeezed into an arbitrary 1080px report frame.
 */
export function createStackingPresentationSvg<F extends PlanFloor, S extends PlanSpace>(
  input: PresentationInput<F, S>, text = svgText,
): string {
  const towers = input.towers.slice(0, 2);
  const { cardHeight, height } = stackingPresentationSize(input);
  const subset = input.onlyMatching && (input.filter !== 'all' || input.search.trim().length > 0);
  const result = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + WIDTH + '" height="' + height +
      '" viewBox="0 0 ' + WIDTH + ' ' + height + '">',
    rect(0, 0, WIDTH, height, '#F7F9FB'),
    rect(0, 0, WIDTH, 8, '#163E67'),
    text(52, 67, input.projectName + ' · Stacking Plan', 37, '#1A354F', 700),
    subset ? text(53, 105, '筛选结果', 15, '#64788A') : '',
    input.sourceNotice ? text(53, 140, input.sourceNotice, 23, '#526779') : '',
  ];
  if (towers.length === 1) {
    result.push(drawTower(towers[0], input, (WIDTH - CARD_WIDTH) / 2, cardHeight, text));
  } else {
    towers.forEach((tower, i) => result.push(drawTower(tower, input, i ? 1044 : 36, cardHeight, text)));
  }
  const foot = CARD_TOP + cardHeight + 37;
  ([
    ['已租', colors.occupied.fill], ['空置', colors.vacant.fill],
    ['其他用途', colors.other.fill], ['待确认', colors.unknown.fill],
  ] as const).forEach(([name, color], index) => {
    const start = 53 + index * 150;
    result.push(rect(start, foot - 14, 16, 16, color, 3));
    result.push(text(start + 25, foot, name, 15, '#526779'));
  });
  if (input.sourceDate) result.push(text(WIDTH - 55, foot, input.sourceDate,
    14, '#718296', 400, 'end'));
  result.push('</svg>');
  return result.join('');
}
