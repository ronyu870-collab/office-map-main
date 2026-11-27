import { reportDescriptorSchema } from './reportProtocol';
import { z } from 'zod';
import { agentExportDescriptorSchema } from './exportProtocol';
import { distributionAnalysisSchema } from './distribution';
import { quarterSchema } from './contracts';
import { metricLabels, resultMetrics, selectResultMetric } from './multiMetricView';
import { researchTaskSchema } from '../research/protocol';

const text = z.string().max(10000);
const exact = z.object({ numerator: z.string().regex(/^-?\d{1,400}$/), denominator: z.string().regex(/^[1-9]\d{0,399}$/) });
const number = z.object({ exact, numeric: z.number().finite() });
const ids = z.array(z.string()).max(200000);
export const resultCellSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: text, sourceIds: ids }),
  z.object({ kind: z.literal('number'), value: number, sourceIds: ids }),
  z.object({ kind: z.literal('unknown'), state: z.enum(['missing', 'invalid', 'conflict', 'unverified']), reason: text, sourceIds: ids }),
]);
export const sourceSchema = z.object({ id: text, table: text, recordId: text, field: text, entityId: text, recordVersion: text,
  rawValue: z.unknown(), unit: text, period: quarterSchema.nullable(), recordedAt: text.nullable(), businessAsOf: text.nullable(),
  verification: z.enum(['database_only', 'verified_original', 'unreviewed', 'historical']),
  original: z.object({ documentId: text, version: text, page: z.number().optional(), sheet: text.optional(), row: z.number().optional(), location: z.string().max(160).optional() }).nullable(),
});
export const resultViewSchema = z.object({ resultId: z.uuid(), snapshotId: z.string(), createdAt: z.iso.datetime(), dataVersion: z.string(),
  scopeFingerprint: z.string(), registryVersion: z.string(), operation: z.enum(['list', 'rank', 'aggregate', 'compare', 'trend', 'group_aggregate', 'group_trend', 'cross_aggregate', 'cross_trend', 'relationship', 'distribution']),
  parameters: z.record(z.string(), z.unknown()), analysis: z.unknown(), limitations: z.array(text), sources: z.array(sourceSchema).max(200000),
  table: z.object({ id: z.string(), columns: z.array(z.object({ key: z.string(), label: text, unit: z.string().nullable() })).max(30),
    rows: z.array(z.object({ entityId: text, cells: z.record(z.string(), resultCellSchema) })).max(100000) }),
}).superRefine((result, ctx) => {
  const sources = new Set(result.sources.map(source => source.id));
  for (const row of result.table.rows) for (const column of result.table.columns) {
    const cell = row.cells[column.key];
    if (!cell || cell.sourceIds.some(id => !sources.has(id))) ctx.addIssue({ code: 'custom', message: 'Incomplete table source binding' });
  }
});
export type QueryResultView = z.infer<typeof resultViewSchema>;
export type DisplayCell = z.infer<typeof resultCellSchema>;
export const metroSource = { table: 'map_subway_stations', path: '/data/beijing_map_data.json', locationField: 'location_lng / location_lat' } as const;
export const units: Record<string, string> = { m: '米', floor: '层', space: '个', m2: '㎡', coordinate: '定位坐标', 'CNY/m2/month': '元/㎡/月', ratio: '%', percent: '%', percentage_point: '百分点', building_count: '栋', transaction_count: '笔', month: '月', lease_rent_raw: '原始单位待核验', lease_fee_raw: '原始单位待核验' };
export const unknownLabels = { missing: '未知：缺少数据', invalid: '未知：数据无效', conflict: '未知：来源冲突', unverified: '未知：尚未核验' } as const;

/** Display rounding only; never calculates using the approximate chart projection. */
export function formatExact(value: z.infer<typeof number>, unit: string | null): string {
  const numerator = BigInt(value.exact.numerator) * BigInt(unit === 'ratio' ? 100 : 1);
  const denominator = BigInt(value.exact.denominator);
  const negative = numerator < BigInt(0), absolute = negative ? -numerator : numerator;
  const rounded = (absolute * BigInt(100) * BigInt(2) + denominator) / (denominator * BigInt(2));
  const whole = rounded / BigInt(100), fraction = (rounded % BigInt(100)).toString().padStart(2, '0').replace(/0+$/, '');
  return `${negative && rounded !== BigInt(0) ? '-' : ''}${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? '.' + fraction : ''}`;
}
export function cellText(cell: DisplayCell, unit: string | null): string {
  if (cell.kind === 'unknown' && cell.reason === 'disclosure_threshold') return '受控：未达到聚合披露样本数';
  if (cell.kind === 'unknown' && cell.reason === 'no_valid_sample') return '未知：无有效样本';
  if (cell.kind === 'unknown' && cell.reason === 'no_common_valid_sample') return '未知：无共同有效样本';
  return cell.kind === 'text' ? cell.value : cell.kind === 'unknown' ? unknownLabels[cell.state] : formatExact(cell.value, unit);
}
const coverageSchema = z.object({ total: z.number().int().nonnegative(), valid: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(), invalid: z.number().int().nonnegative(), conflict: z.number().int().nonnegative(), unverified: z.number().int().nonnegative() });
function coverageText(input: unknown): string | null {
  const parsed = coverageSchema.safeParse(input);
  if (!parsed.success) return null;
  const c = parsed.data;
  return `获权样本 ${c.total} 栋，有效 ${c.valid} 栋；缺失 ${c.missing}、无效 ${c.invalid}、冲突 ${c.conflict}、未核验 ${c.unverified}。`;
}
export function resultSummary(result: QueryResultView): string[] {
  if (result.parameters.dataDomain === 'deep-research/1') {
    const task = researchTaskSchema.parse(result.parameters.researchTask);
    const data = task.steps.filter(s => s.id !== 'review');
    return [`研究工作集已完成 ${data.filter(s => s.state === 'complete').length}/${data.length} 个数据步骤；${task.state === 'reviewed' ? '已执行成果审查。' : '尚未完成研究，可继续当前任务。'}`];
  }
  const report = reportDescriptorSchema.safeParse(result.parameters.agentReport).data;
  if (report) return [`本次内部 ${report.format.toUpperCase()} 包含 ${report.sectionCount} 个研究部分，保留 ${report.rowCount} 条原表记录；各部分独立统计，记录数不等于楼宇总数。`];
  const exported = agentExportDescriptorSchema.safeParse(result.parameters.agentExport).data;
  if (exported) return [result.operation === 'list' ? `已找到 ${result.table.rows.length} 栋楼宇。` : `本次结果共 ${result.table.rows.length} 条记录。`];
  if (result.parameters.dataDomain === 'lease-research/1') return [`获权成交研究结果共 ${result.table.rows.length} 行；成交记录数按有效身份关联去重，未经核验的跨表重叠仍可能存在。`, '成交面积与有效面积样本数分别列示，不代表净吸纳量或市场全集。'];
  if(result.parameters.dataDomain==='business-research/1')return [`本次获权业务资料共 ${result.table.rows.length} 条记录。`,...result.limitations.slice(0,2)];
  const metrics = resultMetrics(result);
  if (metrics.length > 1) return [
    `本次同时分析${metrics.map(metric => metricLabels[metric]).join('、')}；每项分别核算有效样本和分母。`,
    ...metrics.flatMap(metric => resultSummary(selectResultMetric(result, metric)).map(line => `${metricLabels[metric]}：${line}`)),
    '各指标来自同一次获权快照；有效样本可以不同，不把各项数值解释为跨指标共同样本结论。',
  ];
  const analysis = z.record(z.string(), z.unknown()).safeParse(result.analysis);
  const a = analysis.success ? analysis.data : {};
  const coverage = coverageText(a.coverage), rows = result.table.rows;
  if (result.operation === 'list') return [`当前获权目录中符合条件的楼宇共 ${rows.length} 栋。`];
  if (result.operation === 'rank') return [rows.length
    ? result.parameters.field === 'height' && result.parameters.limit === 1 && result.parameters.direction === 'desc'
      ? `已知有效高度记录中最高的是${rows.slice(0, 3).map(row => cellText(row.cells.name, null)).join('、')}${rows.length > 3 ? '等（完整并列名单见表）' : ''}${rows.length > 1 ? '，并列第一' : ''}。不能确认整个现实市场中最高的楼。`
      : `以下为已知有效记录中的排名，包含末位并列。不能据此确认整个现实市场的排名。`
    : '不知道：当前获权候选中没有可用于排名的有效记录。', ...(coverage ? [coverage] : [])];
  if (result.operation === 'aggregate') {
    const column = result.table.columns[0], cell = rows[0]?.cells[column?.key];
    const value = cell && cell.kind === 'number' ? `${column.label}为 ${cellText(cell, column.unit)} ${units[column.unit ?? ''] ?? column.unit ?? ''}。`
      : '不知道：当前范围和季度没有足够的有效数据，不能给出这个指标。';
    const denominator = number.safeParse(a.denominator);
    const method = result.parameters.metric === 'rent' ? '按有效总面积加权计算净有效租金。' : result.parameters.metric === 'vacancy' ? '空置面积合计除以相同有效记录的总面积合计。' : '累加有效季度总面积。';
    return [value, ...(coverage ? [coverage] : []), method + (denominator.success && a.denominatorUnit === 'm2' ? `有效面积分母 ${formatExact(denominator.data, 'm2')} ㎡。` : '')];
  }
  if(result.operation==='trend')return [
    result.parameters.mode==='paired'?'按全期间共同有效样本查看趋势，各季度使用相同楼宇集合。':'按各期有效样本查看趋势，各季度参与楼宇可能不同。',
    result.parameters.metric==='rent'?'净有效租金按各期有效总面积加权；分母、参与数量和缺失情况见表。':result.parameters.metric==='vacancy'?'空置率按同一有效样本的空置面积合计除以总面积合计；缺期保留未知。':'累加各期有效季度总面积；没有有效样本时显示未知，不记零。',
    ...(rows.every(r=>r.cells.value?.kind!=='number')?['不知道：当前范围没有可用的趋势数值；不会用其他季度或模型知识补齐。']:[])];
  if (result.operation === 'distribution') {
    const d=distributionAnalysisSchema.parse(result.analysis),s=d.stats,unit=units[d.unit]??d.unit;
    return [...(coverage?[coverage]:[]),s?`中位数 ${formatExact(s.median,d.unit)} ${unit}；P25 ${formatExact(s.q1,d.unit)}、P75 ${formatExact(s.q3,d.unit)}；最小 ${formatExact(s.min,d.unit)}、最大 ${formatExact(s.max,d.unit)}。`:'不知道：没有有效记录，不能计算分位数或分布。',
      '逐楼等权，Type 7线性插值；区间按未舍入值判断，异常值保留。',d.outlierAssessment==='insufficient_sample'?'有效样本不足4栋，不判定离群。':`1.5×IQR围栏外 ${d.observations.filter(o=>o.outlier===true).length} 栋；只作标记，不代表数据错误。`];
  }
  if (result.operation === 'relationship') {
    const a = z.object({ coverage: z.object({ candidates: z.number().int().nonnegative(), rentValid: z.number().int().nonnegative(), vacancyValid: z.number().int().nonnegative(), jointValid: z.number().int().nonnegative(), excluded: z.number().int().nonnegative() }),
      correlation: z.object({ value: z.number().min(-1).max(1).nullable(), unavailableReason: z.enum(['fewer_than_three_joint_samples', 'constant_variable']).nullable() }) }).parse(result.analysis);
    return [`候选 ${a.coverage.candidates} 栋；租金有效 ${a.coverage.rentValid} 栋，空置率有效 ${a.coverage.vacancyValid} 栋，联合有效 ${a.coverage.jointValid} 栋；排除 ${a.coverage.excluded} 栋。`,
      a.correlation.value === null ? `不知道：${a.correlation.unavailableReason === 'constant_variable' ? '联合样本中至少一个变量恒定，相关系数无定义。' : '联合有效样本不足3栋，不报告相关系数。'}` : `联合样本 Pearson 线性相关系数约为 ${a.correlation.value.toFixed(6)}；每栋等权，不按面积加权。`,
      '只描述同栋同季度联合有效记录；未作显著性检验，不据此推断因果、预测或整个市场规律。'];
  }
  if (result.operation === 'cross_aggregate') return [
    '按当前目录子市场 × 等级交叉统计，未填写分类单列未知。',
    '每格使用独立有效样本与分母，空组合保持未知；单楼小样本不能代表整个类别。',
    result.parameters.metric === 'rent' ? '净有效租金按有效总面积加权；不能对格均值再求简单平均。' : result.parameters.metric === 'vacancy' ? '空置面积合计除同一有效记录的总面积合计；各格百分比不能相加。' : '累加各格有效季度总面积，未填或无效值不按零处理。',
    ...(rows.length === 0 || rows.every(row => row.cells.value?.kind !== 'number') ? ['不知道：当前获权范围没有可用的交叉指标值。'] : []),
  ];
  if (result.operation === 'cross_trend') return [
    '按当前目录子市场 × 等级分别查看季度趋势，未填写分类单列未知；不代表历史季度的市场分类。',
    result.parameters.mode === 'paired' ? '每格各自使用全期间共同有效楼宇；不同格和不同指标不共用同一批样本。' : '每格各期使用独立有效样本；样本结构变化可能影响趋势。',
    result.parameters.metric === 'rent' ? '净有效租金按各期有效总面积加权；不能对格均值再求简单平均。' : result.parameters.metric === 'vacancy' ? '空置面积合计除以同格同季有效样本的总面积合计；各格空置率不能相加，变化使用百分点。' : '累加各格各期有效季度总面积；没有有效样本时保持未知。',
    '实际参与、当期有效样本、分母与缺失情况分别保留；空组合和缺期不补零，不推断市场原因。',
    ...(rows.length === 0 || rows.every(row => row.cells.value?.kind !== 'number') ? ['不知道：当前获权范围没有可用的双维趋势数值。'] : []),
  ];
  if (result.operation === 'group_aggregate' || result.operation === 'group_trend') return [
    `按当前目录${result.parameters.groupBy === 'grade' ? '等级' : '子市场'}分别计算，未填写分类单列未知。`,
    result.operation === 'group_trend' && result.parameters.mode === 'paired' ? '每组各自使用全期间共同有效楼宇；不同组不是同一楼宇样本。' : '每组使用当期有效楼宇；参与数量、分母和缺失情况见表。',
    result.parameters.metric === 'rent' ? '净有效租金按有效总面积加权，不能把各组租金简单平均成整体租金。' : result.parameters.metric === 'vacancy' ? '空置率用每组同一有效样本的空置面积合计除总面积合计，不能把各组百分比直接相加。' : '各组累加有效季度总面积；没有有效样本时保持未知。',
    ...(rows.length === 0 || rows.every(row => row.cells.value?.kind !== 'number') ? ['不知道：当前获权范围没有可用的分组指标值。'] : []),
  ];
  return [result.parameters.mode === 'paired' ? '按两期均有有效指标的配对楼宇比较。' : '按各期各自的有效样本比较，样本可能不同。', ...(['base', 'current'] as const).flatMap(key => {
    const period = z.object({ availableCoverage: coverageSchema, usedEntityIds: ids, denominator: number }).safeParse(a[key]);
    return period.success ? [`${key === 'base' ? '基期' : '比较期'}：${coverageText(period.data.availableCoverage)}实际参与 ${period.data.usedEntityIds.length} 栋；${result.parameters.metric === 'totalArea' ? '样本分母' : '有效面积分母'} ${formatExact(period.data.denominator, null)} ${result.parameters.metric === 'totalArea' ? '栋' : '㎡'}。`] : [];
  })];
}
export function resultScopeText(result: QueryResultView): string {
  if (result.parameters.dataDomain === 'deep-research/1') return '多个获权正式结果组成的内部研究；各部分保留独立期间、有效样本及来源，不将成交面积解释为净吸纳量。';
  if(result.parameters.dataDomain==='business-research/1')return '获权业务资料；目录、楼书、静态简介、供应提交及单元来源口径分别标注。';
  if (result.parameters.dataDomain === 'lease-research/1') return '获权成交记录研究；来源、日期精度、身份匹配和去重覆盖见口径及限制。';
  if (reportDescriptorSchema.safeParse(result.parameters.agentReport).success)
    return '由获权正式快照组合；各部分的范围、期间、来源和统计口径见报告及研究索引，不重算跨结果指标。';
  const exported = agentExportDescriptorSchema.safeParse(result.parameters.agentExport).data;
  if (exported && Array.isArray(result.parameters.exportPlans) && result.parameters.exportPlans.length > 1)
    return '合并多个获权正式结果；各项期间、范围及原始统计口径见文件来源与快照，不重新计算跨结果均值。';
  const scope = z.object({ inventory: z.string().optional(), submarkets: z.array(z.string()).optional() }).safeParse(result.parameters.scope);
  const s = scope.success ? scope.data : {};
  const period = quarterSchema.safeParse(result.parameters.period);
  const start=quarterSchema.safeParse(result.parameters.start),end=quarterSchema.safeParse(result.parameters.end);
  const isTrend = result.operation === 'trend' || result.operation === 'group_trend' || result.operation === 'cross_trend';
  const range=isTrend&&start.success&&end.success?`，${start.data.year}Q${start.data.quarter} 至 ${end.data.year}Q${end.data.quarter}`:'';
  return `数据范围：${s.submarkets?.join('、') || '当前获权范围'}${range}${period.success && !isTrend ? `，${period.data.year} Q${period.data.quarter}` : ''} · ${s.inventory === 'tracked' ? '当前跟踪楼宇样本' : '当前楼宇目录'}。`;
}
