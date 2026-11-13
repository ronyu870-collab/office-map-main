import { z } from 'zod';
import { cellText, resultScopeText, resultSummary, units, type DisplayCell, type QueryResultView } from './presentation';

/** The caller chooses bindings, never numbers, labels, units or source records. */
export const chartRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bar'), field: z.string().min(1).max(80) }),
  z.strictObject({ kind: z.literal('scatter'), x: z.string().min(1).max(80), y: z.string().min(1).max(80) }),
  z.strictObject({ kind: z.literal('period_comparison') }),
]);
export type ChartRequest = z.infer<typeof chartRequestSchema>;
type CellBinding = { entityId: string; key: string; sourceIds: readonly string[] };
export type ChartPoint = { label: string; x: number | string | null; y: number | null; xText: string; yText: string;
  xCell: CellBinding | null; yCell: CellBinding; state: 'valid' | 'unknown' };
export type ResultChart = { version: 'result-chart/1'; resultId: string; tableId: string; request: ChartRequest;
  kind: 'bar' | 'scatter'; title: string; xLabel: string; yLabel: string; xUnit: string | null; yUnit: string;
  points: ChartPoint[]; summary: string[]; limitations: string[]; renderedCount: number; unknownCount: number;
  connectNulls: false; zeroBaseline: true };

const projected = (cell: DisplayCell, unit: string | null) => {
  if (cell.kind !== 'number') return null;
  const n = cell.value.numeric * (unit === 'ratio' ? 100 : 1);
  if (!Number.isFinite(n)) throw new Error('CHART_RANGE_UNSUPPORTED');
  return n;
};

export function buildResultChart(result: QueryResultView, request: ChartRequest): ResultChart {
  request = chartRequestSchema.parse(request);
  const column = (key: string) => {
    const found = result.table.columns.find(c => c.key === key);
    if (!found || !found.unit || result.table.rows.some(row => row.cells[key]?.kind === 'text')) throw new Error('CHART_NUMERIC_COLUMN_REQUIRED');
    return found;
  };
  const binding = (entityId: string, key: string, cell: DisplayCell): CellBinding => ({ entityId, key, sourceIds: [...cell.sourceIds] });
  let xLabel = '楼宇', xUnit: string | null = null;
  let yColumn: { key: string; label: string; unit: string | null };
  let points: ChartPoint[];
  if (request.kind === 'period_comparison') {
    if (result.operation !== 'compare' || result.table.rows.length !== 1) throw new Error('CHART_COMPARISON_REQUIRED');
    yColumn = column('base'); const current = column('current');
    if (current.unit !== yColumn.unit) throw new Error('CHART_UNIT_MISMATCH');
    xLabel = '季度';
    points = [yColumn, current].map(c => {
      const row = result.table.rows[0], cell = row.cells[c.key];
      return { label: c.label, x: c.label, y: projected(cell, c.unit), xText: c.label, yText: cellText(cell, c.unit),
        xCell: null, yCell: binding(row.entityId, c.key, cell), state: cell.kind === 'number' ? 'valid' : 'unknown' };
    });
  } else {
    if (result.operation === 'compare') throw new Error('CHART_COMPARISON_REQUIRED');
    yColumn = column(request.kind === 'scatter' ? request.y : request.field);
    const xColumn = request.kind === 'scatter' ? column(request.x) : result.table.columns.find(c => c.key === 'name');
    if (request.kind === 'scatter') {
      if (result.operation !== 'list' || request.x === request.y) throw new Error('CHART_JOINT_SAMPLE_REQUIRED');
      xLabel = xColumn!.label; xUnit = xColumn!.unit;
    }
    points = result.table.rows.map(row => {
      const y = row.cells[yColumn.key], x = xColumn ? row.cells[xColumn.key] : null;
      const label = row.cells.name?.kind === 'text' ? row.cells.name.value : yColumn.label;
      const numericX = request.kind === 'scatter' && x ? projected(x, xUnit) : label;
      const numericY = projected(y, yColumn.unit);
      return { label, x: numericX, y: numericY, xText: x ? cellText(x, xUnit) : label, yText: cellText(y, yColumn.unit),
        xCell: x && xColumn ? binding(row.entityId, xColumn.key, x) : null, yCell: binding(row.entityId, yColumn.key, y),
        state: numericX !== null && numericY !== null ? 'valid' : 'unknown' };
    });
  }
  const renderedCount = points.filter(p => p.state === 'valid').length;
  for (const axis of ['x', 'y'] as const) {
    const bounds = points.reduce(([min, max], p) => typeof p[axis] === 'number'
      ? [Math.min(min, p[axis]), Math.max(max, p[axis])] : [min, max], [0, 0]);
    if (!Number.isFinite(bounds[1] - bounds[0])) throw new Error('CHART_RANGE_UNSUPPORTED');
  }
  return { version: 'result-chart/1', resultId: result.resultId, tableId: result.table.id, request,
    kind: request.kind === 'scatter' ? 'scatter' : 'bar', title: resultScopeText(result), xLabel,
    yLabel: request.kind === 'period_comparison' ? ({ rent: '面积加权净有效租金', vacancy: '空置率', totalArea: '总面积' }[result.parameters.metric as 'rent' | 'vacancy' | 'totalArea'] ?? '指标') : yColumn.label,
    xUnit, yUnit: yColumn.unit!, points, renderedCount, unknownCount: points.length - renderedCount, connectNulls: false, zeroBaseline: true,
    summary: resultSummary(result), limitations: [...result.limitations,
      ...(request.kind === 'scatter' ? ['散点仅绘制两个字段都有有效数值的联合样本；不据此推断因果关系。'] : []),
      '图形位置使用数值近似值，标签保留原结果的精确值舍入；未知不按零绘制。',
      ...(result.operation === 'rank' ? ['图示范围沿用本次排名及末位并列，不重新截取前 N。'] : []),
    ] };
}

/** Ratio levels use the full 0–100% domain, not the current largest value. */
export function chartBounds(chart: ResultChart, axis: 'x' | 'y'): [number, number] {
  if ((axis === 'x' ? chart.xUnit : chart.yUnit) === 'ratio') return [0, 100];
  return chart.points.reduce<[number, number]>(([min, max], point) => typeof point[axis] === 'number'
    ? [Math.min(min, point[axis]), Math.max(max, point[axis])] : [min, max], [0, 0]);
}

// Fixed renderer: no HTML, script, external URL, font fetch or user supplied SVG.
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '\uFFFD')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const wrap = (value: string, size: number): string[] => {
  const chars = Array.from(value); return chars.length ? Array.from({ length: Math.ceil(chars.length / size) }, (_, i) => chars.slice(i * size, (i + 1) * size).join('')) : [''];
};

/** Standalone export retains scope, coverage, limitations and exact cell/source
 * bindings. Large plots fail explicitly rather than silently dropping rows. */
export function renderChartSvg(chart: ResultChart): string {
  if (chart.points.length > (chart.kind === 'bar' ? 1000 : 5000)) throw new Error('CHART_SIZE_LIMIT');
  const width = 960, left = 300, right = 780, top = 36;
  const elements: string[] = [];
  const text = (x: number, y: number, value: string, extra = '') => elements.push(`<text x="${x}" y="${y}" ${extra}>${xml(value)}</text>`);
  const paragraph = (content: string, y: number, size = 64) => { const lines = wrap(content, size); lines.forEach((line, i) => text(24, y + i * 22, line)); return y + lines.length * 22 + 8; };
  let y = paragraph(chart.title, top);
  for (const line of chart.summary) y = paragraph(line, y);
  y = paragraph(`${chart.yLabel}（${units[chart.yUnit] ?? chart.yUnit}）；有效图示 ${chart.renderedCount} 项，未知 ${chart.unknownCount} 项。`, y);
  if (chart.kind === 'bar') {
    const [min, max] = chartBounds(chart, 'y');
    const span = max - min;
    if (!Number.isFinite(span)) throw new Error('CHART_RANGE_UNSUPPORTED');
    const scale = (value: number) => left + (value - min) / (span || 1) * (right - left);
    const zero = scale(0); y += 12;
    text(left, y, String(min)); text(right, y, String(max), 'text-anchor="end"'); y += 16;
    const start = y;
    for (const p of chart.points) {
      const labels = wrap(p.label, 16), rowHeight = Math.max(44, labels.length * 22 + 16);
      labels.forEach((line, i) => text(24, y + 24 + i * 22, line));
      if (p.y !== null) {
        const end = scale(p.y);
        elements.push(`<rect x="${Math.min(zero, end)}" y="${y + 8}" width="${Math.abs(end - zero)}" height="24" fill="#003e7e"><title>${xml(p.label + '：' + p.yText)}</title></rect>`);
      }
      wrap(p.yText, 9).forEach((line, i) => text(804, y + 24 + i * 22, line));
      y += Math.max(rowHeight, wrap(p.yText, 9).length * 22 + 16);
    }
    elements.push(`<line x1="${zero}" x2="${zero}" y1="${start}" y2="${y}" stroke="#667085"/>`);
  } else {
    const valid = chart.points.filter(p => p.state === 'valid');
    const [xmin, xmax] = chartBounds(chart, 'x'), [ymin, ymax] = chartBounds(chart, 'y');
    if (![xmax - xmin, ymax - ymin].every(Number.isFinite)) throw new Error('CHART_RANGE_UNSUPPORTED');
    const plotTop = y + 20, plotBottom = plotTop + 320;
    const sx = (n: number) => 120 + (n - xmin) / (xmax - xmin || 1) * 660;
    const sy = (n: number) => plotBottom - (n - ymin) / (ymax - ymin || 1) * 320;
    elements.push(`<path d="M120 ${plotTop} V${plotBottom} H780" fill="none" stroke="#667085"/>`);
    for (const p of valid) elements.push(`<circle cx="${sx(p.x as number)}" cy="${sy(p.y!)}" r="4" fill="#003e7e"><title>${xml(`${p.label}：${p.xText}，${p.yText}`)}</title></circle>`);
    text(100, plotTop + 5, String(ymax), 'text-anchor="end"'); text(100, plotBottom, String(ymin), 'text-anchor="end"');
    text(120, plotBottom + 24, String(xmin)); text(780, plotBottom + 24, String(xmax), 'text-anchor="end"');
    y = paragraph(`${chart.xLabel}（${units[chart.xUnit ?? ''] ?? chart.xUnit ?? ''}）`, plotBottom + 52);
  }
  y += 24;
  for (const limitation of chart.limitations) y = paragraph(limitation, y);
  y = paragraph(`结果 ${chart.resultId}；完整来源、精确值及条件见同包 manifest.json。仅供内部分析。`, y);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y + 16}" viewBox="0 0 ${width} ${y + 16}" role="img"><title>${xml(chart.yLabel)}</title><desc>${xml(chart.title)}</desc><metadata>${xml(JSON.stringify(chart))}</metadata><rect width="100%" height="100%" fill="#fff"/><g font-family="system-ui, sans-serif" font-size="14" font-weight="400" fill="#172033">${elements.join('')}</g></svg>`;
}
