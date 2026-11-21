import { z } from 'zod';
import { quarterSchema } from './contracts';
import { cellText, formatExact, resultScopeText, resultSummary, units, type QueryResultView } from './presentation';
import { metricLabels, resultMetrics } from './multiMetricView';
import { researchAnalysisSchema } from './researchAnalysisView';
import { numericFields } from './registry';

export const resultCopyFormatSchema = z.enum(['conclusion', 'figures', 'summary']);
export type ResultCopyFormat = z.infer<typeof resultCopyFormatSchema>;
export const RESULT_COPY_MAX_CHARACTERS = 120000;
const ROW_LIMIT = 20;
const findingLimit = 12;
const scopeSchema = z.object({ submarkets: z.array(z.string()).optional(), buildingIds: z.array(z.string()).optional() });
const fieldNames: Record<string, string> = { ...Object.fromEntries(Object.entries(numericFields).map(([key, rule]) => [key, rule.label])), vacancy: metricLabels.vacancy };
const fieldUnits: Record<string, string> = Object.fromEntries(Object.entries(numericFields).map(([key, rule]) => [key, units[rule.unit] ?? rule.unit]));
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string') ? value as string[] : [];
const quarterText = (value: unknown) => { const p = quarterSchema.safeParse(value); return p.success ? `${p.data.year}Q${p.data.quarter}` : null; };

/** Descriptive labels only; neither resolves a new entity nor reads current data. */
export function resultOutputDescriptor(result: QueryResultView): { object: string; metric: string; period: string } {
  if (result.parameters.dataDomain === 'lease-research/1') {
    const bindings = result.parameters.leaseBindings as Array<{ plan?: { from?: string; to?: string } }>;
    const periods = [...new Set((bindings ?? []).flatMap(b => b.plan?.from && b.plan?.to ? [b.plan.from + '至' + b.plan.to] : []))];
    return { object: '获权租赁成交', metric: '成交研究', period: periods.join('与') || '见来源期间' };
  }
  const scope = scopeSchema.safeParse(result.parameters.scope).data;
  const ids = scope?.buildingIds ?? [];
  const requested = new Set(ids);
  const byId = new Map(ids.length ? result.sources.filter(source => requested.has(source.entityId) && source.table === 'buildings' && source.field === 'name' && typeof source.rawValue === 'string')
    .map(source => [source.entityId, source.rawValue as string]) : []);
  const names = ids.map(id => byId.get(id) ?? `楼宇${id}`);
  const object = names.length ? names.slice(0, 3).join('、') + (names.length > 3 ? `等${names.length}栋` : '')
    : scope?.submarkets?.join('、') || '获权楼宇';
  const metrics = resultMetrics(result);
  const fields = strings(result.parameters.fields);
  const field = typeof result.parameters.field === 'string' ? result.parameters.field : typeof result.parameters.measure === 'string' ? result.parameters.measure : null;
  const metric = metrics.length ? metrics.map(item => metricLabels[item]).join('与') : result.operation === 'relationship' ? '净有效租金与空置率'
    : fields.length ? fields.map(key => fieldNames[key] ?? key).join('与') : field ? fieldNames[field] ?? field : '楼宇清单';
  const selected = ['period', 'start', 'end', 'base', 'current'].flatMap(key => quarterText(result.parameters[key]) ?? []);
  const periods = selected.length ? [...new Set(selected)] : [...new Set(result.sources.flatMap(source => quarterText(source.period) ?? []))].sort();
  return { object, metric, period: periods.length ? periods.join(result.operation === 'compare' ? '与' : '至') : '非季度参数' };
}

function filterText(value: unknown, depth = 0): string | null {
  if (depth > 24) throw new Error('ARTIFACT_FILTER_DEPTH');
  const item = record(value);
  if (item.operator === 'and' || item.operator === 'or') {
    if (!Array.isArray(item.terms)) return null;
    return '(' + item.terms.map(term => filterText(term, depth + 1) ?? '未识别条件（见原结果）').join(item.operator === 'and' ? ' 且 ' : ' 或 ') + ')';
  }
  if (typeof item.field !== 'string' || typeof item.value !== 'string' || typeof item.operator !== 'string') return null;
  const operators: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };
  if (!operators[item.operator]) return null;
  return `${fieldNames[item.field] ?? item.field} ${operators[item.operator]} ${item.value}${fieldUnits[item.field] ? ` ${fieldUnits[item.field]}` : ''}`;
}

function contextLines(result: QueryResultView): string[] {
  const descriptor = resultOutputDescriptor(result);
  const plan = record(result.parameters.executedPlan);
  const filter = filterText(plan.filter ?? result.parameters.filter ?? result.parameters.where);
  return [
    `分析主题：${descriptor.object} · ${descriptor.metric}`,
    `数据期间：${descriptor.period}`,
    `数据范围：${resultScopeText(result)}`,
    ...(filter ? [`筛选条件：${filter}`] : []),
    ...(result.operation === 'rank' ? [`排名：${result.parameters.direction === 'asc' ? '从低到高' : '从高到低'}，前 ${String(result.parameters.limit)} 名（保留末位并列）。`] : []),
  ];
}

function researchFor(result: QueryResultView) {
  const parsed = researchAnalysisSchema.safeParse(result.parameters.researchAnalysis);
  if (!parsed.success) return null;
  const known = new Set(result.sources.map(source => source.id));
  return parsed.data.findings.every(finding => finding.sourceIds.every(id => known.has(id))) ? parsed.data : null;
}

function keyFigures(result: QueryResultView): string[] {
  const rows = result.table.rows.slice(0, ROW_LIMIT);
  if (!rows.length) return ['本次结果没有符合条件的记录。'];
  return [result.table.columns.map(column => column.label + (column.unit ? `（${units[column.unit] ?? column.unit}）` : '')).join('\t'),
    ...rows.map(row => result.table.columns.map(column => {
      const cell = row.cells[column.key], text = cellText(cell, column.unit).replace(/[\t\r\n]+/g, ' ');
      // TSV is commonly pasted into Excel. Only source text needs the same
      // formula-injection defense as CSV; real signed numbers stay numbers.
      return cell.kind === 'text' && /^[\s\p{Cf}]*[=+\-@]/u.test(text) ? `'${text}` : text;
    }).join('\t')),
    ...(result.table.rows.length > ROW_LIMIT ? [`关键数字列出前 ${ROW_LIMIT} 行，共 ${result.table.rows.length} 行；完整明细请导出 Excel / CSV。`] : []),
  ];
}

/** Deterministic composition of the saved answer and its table. No model,
 * source read, fresh quarter selection, or business-statistic recalculation. */
export function renderResultCopy(result: QueryResultView, format: ResultCopyFormat): string {
  resultCopyFormatSchema.parse(format);
  const summary = resultSummary(result), research = researchFor(result);
  const findings = research?.findings ?? [];
  const trendFindings = findings.filter(finding => finding.kind === 'trend');
  const comparability = findings.filter(finding => finding.kind === 'comparability');
  const quality = findings.filter(finding => finding.kind === 'quality');
  const context = contextLines(result);
  const limitations = [...new Set([...result.limitations,
    '结果来自已保存的数据快照，不代表实时行情；未知值没有按零处理。',
    ...(result.sources.some(source => source.verification === 'database_only') ? ['数据库记录存在不等于原始资料已核验。'] : []),
  ])];
  const version = [`结果编号：${result.resultId}`, `数据版本：${result.dataVersion}；字段口径：${result.registryVersion}`,
    `快照生成时间：${result.createdAt}（UTC）`];
  let sections: string[];
  if (format === 'figures') {
    sections = [...context, '', '关键数字', ...keyFigures(result), '', '样本与统计口径', ...summary, '', '来源与限制', ...limitations, ...version];
  } else if (format === 'conclusion') {
    sections = [...context, '', '核心结论', ...(trendFindings.length ? trendFindings.slice(0, findingLimit).map(finding => finding.text) : summary.slice(0, 1)),
      ...(trendFindings.length > findingLimit ? [`本次复制列出前 ${findingLimit} 项趋势结论，共 ${trendFindings.length} 项，其余见原结果。`] : []),
      '', '样本与统计口径', ...summary, ...comparability.slice(0, findingLimit).map(finding => finding.text),
      ...(comparability.length > findingLimit ? [`样本可比性列出前 ${findingLimit} 项，共 ${comparability.length} 项；其余见原分析。`] : []),
      '', '来源与限制', ...limitations, ...version];
  } else {
    const selected = findings.filter(finding => finding.kind !== 'method');
    const sampleLines = research?.series.slice(0, 10).map(series => {
      const latest = series.periods.at(-1);
      return `${series.label || metricLabels[series.metric]}：${series.mode === 'paired' ? '全期间共同有效样本' : '各期独立有效样本'}；共同样本 ${series.commonEntityIds.length} 栋。`
        + (latest ? `末期 ${quarterText(latest.period)} 参与 ${latest.usedCount} 栋；分母 ${formatExact(latest.denominator, latest.denominatorUnit)} ${units[latest.denominatorUnit]}。` : '没有可用的期间样本。');
    }) ?? [];
    sections = [...context, '', '核心发现与趋势', ...(selected.length ? selected.slice(0, findingLimit).map(finding => `${finding.title}：${finding.text}`) : summary),
      ...(selected.length > findingLimit ? [`摘要列出 ${findingLimit} 项发现，共 ${selected.length} 项；其余见原分析。`] : []),
      '', '关键指标', ...keyFigures(result), '', '有效样本与统计口径', ...summary, ...sampleLines,
      ...((research?.series.length ?? 0) > 10 ? [`样本说明列出前 10 组，共 ${research!.series.length} 组；各组完整信息见原结果。`] : []),
      '', '异常关注', ...(quality.length ? quality.slice(0, findingLimit).map(finding => finding.text)
        : ['本快照未提供可用的异常检测结论，不能据此判断不存在异常。']),
      ...(quality.length > findingLimit ? [`异常与质量说明列出前 ${findingLimit} 项，共 ${quality.length} 项；其余见原分析。`] : []),
      '', '统计口径与来源限制', ...limitations, ...version];
  }
  const text = sections.join('\n');
  if (text.length > RESULT_COPY_MAX_CHARACTERS) throw new Error('ARTIFACT_TEXT_SIZE_LIMIT');
  return text;
}
