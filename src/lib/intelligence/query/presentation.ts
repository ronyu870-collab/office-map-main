import {supplyOverviewSchema} from './future/supply';
import {formatExact} from './format';
export {formatExact} from './format';
import {futureAnswerSchema} from './future/answer';
import { futureAnalysisSchema } from './future/view';
import { submissionAnalysisSchema } from './submissions/view';
import { z } from 'zod';
import { distributionAnalysisSchema } from './distribution';
import { quarterSchema } from './contracts';

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
  original: z.object({ documentId: text, version: text, page: z.number().optional(), sheet: text.optional(), row: z.number().optional() }).nullable(),
});
export const resultViewSchema = z.object({ resultId: z.uuid(), snapshotId: z.string(), createdAt: z.iso.datetime(), dataVersion: z.string(),
  scopeFingerprint: z.string(), registryVersion: z.string(), operation: z.enum(['list', 'rank', 'aggregate', 'compare', 'trend', 'group_aggregate', 'group_trend', 'cross_aggregate', 'relationship', 'distribution', 'submission_progress', 'future_observation']),
  parameters: z.record(z.string(), z.unknown()), analysis: z.unknown(), limitations: z.array(text), sources: z.array(sourceSchema).max(200000),
  table: z.object({ id: z.string(), columns: z.array(z.object({ key: z.string(), label: text, unit: z.string().nullable() })).max(30),
    rows: z.array(z.object({ entityId: text, cells: z.record(z.string(), resultCellSchema) })).max(100000) }),
}).superRefine((result, ctx) => {
  if(result.operation==='future_observation' && ['area_summary','launch_schedule'].includes(String(result.parameters.view)) && !supplyOverviewSchema.safeParse(result.parameters.supply).success) ctx.addIssue({code:'custom',message:'Invalid archived future supply summary'});
  if(result.operation==='future_observation' && Object.hasOwn(result.parameters,'answer') && !futureAnswerSchema.safeParse(result.parameters.answer).success) ctx.addIssue({code:'custom',message:'Invalid archived future answer'});
  const sources = new Set(result.sources.map(source => source.id));
  for (const row of result.table.rows) for (const column of result.table.columns) {
    const cell = row.cells[column.key];
    if (!cell || cell.sourceIds.some(id => !sources.has(id))) ctx.addIssue({ code: 'custom', message: 'Incomplete table source binding' });
  }
});
export type QueryResultView = z.infer<typeof resultViewSchema>;
export type DisplayCell = z.infer<typeof resultCellSchema>;
export const units: Record<string, string> = { text: '文本', m: '米', floor: '层', space: '个', m2: '㎡', 'CNY/m2/month': '元/㎡/月', ratio: '%', percent: '%', percentage_point: '百分点', building_count: '栋', record_count: '条', task_count: '项', 'CNY/m2/day': '元/㎡/天', month: '月' };
export const unknownLabels = { missing: '未知：缺少数据', invalid: '未知：数据无效', conflict: '未知：来源冲突', unverified: '未知：尚未核验' } as const;

export function cellText(cell: DisplayCell, unit: string | null): string {
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
  const analysis = z.record(z.string(), z.unknown()).safeParse(result.analysis);
  const a = analysis.success ? analysis.data : {};
  const coverage = coverageText(a.coverage), rows = result.table.rows;
  if(result.operation==='future_observation'){
    if(Object.hasOwn(result.parameters,'answer'))return futureAnswerSchema.parse(result.parameters.answer).paragraphs;
    const a=futureAnalysisSchema.parse(result.analysis),c=a.catalog,p=a.progress;
    return [`当前获权且明确未入市的未来供应记录 ${c.records} 条；其中待核实 ${c.pending} 条、分类未知 ${c.statusUnknown} 条，未关联楼宇 ${c.unlinkedIdentities} 条。记录数不等于已确认的不同楼宇数。`,
      `预计季度明确 ${c.knownLaunchQuarter} 条，仅明确半年 ${c.launchHalfYear} 条、年份 ${c.launchYearOnly} 条；年份未知 ${c.launchUnknown} 条、时间无效 ${c.launchInvalid} 条。`,
      ...(p?[`该季已分配 ${p.assignedSupplies} 条记录，其中有提交 ${p.assignedSubmittedSupplies} 条、未提交 ${p.missingAssignedSupplies} 条；提交覆盖率 ${p.coverage?formatExact({exact:p.coverage,numeric:0},'ratio')+'%':'未知（没有已分配任务）'}。`,
        `人员任务 ${p.assignmentPairs} 项，本人已提交 ${p.submittedOwnerPairs} 项、未提交 ${p.missingOwnerPairs} 项；未知提交人记录 ${p.unknownSubmitterRows} 条，不猜归属。`,
        '季度任务不限定预计当季入市；任一人员提交覆盖与本人提交任务采用不同分母，提交不代表完整、有效或审定。']:[`总面积有效 ${c.knownArea} 条、缺失 ${c.missingArea} 条、无效 ${c.invalidArea} 条；原字段不自动等于办公或可租面积。`]),
      ...(result.table.rows.length===0?['本次授权范围没有符合该明细条件的记录，不代表现实市场没有。']:[])];
  }
  if (result.operation === 'submission_progress') {
    const a=submissionAnalysisSchema.parse(result.analysis),c=a.counts;
    const coverage=a.submittedCoverage?formatExact({exact:a.submittedCoverage,numeric:0},'ratio')+'%':'未知（没有已分配楼宇）';
    const view=String(result.parameters.view);
    return [`当前获权存量 ${c.catalogBuildings} 栋；已分配 ${c.assignedBuildings} 栋，其中有该季提交 ${c.assignedSubmittedBuildings} 栋、未提交 ${c.missingAssignedBuildings} 栋。提交覆盖率 ${coverage}。`,
      `未分配 ${c.unassignedBuildings} 栋，其中有提交 ${c.unassignedSubmittedBuildings} 栋；人员任务 ${c.assignmentPairs} 项，本人已提交 ${c.submittedOwnerPairs} 项、未提交 ${c.missingOwnerPairs} 项。`,
      '楼宇覆盖按任一人员提交计，人员任务按本人提交计；提交不代表完整、有效或已审定。',
      ...(a.quality?[`最新记录可判定 ${a.quality.evaluatedBuildings} 栋；五项输入齐全 ${a.quality.requiredCompleteBuildings} 栋、缺项 ${a.quality.missingRequiredBuildings} 栋；发现核查事项 ${a.quality.flaggedBuildings} 栋。`]:[]),
      ...(c.latestUnresolvedBuildings?[`${c.latestUnresolvedBuildings} 栋存在缺少提交时间的记录，无法确定最新值。`]:[]),
      ...(view==='missing'?['下表为该季度没有提交的楼宇，已分配未提交和未分配分别标明。']:view==='missing_fields'?['下表同时保留未提交或最新记录无法确定的楼宇，不能把这些情况说成已检查出缺项。']:[]),
      ...(rows.length===0?['本次范围没有符合该明细条件的记录；不代表范围以外没有问题。']:[])];
  }
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
  const scope = z.object({ inventory: z.string().optional(), submarkets: z.array(z.string()).optional() }).safeParse(result.parameters.scope);
  const s = scope.success ? scope.data : {};
  const period = quarterSchema.safeParse(result.parameters.period);
  const start=quarterSchema.safeParse(result.parameters.start),end=quarterSchema.safeParse(result.parameters.end);
  const isTrend = result.operation === 'trend' || result.operation === 'group_trend';
  const range=isTrend&&start.success&&end.success?`，${start.data.year}Q${start.data.quarter} 至 ${end.data.year}Q${end.data.quarter}`:'';
  if(result.operation==='future_observation')return `${s.submarkets?.join('、')||'当前获权范围'}；当前明确未入市的未来供应记录${period.success?`，${period.data.year}Q${period.data.quarter}季度任务（${result.parameters.periodBasis==='configured'?'系统配置':'明确指定'}），当前保存的该季任务`:'，预计入市保留原时间精度'}。`;
  if(result.operation==='submission_progress'&&period.success)return `${s.submarkets?.join('、')||'当前获权范围'}，${period.data.year} 年第 ${period.data.quarter} 季度；${result.parameters.periodBasis==='configured'?'取系统配置的填报季度':'明确指定季度'}，当前存量目录与当前分配。`;
  return `${s.submarkets?.join('、') || '当前获权范围'}${range}${period.success && !isTrend ? `，${period.data.year} 年第 ${period.data.quarter} 季度` : ''}；${s.inventory === 'tracked' ? '当前跟踪楼宇样本' : '当前楼宇目录'}。`;
}
