import {
  areaNumber, selectFloorRows, summarizePlan, unitLayout,
  type OccupancyStatus, type PlanFloor, type PlanSpace, type SpaceFilter,
} from './stackingPlanModel';

export type PresentationTower = { id: string; code: string; display_name: string };
export type PresentationInput<F extends PlanFloor = PlanFloor, S extends PlanSpace = PlanSpace> = {
  projectName: string;
  sourceDate: string | null;
  towers: PresentationTower[];
  floors: F[];
  spaces: S[];
  filter: SpaceFilter;
  search: string;
  onlyMatching: boolean;
};

const colors: Record<OccupancyStatus, { fill: string; text: string }> = {
  occupied: { fill: '#D9E9F6', text: '#194D79' },
  vacant: { fill: '#E7EBF0', text: '#4E6174' },
  other: { fill: '#DCE8DE', text: '#3E6853' },
  unknown: { fill: '#F2E5CD', text: '#815E25' },
};
const xml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
const number = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : '—';
const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 4) =>
  '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(0, w).toFixed(1) +
  '" height="' + Math.max(0, h).toFixed(1) + '" rx="' + radius + '" fill="' + fill + '"/>';
const text = (x: number, y: number, value: unknown, size: number, color: string, weight = 400, anchor = 'start') =>
  '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" fill="' + color + '" font-size="' + size +
  '" font-weight="' + weight + '" text-anchor="' + anchor +
  '" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif">' + xml(value) + '</text>';

function drawTower<F extends PlanFloor, S extends PlanSpace>(
  tower: PresentationTower, input: PresentationInput<F, S>, x: number,
): string {
  const localFloors = input.floors.filter(f => f.tower_id === tower.id)
    .sort((a, b) => b.level_order - a.level_order);
  const ids = new Set(localFloors.map(f => f.id));
  const localSpaces = input.spaces.filter(s => ids.has(s.floor_id));
  const summary = summarizePlan(localFloors, localSpaces);
  const matchedRows = selectFloorRows(localFloors, localSpaces,
    input.onlyMatching ? input.filter : 'all', input.onlyMatching ? input.search : '');
  const matches = new Map(matchedRows.map(r => [r.floor.id, r.spaces]));
  const y = 187, width = 884, innerX = x + 78, stripWidth = 665, height = 813;
  const result = [
    rect(x, y, width, height, '#FFFFFF', 12),
    '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="12" fill="none" stroke="#DCE3EB"/>',
    rect(x + 18, y + 19, 5, 42, '#003E7E', 2),
    text(x + 39, y + 48, tower.display_name, 27, '#172033', 600),
    text(x + 183, y + 46, '办公楼层 ' + summary.officeFloors, 17, '#5F6C7D'),
    text(x + 875, y + 46,
      '来源已租 ' + number(summary.occupiedArea) + '㎡  /  空置 ' + number(summary.vacantArea) + '㎡',
      17, '#53657A', 400, 'end'),
    '<line x1="' + (x + 22) + '" x2="' + (x + 862) + '" y1="' + (y + 75) +
      '" y2="' + (y + 75) + '" stroke="#E4EAF1"/>',
  ];
  const start = y + 92, step = Math.min(25, 664 / Math.max(localFloors.length, 1));
  for (const [i, floor] of localFloors.entries()) {
    const fy = start + i * step;
    const fullUnits = localSpaces.filter(s => s.floor_id === floor.id);
    const shown = input.onlyMatching ? (matches.get(floor.id) ?? []) : fullUnits;
    const layout = unitLayout(floor, shown, input.onlyMatching);
    const total = layout.items.reduce((sum, item) => sum + item.weight, 0) + layout.residual;
    const label = floor.floor_code.startsWith('B') ? floor.floor_code : floor.floor_code + 'F';
    result.push(text(x + 54, fy + 17, label, 15, '#42576C', 600, 'end'));
    result.push(rect(innerX, fy + 1, stripWidth, 21, '#F5F7FA', 3));
    let left = innerX;
    for (const space of shown) {
      const weight = layout.items.find(item => item.id === space.id)?.weight ?? 0;
      const w = total > 0 ? stripWidth * weight / total : 0;
      if (w >= 1) {
        const palette = colors[space.occupancy_status];
        result.push(rect(left + 0.7, fy + 1, Math.max(0, w - 1.4), 21, palette.fill, 2));
        if (w >= 88) {
          const name = (space.tenant_name || (space.occupancy_status === 'vacant' ? '空置' :
            space.occupancy_status === 'unknown' ? '待确认' : space.unit_code)).trim();
          const limit = Math.max(3, Math.floor((w - 18) / 14));
          result.push(text(left + w / 2, fy + 16,
            name.length > limit ? name.slice(0, limit - 1) + '…' : name,
            13, palette.text, 500, 'middle'));
        }
      }
      left += w;
    }
    if (layout.residual > 0.1 && total > 0) {
      result.push(rect(left, fy + 1, stripWidth * layout.residual / total, 21, '#F0F2F5', 2));
    }
    const area = areaNumber(floor.floor_area_sqm);
    result.push(text(x + 865, fy + 17, area === null ? '—' : number(area) + '㎡',
      14, '#6B7788', 400, 'end'));
  }
  if (!localFloors.length) result.push(text(x + 442, y + 420, '暂无楼层记录', 20, '#667085', 400, 'middle'));
  result.push(text(x + 23, y + 785,
    '浅色块为来源记录；空白、未分配面积及状态不明不计为可出租房源',
    15, '#667085'));
  return result.join('');
}

/**
 * Presentation export uses the same source-only occupancy projection as the
 * workspace, without inventing tenancy, geometry or real-time vacancy.
 * The 1920×1080 viewBox remains crisp in high-resolution PNG conversions.
 */
export function createStackingPresentationSvg<F extends PlanFloor, S extends PlanSpace>(
  input: PresentationInput<F, S>,
): string {
  const towers = input.towers.slice(0, 2);
  const document = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">',
    rect(0, 0, 1920, 1080, '#F5F7FA', 0),
    rect(0, 0, 1920, 9, '#003E7E', 0),
    text(55, 61, 'COLLIERS  /  INTELLIGENCE PLATFORM', 19, '#003E7E', 700),
    text(55, 119, input.projectName + '  ·  租赁分层总览', 36, '#172033', 600),
    text(57, 159, '数据截至 ' + (input.sourceDate || '未知') + '  ·  来源快照  ·  逐项未核验',
      18, '#6C7481'),
  ];
  if (towers.length === 1) {
    document.push(drawTower(towers[0], input, 517));
  } else {
    towers.forEach((tower, index) => document.push(drawTower(tower, input, index ? 979 : 55)));
  }
  document.push(rect(54, 1018, 14, 14, colors.occupied.fill),
    text(77, 1031, '已租', 16, '#526478'),
    rect(172, 1018, 14, 14, colors.vacant.fill),
    text(195, 1031, '空置', 16, '#526478'),
    rect(292, 1018, 14, 14, colors.other.fill),
    text(315, 1031, '其他用途', 16, '#526478'),
    rect(452, 1018, 14, 14, colors.unknown.fill),
    text(475, 1031, '待确认', 16, '#526478'),
    text(1861, 1031, '仅供内部展示 · 不代表正式销控', 16, '#7A6472', 400, 'end'),
    '</svg>');
  return document.join('');
}
