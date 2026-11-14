import { z } from 'zod';
import { distributionAnalysisSchema, distributionLabel, type DistributionAnalysis } from './distribution';
import { quarterRange } from './plan';
import { quarterSchema, quarterKey } from './contracts';
import { cellText, resultScopeText, resultSummary, units, type DisplayCell, type QueryResultView } from './presentation';

/** The caller chooses bindings, never numbers, labels, units or source records. */
export const chartRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bar'), field: z.string().min(1).max(80) }),
  z.strictObject({ kind: z.literal('scatter'), x: z.string().min(1).max(80), y: z.string().min(1).max(80) }),
  z.strictObject({ kind: z.literal('period_comparison') }),
  z.strictObject({ kind: z.literal('time_series') }),
  z.strictObject({ kind: z.literal('grouped_time_series') }),
  z.strictObject({ kind: z.literal('heatmap') }),
  z.strictObject({ kind: z.literal('histogram') }),
  z.strictObject({ kind: z.literal('box_plot') }),
]);
export type ChartRequest = z.infer<typeof chartRequestSchema>;
type CellBinding = { entityId: string; key: string; sourceIds: readonly string[]; analysisPath?: readonly (string|number)[] };
export type ChartPoint = { label: string; x: number | string | null; y: number | null; xText: string; yText: string;
  xCell: CellBinding | null; yCell: CellBinding; state: 'valid' | 'unknown'; sampleCount?: number; outlier?: boolean | null };
export type ResultChart = { version: 'result-chart/1'; resultId: string; tableId: string; request: ChartRequest;
  kind: 'bar' | 'scatter' | 'line' | 'faceted_line' | 'heatmap' | 'histogram' | 'box_plot'; title: string; xLabel: string; yLabel: string; xUnit: string | null; yUnit: string;
  points: ChartPoint[]; summary: string[]; limitations: string[]; renderedCount: number; unknownCount: number;
  facets?: { key: string; label: string; points: ChartPoint[] }[];
  distribution?: { stats: DistributionAnalysis['stats']; unit:string; label:string; validCount:number; excludedCount:number; outlierCount:number; assessment:DistributionAnalysis['outlierAssessment']; sourceIds:readonly string[] };
  grid?: { rows: { key: string; label: string }[]; columns: { key: string; label: string }[] };
  connectNulls: false; zeroBaseline: true };

const projected = (cell: DisplayCell, unit: string | null) => {
  if (cell.kind !== 'number') return null;
  const n = cell.value.numeric * (unit === 'ratio' ? 100 : 1);
  if (!Number.isFinite(n)) throw new Error('CHART_RANGE_UNSUPPORTED');
  return n;
};

export function buildResultChart(result: QueryResultView, request: ChartRequest): ResultChart {
  request = chartRequestSchema.parse(request);
  if (request.kind === 'histogram' || request.kind === 'box_plot') return buildDistributionChart(result, request);
  const column = (key: string) => {
    const found = result.table.columns.find(c => c.key === key);
    if (!found || !found.unit || result.table.rows.some(row => row.cells[key]?.kind === 'text')) throw new Error('CHART_NUMERIC_COLUMN_REQUIRED');
    return found;
  };
  const binding = (entityId: string, key: string, cell: DisplayCell): CellBinding => ({ entityId, key, sourceIds: [...cell.sourceIds] });
  let xLabel = result.operation==='submission_progress'?(result.parameters.view==='summary'?'楼宇状态':['people','missing_people'].includes(String(result.parameters.view))?'负责人':'楼宇'):result.operation==='trend'?'季度':result.operation.startsWith('group_')?(result.parameters.groupBy==='grade'?'等级':'子市场'):'楼宇', xUnit: string | null = null;
  if(result.operation==='future_observation')xLabel=result.parameters.view==='area_summary'?'预计区间与核验分类':result.parameters.view==='launch_summary'?'预计入市时间精度':result.parameters.view==='summary'?'季度任务状态':['people','missing_people'].includes(String(result.parameters.view))?'负责人':'未来供应记录';
  let yColumn: { key: string; label: string; unit: string | null };
  let points: ChartPoint[];
  let facets: ResultChart['facets'];
  let grid: ResultChart['grid'];
  if (request.kind === 'heatmap') {
    if (result.operation !== 'cross_aggregate' || result.parameters.tableVersion !== 'cross-quarter/1') throw new Error('CHART_CROSS_TAB_REQUIRED');
    const axis = z.array(z.object({ key: z.string().min(1), label: z.string() })).max(50);
    grid = { rows: axis.parse(result.parameters.rowGroups), columns: axis.parse(result.parameters.columnGroups) };
    if (grid.rows.length * grid.columns.length > 400 || result.table.rows.length !== grid.rows.length * grid.columns.length
      || new Set(grid.rows.map(r => r.key)).size !== grid.rows.length || new Set(grid.columns.map(c => c.key)).size !== grid.columns.length) throw new Error('CHART_CROSS_AXIS_MISMATCH');
    yColumn = column('value'); xLabel = '等级';
    points = grid.rows.flatMap((region, i) => grid!.columns.map((grade, j) => {
      const row = result.table.rows[i * grid!.columns.length + j], cell = row.cells.value;
      if (row.entityId !== `${region.key}/${grade.key}` || row.cells.name?.kind !== 'text' || row.cells.name.value !== region.label
        || row.cells.grade?.kind !== 'text' || row.cells.grade.value !== grade.label || row.cells.usedCount?.kind !== 'number'
        || !Number.isSafeInteger(row.cells.usedCount.value.numeric) || row.cells.usedCount.value.numeric < 0) throw new Error('CHART_CROSS_AXIS_MISMATCH');
      return { label: `${region.label} / ${grade.label}`, x: grade.label, y: projected(cell, yColumn.unit), xText: grade.label, yText: cellText(cell, yColumn.unit),
        xCell: binding(row.entityId, 'grade', row.cells.grade), yCell: binding(row.entityId, 'value', cell), sampleCount: row.cells.usedCount.value.numeric,
        state: cell.kind === 'number' ? 'valid' as const : 'unknown' as const };
    }));
  } else if (request.kind === 'grouped_time_series') {
    if (result.operation !== 'group_trend') throw new Error('CHART_GROUPED_TREND_REQUIRED');
    const periods = quarterRange(quarterSchema.parse(result.parameters.start), quarterSchema.parse(result.parameters.end));
    const groups = z.array(z.object({ key: z.string().min(1), label: z.string(), value: z.string().nullable() })).max(50).parse(result.parameters.groups);
    if (new Set(groups.map(g => g.key)).size !== groups.length || result.table.rows.length !== groups.length * periods.length) throw new Error('CHART_GROUP_AXIS_MISMATCH');
    yColumn = column('value'); xLabel = '季度';
    facets = groups.map((group, index) => ({ key: group.key, label: group.label, points: periods.map((period, i) => {
      const row = result.table.rows[index * periods.length + i], label = quarterKey(period), cell = row.cells.value;
      if (row.entityId !== `${group.key}/${label}` || row.cells.period?.kind !== 'text' || row.cells.period.value !== label
        || row.cells.name?.kind !== 'text' || row.cells.name.value !== group.label) throw new Error('CHART_GROUP_AXIS_MISMATCH');
      return { label, x: label, y: projected(cell, yColumn.unit), xText: label, yText: cellText(cell, yColumn.unit), xCell: null,
        yCell: binding(row.entityId, 'value', cell), state: cell.kind === 'number' ? 'valid' as const : 'unknown' as const };
    }) }));
    points = facets.flatMap(facet => facet.points);
  } else if(request.kind==='time_series'){
    if(result.operation!=='trend')throw new Error('CHART_TREND_REQUIRED');
    const periods=quarterRange(quarterSchema.parse(result.parameters.start),quarterSchema.parse(result.parameters.end));
    if(result.table.rows.length!==periods.length || result.table.rows.some((r,i)=>r.entityId!==quarterKey(periods[i]) || r.cells.period?.kind!=='text' || r.cells.period.value!==quarterKey(periods[i])))throw new Error('CHART_TIME_AXIS_MISMATCH');
    yColumn=column('value');xLabel='季度';
    points=result.table.rows.map(row=>{const cell=row.cells.value,label=row.entityId;return {label,x:label,y:projected(cell,yColumn.unit),xText:label,yText:cellText(cell,yColumn.unit),xCell:null,yCell:binding(row.entityId,'value',cell),state:cell.kind==='number'?'valid':'unknown'};});
  } else if (request.kind === 'period_comparison') {
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
      if (!['list', 'relationship'].includes(result.operation) || request.x === request.y) throw new Error('CHART_JOINT_SAMPLE_REQUIRED');
      xLabel = xColumn!.label; xUnit = xColumn!.unit;
    }
    points = result.table.rows.map(row => {
      const y = row.cells[yColumn.key], x = xColumn ? row.cells[xColumn.key] : null;
      const label = row.cells.name?.kind === 'text' ? row.cells.name.value + (result.operation === 'cross_aggregate' && row.cells.grade?.kind === 'text' ? ` / ${row.cells.grade.value}` : '') + (result.operation === 'group_trend' && row.cells.period?.kind === 'text' ? ` ${row.cells.period.value}` : '') : row.cells.period?.kind==='text'?row.cells.period.value:yColumn.label;
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
    kind: request.kind === 'heatmap' ? 'heatmap' : request.kind === 'grouped_time_series' ? 'faceted_line' : request.kind === 'time_series'?'line':request.kind === 'scatter' ? 'scatter' : 'bar', title: resultScopeText(result), xLabel,
    yLabel: request.kind === 'period_comparison' ? ({ rent: '面积加权净有效租金', vacancy: '空置率', totalArea: '总面积' }[result.parameters.metric as 'rent' | 'vacancy' | 'totalArea'] ?? '指标') : yColumn.label,
    xUnit, yUnit: yColumn.unit!, points, ...(facets ? { facets } : {}), ...(grid ? { grid } : {}), renderedCount, unknownCount: points.length - renderedCount, connectNulls: false, zeroBaseline: true,
    summary: resultSummary(result), limitations: [...result.limitations,
      ...(request.kind==='time_series'?['按连续季度等间距排列；未知季度断开折线，单个有效季度只显示点。']:[]),
      ...(request.kind==='grouped_time_series'?['每组单独一行折线，共用相同季度和纵轴范围；未知季度断线，不连接不同组。']:[]),
      ...(request.kind === 'scatter' ? ['散点仅绘制两个字段都有有效数值的联合样本；不据此推断因果关系。'] : []),
      '图形位置使用数值近似值，标签保留原结果的精确值舍入；未知不按零绘制。',
      ...(result.operation === 'rank' ? ['图示范围沿用本次排名及末位并列，不重新截取前 N。'] : []),
    ] };
}

/** Ratio levels use the full 0–100% domain, not the current largest value. */
function buildDistributionChart(result: QueryResultView, request: Extract<ChartRequest,{kind:'histogram'|'box_plot'}>): ResultChart {
  if(result.operation!=='distribution')throw new Error('CHART_DISTRIBUTION_REQUIRED');
  const d=distributionAnalysisSchema.parse(result.analysis);
  if(d.observations.length!==result.table.rows.length||d.coverage.total!==d.observations.length)throw new Error('CHART_DISTRIBUTION_MISMATCH');
  d.observations.forEach((o,i)=>{const row=result.table.rows[i],cell=row.cells.value;
    if(row.entityId!==o.entityId||row.cells.name?.kind!=='text'||row.cells.name.value!==o.name||JSON.stringify(cell.sourceIds)!==JSON.stringify(o.sourceIds)
      ||(o.value?cell.kind!=='number'||JSON.stringify(cell.value)!==JSON.stringify(o.value):cell.kind!=='unknown'||cell.state!==o.state))throw new Error('CHART_DISTRIBUTION_MISMATCH');
  });
  if(d.bins.reduce((n,b)=>n+b.count,0)!==d.coverage.valid||d.observations.filter(o=>o.value!==null).length!==d.coverage.valid)throw new Error('CHART_DISTRIBUTION_MISMATCH');
  d.bins.forEach((b,i)=>{const members=d.observations.filter(o=>o.bin===i);if(b.count!==members.length||JSON.stringify([...b.entityIds].sort())!==JSON.stringify(members.map(o=>o.entityId).sort()))throw new Error('CHART_DISTRIBUTION_MISMATCH');});
  const points:ChartPoint[]=request.kind==='histogram'?d.bins.map((b,i)=>({label:`区间 ${i+1}：[${cellText({kind:'number',value:b.lower,sourceIds:[]},d.unit)}, ${cellText({kind:'number',value:b.upper,sourceIds:[]},d.unit)}${b.upperInclusive?']':')'}`,
    x:i,y:b.count,xText:`区间 ${i+1}`,yText:String(b.count),xCell:null,yCell:{entityId:b.id,key:'count',sourceIds:b.sourceIds,analysisPath:['bins',i,'count']},state:'valid',sampleCount:b.count
  })):d.observations.map((o,i)=>({label:o.name,x:o.name,y:o.value?o.value.numeric*(d.unit==='ratio'?100:1):null,xText:o.name,yText:cellText(result.table.rows[i].cells.value,d.unit),
    xCell:null,yCell:{entityId:o.entityId,key:'value',sourceIds:o.sourceIds},outlier:o.outlier,state:o.value?'valid':'unknown'}));
  const label=distributionLabel(d.measure);
  return {version:'result-chart/1',resultId:result.resultId,tableId:result.table.id,request,kind:request.kind,title:resultScopeText(result),xLabel:label,yLabel:request.kind==='histogram'?'楼宇数量':label,xUnit:d.unit,yUnit:request.kind==='histogram'?'building_count':d.unit,
    points,summary:resultSummary(result),limitations:[...result.limitations,'分箱标签只作显示舍入，精确边界与完整分位数见结果文件；同色图示不表示推荐。'],renderedCount:points.filter(p=>p.state==='valid').length,unknownCount:points.filter(p=>p.state==='unknown').length,connectNulls:false,zeroBaseline:true,
    distribution:{stats:d.stats,unit:d.unit,label,validCount:d.coverage.valid,excludedCount:d.coverage.total-d.coverage.valid,outlierCount:d.observations.filter(o=>o.outlier===true).length,assessment:d.outlierAssessment,sourceIds:[...new Set(d.observations.flatMap(o=>o.sourceIds))]}};
}

/** Geometry only: statistical values already belong to the immutable result. */
export function distributionGeometry(chart: ResultChart) {
  const d=chart.distribution;if(!d)throw new Error('CHART_DISTRIBUTION_REQUIRED');
  const stat=(key:keyof NonNullable<typeof d.stats>)=>d.stats?d.stats[key].numeric*(d.unit==='ratio'?100:1):0;
  const min=d.unit==='ratio'?0:Math.min(0,stat('min')),max=d.unit==='ratio'?100:stat('max');
  const scale=(n:number)=>70+(n-min)/(max-min||1)*530;
  return {min,max,scale,stat,empty:d.stats===null};
}

export function chartBounds(chart: ResultChart, axis: 'x' | 'y'): [number, number] {
  if ((axis === 'x' ? chart.xUnit : chart.yUnit) === 'ratio') return [0, 100];
  return chart.points.reduce<[number, number]>(([min, max], point) => typeof point[axis] === 'number'
    ? [Math.min(min, point[axis]), Math.max(max, point[axis])] : [min, max], [0, 0]);
}

/** Shared chronological layout. Never join points across a null quarter. */
export function lineGeometry(chart: ResultChart, width=Math.max(640,chart.points.length*76+110), height=380, sharedBounds?: [number, number]) {
  if(chart.kind!=='line' || chart.points.length<2 || chart.points.length>40)throw new Error('CHART_TREND_REQUIRED');
  const [min,max]=sharedBounds??chartBounds(chart,'y'),top=30,bottom=height-70,left=70,right=width-30;
  const points=chart.points.map((p,i)=>({point:p,x:left+i/(chart.points.length-1)*(right-left),y:p.y===null?null:bottom-(p.y-min)/(max-min||1)*(bottom-top)}));
  const segments:string[]=[];let run:string[]=[];
  const flush=()=>{if(run.length>1)segments.push(run.join(' '));run=[];};
  for(const p of points){if(p.y===null)flush();else run.push(`${p.x},${p.y}`);}flush();
  return {width,height,top,bottom,left,right,min,max,points,segments};
}

export function chartFacets(chart: ResultChart): ResultChart[] {
  if (chart.kind !== 'faceted_line' || !chart.facets) throw new Error('CHART_GROUPED_TREND_REQUIRED');
  return chart.facets.map(facet => ({ ...chart, kind: 'line', title: facet.label, facets: undefined, points: facet.points,
    renderedCount: facet.points.filter(p => p.state === 'valid').length, unknownCount: facet.points.filter(p => p.state === 'unknown').length }));
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
  const width = chart.kind === 'heatmap' ? Math.max(960, 260 + (chart.grid?.columns.length ?? 0) * 160) : 960, left = 300, right = 780, top = 36;
  const elements: string[] = [];
  const text = (x: number, y: number, value: string, extra = '') => elements.push(`<text x="${x}" y="${y}" ${extra}>${xml(value)}</text>`);
  const paragraph = (content: string, y: number, size = 64) => { const lines = wrap(content, size); lines.forEach((line, i) => text(24, y + i * 22, line)); return y + lines.length * 22 + 8; };
  let y = paragraph(chart.title, top);
  for (const line of chart.summary) y = paragraph(line, y);
  y = paragraph(`${chart.yLabel}（${units[chart.yUnit] ?? chart.yUnit}）；有效图示 ${chart.renderedCount} 项，未知 ${chart.unknownCount} 项。`, y);
  if (chart.kind === 'histogram') {
    const max=Math.max(1,...chart.points.map(p=>p.y??0)),barWidth=660/Math.max(1,chart.points.length),bottom=y+260;
    for(let i=0;i<chart.points.length;i++){const p=chart.points[i],h=(p.y??0)/max*210,x=120+i*barWidth;elements.push(`<rect x="${x}" y="${bottom-h}" width="${Math.max(1,barWidth-2)}" height="${h}" fill="#bacfe5"><title>${xml(p.label+'：'+p.yText+'栋')}</title></rect>`);text(x+barWidth/2,bottom+24,String(i+1),'text-anchor="middle"');text(x+barWidth/2,bottom-h-8,p.yText,'text-anchor="middle"');}
    y=bottom+52;for(const p of chart.points)y=paragraph(`${p.label}：${p.yText} 栋`,y);
  } else if (chart.kind === 'box_plot') {
    const g=distributionGeometry(chart);const offset=y+100;
    if(!g.empty){const x=(key:keyof NonNullable<NonNullable<ResultChart['distribution']>['stats']>)=>g.scale(g.stat(key));elements.push(`<line x1="${x('lowerWhisker')}" x2="${x('upperWhisker')}" y1="${offset}" y2="${offset}" stroke="#667085"/><rect x="${x('q1')}" y="${offset-25}" width="${x('q3')-x('q1')}" height="50" fill="#bacfe5" stroke="#667085"/>`);for(const key of ['lowerWhisker','median','upperWhisker'] as const)elements.push(`<line x1="${x(key)}" x2="${x(key)}" y1="${offset-25}" y2="${offset+25}" stroke="#003e7e"/>`);for(const p of chart.points)if(p.y!==null&&p.outlier===true)elements.push(`<circle cx="${g.scale(p.y)}" cy="${offset}" r="4" fill="#003e7e"><title>${xml(p.label+'：'+p.yText)}</title></circle>`);text(70,offset+60,String(g.min));text(600,offset+60,String(g.max),'text-anchor="end"');}
    y=offset+100;
  } else if (chart.kind === 'heatmap') {
    if (!chart.grid) throw new Error('CHART_CROSS_TAB_REQUIRED');
    const { rows, columns } = chart.grid, cellWidth = 160, labelWidth = 240;
    y = paragraph(heatmapLegend(chart), y);
    const headerHeight = Math.max(44, ...columns.map(c => wrap(c.label, 9).length * 22 + 16));
    text(24, y + 24, '子市场 / 等级');
    columns.forEach((c, j) => wrap(c.label, 9).forEach((line, n) => text(labelWidth + j * cellWidth + 12, y + 24 + n * 22, line)));
    y += headerHeight;
    rows.forEach((r, i) => {
      const height = Math.max(74, wrap(r.label, 14).length * 22 + 16, ...columns.map((_, j) => wrap(chart.points[i * columns.length + j].yText, 10).length * 22 + 44));
      wrap(r.label, 14).forEach((line, n) => text(24, y + 24 + n * 22, line));
      columns.forEach((c, j) => {
        const point = chart.points[i * columns.length + j], x = labelWidth + j * cellWidth;
        elements.push(`<rect x="${x}" y="${y}" width="${cellWidth}" height="${height}" fill="${heatmapFill(point.y, chartBounds(chart, 'y'))}" stroke="#cbd5e1"/>`);
        const valueLines = wrap(point.y === null ? '未知' : point.yText, 10);
        valueLines.forEach((line, n) => text(x + 12, y + 28 + n * 22, line));
        text(x + 12, y + 32 + valueLines.length * 22, `有效 ${point.sampleCount} 栋`);
      });
      y += height;
    });
  } else if (chart.kind === 'bar') {
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
  } else if(chart.kind==='line' || chart.kind==='faceted_line') {
    const parts = chart.kind === 'faceted_line' ? chartFacets(chart) : [chart];
    for (const part of parts) {
    if (chart.kind === 'faceted_line') y = paragraph(part.title, y + 12);
    const plot=lineGeometry(part,width,chart.kind==='faceted_line'?250:380,chartBounds(chart,'y'));const offset=y+8;
    elements.push(`<g transform="translate(0 ${offset})"><path d="M${plot.left} ${plot.top} V${plot.bottom} H${plot.right}" fill="none" stroke="#667085"/>`);
    for(const segment of plot.segments)elements.push(`<polyline points="${segment}" fill="none" stroke="#003e7e" stroke-width="2"/>`);
    for(const p of plot.points)if(p.y!==null)elements.push(`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#003e7e"><title>${xml(p.point.label+'：'+p.point.yText)}</title></circle>`);
    elements.push('</g>');text(plot.left-10,offset+plot.top+5,String(plot.max),'text-anchor="end"');text(plot.left-10,offset+plot.bottom,String(plot.min),'text-anchor="end"');
    const every=Math.ceil(plot.points.length/8);
    plot.points.forEach((p,i)=>{if(i%every===0 || i===plot.points.length-1)text(p.x,offset+plot.bottom+26,p.point.label,'text-anchor="middle"');});
    y=offset+plot.height;
    }
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

/** A restrained single-hue scale; text and sample counts carry the facts. */
export function heatmapFill(value: number | null, bounds: [number, number]): string {
  if (value === null) return '#f3f4f6';
  const t = Math.max(0, Math.min(1, (value - bounds[0]) / (bounds[1] - bounds[0] || 1)));
  return `rgb(${[242, 246, 250].map((base, i) => Math.round(base + ([186, 209, 232][i] - base) * t)).join(',')})`;
}
export function heatmapLegend(chart: ResultChart): string {
  const [min, max] = chartBounds(chart, 'y');
  return `统一色阶 ${min}–${max} ${units[chart.yUnit] ?? chart.yUnit}，颜色越深数值越大；灰色“未知”不按零着色。有效样本见各格，分母与排除情况见原表。`;
}
