import type { ChartRequest } from './chartSpec';
import type { ChartPoint, ResultChart } from './charts';
import { cellText, resultScopeText, resultSummary, units, type QueryResultView } from './presentation';

type Plot = Extract<ChartRequest, { kind: 'plot' }>;
const valueOf = (cell: QueryResultView['table']['rows'][number]['cells'][string], unit: string | null) =>
  cell.kind === 'number' ? cell.value.numeric * (unit === 'ratio' ? 100 : 1) : null;
const quarter = (s: string) => /^\d{4}-?Q[1-4]$/.test(s) ? Number(s.slice(0, 4)) * 4 + Number(s.at(-1)) - 1 : null;

/** No aggregation here: every point binds to an existing authorized cell. */
export function buildCartesianChart(result: QueryResultView, request: Plot): ResultChart {
  const col = (key: string) => {
    const c = result.table.columns.find(c => c.key === key);
    if (!c) throw new Error('CHART_FIELD_NOT_AVAILABLE');
    return c;
  };
  const x = col(request.x), ys = request.y.map(col), group = request.groupBy ? col(request.groupBy) : null;
  if (new Set(request.y).size !== ys.length || request.y.includes(request.x)) throw new Error('CHART_BINDING_INVALID');
  if (ys.some(c => !c.unit || c.unit !== ys[0].unit || result.table.rows.some(r => r.cells[c.key].kind === 'text')))
    throw new Error('CHART_SHARED_AXIS_UNIT_MISMATCH');
  if (group?.unit !== null && group !== null) throw new Error('CHART_CATEGORY_REQUIRED');
  if (request.type === 'scatter' && (!x.unit || ys.length !== 1)) throw new Error('CHART_NUMERIC_COLUMN_REQUIRED');
  if (request.type !== 'scatter' && x.unit && request.type !== 'line') throw new Error('CHART_CATEGORY_REQUIRED');
  const periodKeys = new Set(result.table.rows.flatMap(r => r.cells.period?.kind === 'text' ? [quarter(r.cells.period.value)] : []));
  if (request.periods && (new Set(request.periods.map(quarter)).size !== request.periods.length || request.periods.some(p => !periodKeys.has(quarter(p)))))
    throw new Error('CHART_PERIOD_NOT_AVAILABLE');
  const rows = result.table.rows.filter(r => { const period = r.cells.period; return !request.periods || period?.kind === 'text' && request.periods.some(p => quarter(p) === quarter(period.value)); });
  const grouped = new Map<string, { label: string; points: ChartPoint[] }>();
  for (const row of rows) {
    const xc = row.cells[x.key];
    if (x.unit && xc.kind === 'text') throw new Error('CHART_NUMERIC_COLUMN_REQUIRED');
    const category = xc.kind === 'text' ? xc.value : cellText(xc, x.unit);
    const name = row.cells.name?.kind === 'text' ? row.cells.name.value : category;
    const groupLabel = group ? cellText(row.cells[group.key], group.unit) : '';
    for (const y of ys) {
      const yc = row.cells[y.key], key = `${y.key}\u0000${groupLabel}`;
      if (!grouped.has(key)) grouped.set(key, { label: [groupLabel, y.label].filter(Boolean).join(' / '), points: [] });
      const px = x.unit ? valueOf(xc, x.unit) : category, py = valueOf(yc, y.unit);
      grouped.get(key)!.points.push({ label: request.type === 'scatter' ? name : category,
        x: px, y: py, xText: cellText(xc, x.unit), yText: cellText(yc, y.unit),
        xCell: { entityId: row.entityId, key: x.key, sourceIds: [...xc.sourceIds] },
        yCell: { entityId: row.entityId, key: y.key, sourceIds: [...yc.sourceIds] },
        state: px !== null && py !== null && xc.kind !== 'unknown' ? 'valid' : 'unknown' });
    }
  }
  if (grouped.size > 6) throw new Error('CHART_SERIES_LIMIT');
  const series = [...grouped].map(([key, s]) => ({ key, ...s }));
  if (request.type === 'line') {
    for (const s of series) {
      if (s.points.some(p => !x.unit && (typeof p.x !== 'string' || quarter(p.x) === null))) throw new Error('CHART_TIME_AXIS_REQUIRED');
      if (new Set(s.points.map(p => p.x)).size !== s.points.length) throw new Error('CHART_DUPLICATE_AXIS_POINT');
      s.points.sort((a, b) => x.unit ? Number(a.x) - Number(b.x) : quarter(String(a.x))! - quarter(String(b.x))!);
    }
  }
  if (request.type !== 'scatter' && series.some(s => new Set(s.points.map(p => p.x)).size !== s.points.length)) throw new Error('CHART_DUPLICATE_AXIS_POINT');
  const points = series.flatMap(s => s.points);
  if (points.length > (request.type === 'bar' || request.type === 'horizontal_bar' ? 1000 : 5000)) throw new Error('CHART_SIZE_LIMIT');
  return { version: 'result-chart/1', resultId: result.resultId, tableId: result.table.id, request,
    kind: request.type === 'scatter' ? 'scatter' : request.type === 'line' ? 'line' : 'bar',
    orientation: request.type === 'horizontal_bar' ? 'horizontal' : 'vertical',
    title: resultScopeText(result), xLabel: x.label, yLabel: ys.map(c => c.label).join(' / '),
    xUnit: x.unit, yUnit: ys[0].unit!, points, series,
    summary: resultSummary(result), limitations: [...result.limitations,
      '图示绑定原结果字段，不重新计算统计值；缺失不按零绘制。',
      ...(series.length > 1 ? ['各系列使用相同单位和共同数值轴；不混合租金、比例或百分点。'] : [])],
    renderedCount: points.filter(p => p.state === 'valid').length, unknownCount: points.filter(p => p.state === 'unknown').length,
    connectNulls: false, zeroBaseline: true };
}

export function configureChart(result: QueryResultView, chart: ResultChart): ResultChart {
  const req = chart.request;
  if (req.title) chart.title = req.title;
  if (req.sort) {
    const sort = req.sort;
    if ((chart.series?.length ?? 0) > 1 && req.kind === 'plot' && sort.field !== req.x) throw new Error('CHART_GROUP_SORT_AMBIGUOUS');
    if (chart.kind === 'line' || chart.kind === 'faceted_line' || chart.kind === 'heatmap' || chart.distribution)
      throw new Error('CHART_ORDER_IS_DETERMINED');
    const column = result.table.columns.find(c => c.key === sort.field);
    if (!column) throw new Error('CHART_FIELD_NOT_AVAILABLE');
    const order = new Map(result.table.rows.map(r => [r.entityId, r.cells[sort.field]]));
    const compare = (a: ChartPoint, b: ChartPoint) => {
      const ca = order.get(a.yCell.entityId)!, cb = order.get(b.yCell.entityId)!;
      if (ca.kind === 'unknown' || cb.kind === 'unknown') return ca.kind === cb.kind ? 0 : ca.kind === 'unknown' ? 1 : -1;
      let n: number;
      if (ca.kind === 'number' && cb.kind === 'number') {
        const l = BigInt(ca.value.exact.numerator) * BigInt(cb.value.exact.denominator);
        const r = BigInt(cb.value.exact.numerator) * BigInt(ca.value.exact.denominator);
        n = l < r ? -1 : l > r ? 1 : 0;
      } else n = cellText(ca, column.unit).localeCompare(cellText(cb, column.unit), 'zh-CN');
      return n * (sort.direction === 'asc' ? 1 : -1);
    };
    chart.points.sort(compare); chart.series?.forEach(s => s.points.sort(compare));
  }
  for (const axis of ['x', 'y'] as const) {
    const config = axis === 'x' ? req.xAxis : req.yAxis;
    const unit = axis === 'x' ? chart.xUnit : chart.yUnit;
    const actual = chart.points.flatMap(p => typeof p[axis] === 'number' ? [p[axis] as number] : []);
    if (unit === 'ratio' && actual.some(v => v < 0 || v > 100)) throw new Error('CHART_RATIO_RANGE_INVALID');
    if (!Number.isFinite(Math.max(0, ...actual) - Math.min(0, ...actual))) throw new Error('CHART_RANGE_UNSUPPORTED');
    if (!config) continue;
    if (!unit || chart.distribution) throw new Error('CHART_AXIS_CONFIGURATION_UNSUPPORTED');
    if (config.unit && config.unit !== unit) throw new Error('CHART_UNIT_MISMATCH');
    const values = chart.points.flatMap(p => typeof p[axis] === 'number' ? [p[axis] as number] : []);
    const min = config.min ?? (unit === 'ratio' ? 0 : Math.min(0, ...values));
    const defaultMax = unit === 'ratio' ? 100 : Math.max(0, ...values);
    const max = config.max ?? (defaultMax === min ? min + 1 : defaultMax);
    if (min >= max || values.some(v => v < min || v > max)
      || chart.kind === 'bar' && axis === 'y' && (min > 0 || max < 0)
      || unit === 'ratio' && (min < 0 || max > 100)) throw new Error('CHART_AXIS_RANGE_INVALID');
  }
  if (chart.points.some(p => typeof p.x === 'number' && !Number.isFinite(p.x) || p.y !== null && !Number.isFinite(p.y)))
    throw new Error('CHART_RANGE_UNSUPPORTED');
  if (req.kind === 'plot') cartesianGeometry(chart);
  return chart;
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '\uFFFD')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export const chartColors = ['#003e7e', '#a35632', '#467665', '#815783', '#597b96', '#826e36'];
export function axisDomain(chart: ResultChart, axis: 'x' | 'y'): [number, number] {
  const unit = axis === 'x' ? chart.xUnit : chart.yUnit, cfg = axis === 'x' ? chart.request.xAxis : chart.request.yAxis;
  const values = chart.points.flatMap(p => typeof p[axis] === 'number' ? [p[axis] as number] : []);
  const min = cfg?.min ?? (unit === 'ratio' ? 0 : Math.min(0, ...values));
  const max = cfg?.max ?? (unit === 'ratio' ? 100 : Math.max(0, ...values));
  return [min, max === min ? min + 1 : max];
}
export function axisTicks(domain: [number, number], count = 5) {
  return Array.from({ length: count }, (_, i) => domain[0] + i / (count - 1) * (domain[1] - domain[0]));
}
export function axisText(n: number, unit: string | null, interval?: number) {
  if (!Number.isFinite(n)) throw new Error('CHART_RANGE_UNSUPPORTED');
  // Projected ratios already use percentage units. Avoid raw floating tails and
  // preserve small tick intervals without changing the source cell precision.
  const digits = interval && Number.isFinite(interval) && interval > 0 ? Math.min(12, Math.max(2, 1 - Math.floor(Math.log10(interval)))) : Math.abs(n) > 0 && Math.abs(n) < .01 ? 6 : 2;
  return `${n.toLocaleString('zh-CN', { maximumFractionDigits: digits })}${unit === 'ratio' || unit === 'percent' ? '%' : unit === 'percentage_point' ? ' pp' : ''}`;
}

/** A single geometry contract shared by preview, SVG and PNG rasterization. */
export function cartesianGeometry(chart: ResultChart) {
  const horizontal = chart.orientation === 'horizontal';
  const categories = [...new Set(chart.points.map(p => String(p.x)))];
  if (chart.kind === 'line' && !chart.xUnit) categories.sort((a, b) => quarter(a)! - quarter(b)!);
  const width = horizontal ? 1100 : chart.kind === 'bar' ? Math.min(7600, Math.max(1100, categories.length * 36 + 180)) : 1100;
  const titleColumns = Math.floor((width - 64) / 16);
  const titleLines = Array.from(chart.title).join('').match(new RegExp(`.{1,${titleColumns}}`, 'gu')) ?? [''];
  const extraTitleHeight = Math.max(0, titleLines.length - 1) * 24;
  const height = (horizontal ? Math.max(640, categories.length * 42 + 300) : 780) + extraTitleHeight;
  if (width > 16000 || height > 16000) throw new Error('CHART_SIZE_LIMIT');
  const left = horizontal ? 290 : 110, right = width - 60, top = 150 + extraTitleHeight + Math.max(0, Math.ceil((chart.series?.length ?? 1) / 4) - 1) * 24, bottom = height - 220;
  const xd = axisDomain(chart, 'x'), yd = axisDomain(chart, 'y');
  const fraction = (n: number, domain: [number, number]) => (n - domain[0]) / (domain[1] - domain[0]);
  const numericX = (n: number) => left + fraction(n, xd) * (right - left);
  const numericY = (n: number) => horizontal ? left + fraction(n, yd) * (right - left) : bottom - fraction(n, yd) * (bottom - top);
  const category = (x: string | number | null) => {
    const i = categories.indexOf(String(x));
    return horizontal ? top + (i + .5) / Math.max(1, categories.length) * (bottom - top)
      : left + (i + .5) / Math.max(1, categories.length) * (right - left);
  };
  return { width, height, left, right, top, bottom, horizontal, categories, titleLines, extraTitleHeight, xd, yd, numericX, numericY, category };
}

export function renderCartesianSvg(chart: ResultChart, options?: { provenance: 'attachment' }): string {
  const g = cartesianGeometry(chart), elements: string[] = [];
  const text = (x: number, y: number, s: string, extra = '') => elements.push(`<text x="${x}" y="${y}" ${extra}>${xml(s)}</text>`);
  const series = chart.series ?? [{ key: 'value', label: chart.yLabel, points: chart.points }];
  g.titleLines.forEach((line, i) => text(32, 40 + i * 24, line, 'font-size="16" font-weight="500"'));
  text(32, 76 + g.extraTitleHeight, `${chart.xLabel} / ${chart.yLabel}（${units[chart.yUnit] ?? chart.yUnit}）；有效 ${chart.renderedCount}，未知 ${chart.unknownCount}`);
  if (chart.request.legend !== false && series.length > 1) series.forEach((s, i) => {
    const x = 32 + (i % 4) * 260, y = 108 + g.extraTitleHeight + Math.floor(i / 4) * 24;
    elements.push(`<rect x="${x}" y="${y-12}" width="12" height="12" fill="${chartColors[i % chartColors.length]}"/>`); elements.push(`<text x="${x + 20}" y="${y}">${xml(Array.from(s.label).slice(0, 16).join('') + (Array.from(s.label).length > 16 ? '…' : ''))}<title>${xml(s.label)}</title></text>`);
  });
  const ticks = axisTicks(g.yd, chart.request.yAxis?.ticks ?? 5);
  for (const tick of ticks) {
    const p = g.numericY(tick);
    elements.push(g.horizontal ? `<line x1="${p}" x2="${p}" y1="${g.top}" y2="${g.bottom}" stroke="#dbe0e6"/>`
      : `<line x1="${g.left}" x2="${g.right}" y1="${p}" y2="${p}" stroke="#dbe0e6"/>`);
    text(g.horizontal ? p : g.left - 12, g.horizontal ? g.bottom + 28 : p + 5, axisText(tick, chart.yUnit, Math.abs(g.yd[1] - g.yd[0]) / ((chart.request.yAxis?.ticks ?? 5) - 1)), `text-anchor="${g.horizontal ? 'middle' : 'end'}"`);
  }
  if (chart.kind === 'scatter' || chart.kind === 'line' && chart.xUnit) for (const tick of axisTicks(g.xd, chart.request.xAxis?.ticks ?? 5))
    text(g.numericX(tick), g.bottom + 28, axisText(tick, chart.xUnit, Math.abs(g.xd[1] - g.xd[0]) / ((chart.request.xAxis?.ticks ?? 5) - 1)), 'text-anchor="middle"');
  else {
    const every = g.horizontal ? 1 : Math.max(1, Math.ceil(g.categories.length / 12));
    g.categories.forEach((label, i) => {
      if (i % every !== 0 && i !== g.categories.length - 1) return;
      const p = g.category(label), shown = Array.from(label).slice(0, g.horizontal ? 17 : 10).join('') + (Array.from(label).length > (g.horizontal ? 17 : 10) ? '…' : '');
      elements.push(`<text x="${g.horizontal ? g.left - 16 : p}" y="${g.horizontal ? p + 5 : g.bottom + 28}" text-anchor="${g.horizontal ? 'end' : 'middle'}">${xml(shown)}<title>${xml(label)}</title></text>`);
    });
  }
  elements.push(`<path d="M${g.left} ${g.top}V${g.bottom}H${g.right}" fill="none" stroke="#667085"/>`);
  const categoryWidth = (g.horizontal ? g.bottom - g.top : g.right - g.left) / Math.max(1, g.categories.length);
  series.forEach((s, si) => {
    const color = chartColors[si % chartColors.length];
    let run: string[] = [], previous: ChartPoint | undefined;
    const flush = () => { if (run.length > 1) elements.push(`<polyline points="${run.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`); run = []; };
    s.points.forEach(p => {
      if (p.state !== 'valid' || p.y === null) { flush(); previous = undefined; return; }
      const cx = chart.xUnit && typeof p.x === 'number' ? g.numericX(p.x) : g.category(p.x), cy = g.numericY(p.y);
      const tip = `<title>${xml(s.label + ' / ' + p.label + '：' + p.xText + '，' + p.yText)}</title>`;
      if (chart.kind === 'bar') {
        const size = Math.min(28, categoryWidth * .72 / series.length), offset = (si - (series.length - 1) / 2) * size;
        const zero = g.numericY(0);
        elements.push(g.horizontal ? `<rect data-entity="${xml(p.yCell.entityId)}" data-key="${xml(p.yCell.key)}" x="${Math.min(zero, cy)}" y="${cx + offset - size / 2}" width="${Math.abs(cy-zero)}" height="${size-1}" fill="${color}">${tip}</rect>`
          : `<rect data-entity="${xml(p.yCell.entityId)}" data-key="${xml(p.yCell.key)}" x="${cx + offset - size / 2}" y="${Math.min(zero, cy)}" width="${size-1}" height="${Math.abs(cy-zero)}" fill="${color}">${tip}</rect>`);
      } else {
        if (chart.kind === 'line') {
          if (previous && !chart.xUnit && quarter(String(p.x))! - quarter(String(previous.x))! !== 1) flush();
          run.push(`${cx},${cy}`); previous = p;
        }
        elements.push(`<circle data-entity="${xml(p.yCell.entityId)}" data-key="${xml(p.yCell.key)}" cx="${cx}" cy="${cy}" r="4" fill="${color}">${tip}</circle>`);
      }
    }); flush();
  });
  text(g.left, g.height - 150, g.horizontal ? `${chart.yLabel}（${units[chart.yUnit] ?? chart.yUnit}）` : `${chart.xLabel}${chart.xUnit ? '（' + (units[chart.xUnit] ?? chart.xUnit) + '）' : ''}`);
  text(32, g.height - 108, '来源、期间、精确值、样本和计算口径见同包 manifest.json；缺失不按零绘制。');
  const period = chart.summary.find(s => /季度|期间|Q[1-4]/.test(s));
  if (period) text(32, g.height - 76, Array.from(period).slice(0, 65).join(''));
  text(32, g.height - 44, options?.provenance === 'attachment' ? '内部研究；完整来源与结果版本见本文件内来源附件。' : `结果版本 ${chart.resultId}；仅供内部分析。`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" role="img"><title>${xml(chart.title)}</title><metadata>${xml(JSON.stringify(chart))}</metadata><rect width="100%" height="100%" fill="#f9fafb"/><g font-family="Noto Sans SC, Arial, sans-serif" font-size="14" font-weight="400" fill="#172033">${elements.join('')}</g></svg>`;
}
