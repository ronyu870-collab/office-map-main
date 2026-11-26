import { aggregateQuarter, compareQuarters, type AggregateMetric } from './analytics';
import { assertComplete, quarterKey, type FactSnapshot, type NumericOutput, type Quarter } from './contracts';
import { Decimal } from './decimal';
import { buildingDistribution } from './distribution';
import { getFact } from './facts';
import { groupedQuarterAnalysis } from './grouping';
import { crossTabMemberships } from './crossTab';
import { CROSS_TREND_LIMITS } from './plan';
import { formatExact, units } from './presentation';
import { FORMULAS } from './registry';
import type { QueryResult } from './result';
import { researchAnalysisSchema, type ResearchAnalysis, type ResearchAnomaly, type ResearchChange, type ResearchPeriod, type ResearchSeries } from './researchAnalysisView';
import { resultMetrics } from './multiMetricView';
import type { NumericField } from './registry';

const from = (value: NumericOutput) => Decimal.fraction(BigInt(value.exact.numerator), BigInt(value.exact.denominator));
const output = (value: Decimal): NumericOutput => {
  const exact = value.exact(), negative = exact.numerator.startsWith('-');
  const numerator = exact.numerator.replace('-', ''), denominator = exact.denominator;
  const n = numerator.slice(0, 17), d = denominator.slice(0, 17);
  const numeric = (negative ? -1 : 1) * Number(n) / Number(d) * 10 ** (numerator.length - n.length - denominator.length + d.length);
  if (!Number.isFinite(numeric)) throw new Error('NUMERIC_PROJECTION_OVERFLOW');
  return { exact, numeric };
};
const unique = (values: readonly string[]) => [...new Set(values)].sort();
const order = (period: Quarter) => period.year * 4 + period.quarter;
const hundred = Decimal.parse(100)!;
const metricLabel = (metric: AggregateMetric) => metric === 'rent' ? '净有效租金' : metric === 'vacancy' ? '空置率' : '季度总面积';
const metricUnit = (metric: AggregateMetric) => metric === 'rent' ? 'CNY/m2/month' as const : metric === 'vacancy' ? 'ratio' as const : 'm2' as const;
const differenceUnit = (metric: AggregateMetric) => metric === 'vacancy' ? 'percentage_point' as const : metricUnit(metric) as 'CNY/m2/month' | 'm2';

/** Supplemental research is bounded independently of the original executor.
 * The query table remains usable if these additional exact calculations or
 * their repeated provenance exceed the interactive budget. */
export const RESEARCH_ANALYSIS_LIMITS = Object.freeze({ observations: 5000, inputSourceReferences: 15000,
  inputSourceCharacters: 1024 * 1024, anomalies: 100, anomalySourceReferences: 5000, outputBytes: 4 * 1024 * 1024,
  combinedResultBytes: 15 * 1024 * 1024 });
type AnomalyBudget = { returned: number; sourceReferences: number };

/** Only exact values supplied by the trusted engine enter change arithmetic. */
function changeBetween(base: Pick<ResearchPeriod, 'period' | 'value' | 'sourceIds'>,
  current: Pick<ResearchPeriod, 'period' | 'value' | 'sourceIds'>, metric: AggregateMetric): ResearchChange {
  const before = base.value && from(base.value), after = current.value && from(current.value);
  const difference = before && after ? after.subtract(before) : null;
  const zeroBase = before?.compare(Decimal.zero()) === 0;
  const change = difference ? metric === 'vacancy' ? difference.multiply(hundred) : zeroBase ? null : difference.divide(before!).multiply(hundred) : null;
  return {
    base: base.period, current: current.period, baseValue: base.value, currentValue: current.value,
    difference: difference ? output(metric === 'vacancy' ? difference.multiply(hundred) : difference) : null,
    differenceUnit: differenceUnit(metric), change: change ? output(change) : null,
    changeUnit: metric === 'vacancy' ? 'percentage_point' : 'percent',
    unavailableReason: !before || !after ? 'no_valid_sample' : zeroBase && metric !== 'vacancy' ? 'zero_base' : null,
    sourceIds: unique([...base.sourceIds, ...current.sourceIds]),
  };
}

function toPeriod(snapshot: FactSnapshot, metric: AggregateMetric, available: ReturnType<typeof aggregateQuarter>,
  commonIds?: ReadonlySet<string>): ResearchPeriod {
  const rows = commonIds ? snapshot.rows.filter(row => commonIds.has(row.id)) : snapshot.rows;
  const chosen = commonIds ? aggregateQuarter({ ...snapshot, rows, expectedCount: rows.length }, metric) : available;
  const values = chosen.contributions.map(c => metric === 'totalArea' ? from(c.numerator) : from(c.numerator).divide(from(c.denominator)));
  const sum = values.reduce((total, value) => {
    const next = total.add(value);
    if (next.numerator.toString(2).length > 16384 || next.denominator.toString(2).length > 16384) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
    return next;
  }, Decimal.zero());
  return {
    period: snapshot.period!, value: chosen.value,
    simpleMean: values.length ? output(sum.divide(Decimal.parse(values.length)!)) : null,
    usedCount: chosen.contributions.length, coverage: available.coverage, numerator: chosen.numerator,
    denominator: chosen.denominator, denominatorUnit: metric === 'totalArea' ? 'building_count' : 'm2',
    usedEntityIds: chosen.contributions.map(c => c.entityId).sort(),
    sourceIds: unique([...chosen.contributions.flatMap(c => c.sourceIds), ...available.excluded.flatMap(e => e.sourceIds)]),
  };
}

function sampleComparison(base: FactSnapshot, current: FactSnapshot, metric: AggregateMetric): ResearchSeries['comparability'][number] {
  const per = compareQuarters(base, current, metric, 'per_period');
  const paired = compareQuarters(base, current, metric, 'paired');
  const before = new Set(per.base.usedEntityIds), after = new Set(per.current.usedEntityIds);
  return {
    base: base.period!, current: current.period!, baseCount: before.size, currentCount: after.size, commonCount: per.pairedIds.length,
    enteredEntityIds: [...after].filter(id => !before.has(id)).sort(), exitedEntityIds: [...before].filter(id => !after.has(id)).sort(),
    baseDenominator: per.base.denominator, currentDenominator: per.current.denominator,
    denominatorDifference: output(from(per.current.denominator).subtract(from(per.base.denominator))),
    denominatorUnit: metric === 'totalArea' ? 'building_count' : 'm2',
    perPeriod: changeBetween({ ...per.base, period: base.period! }, { ...per.current, period: current.period! }, metric),
    commonSample: changeBetween({ ...paired.base, period: base.period! }, { ...paired.current, period: current.period! }, metric),
    sourceIds: unique([...per.base.sourceIds, ...per.current.sourceIds,
      ...per.base.excluded.flatMap(e => e.sourceIds), ...per.current.excluded.flatMap(e => e.sourceIds)]),
  };
}

function detectAnomalies(snapshots: readonly FactSnapshot[], metric: AggregateMetric,
  aggregates: readonly ReturnType<typeof aggregateQuarter>[], budget: AnomalyBudget) {
  const alerts: ResearchAnomaly[] = [];
  let iqrDetected = 0, quarterOnQuarterDetected = 0;
  const retain = (candidate: Omit<ResearchAnomaly, 'sourceIds'>, references: () => string[]) => {
    if (candidate.rule === 'iqr_1_5') iqrDetected++; else quarterOnQuarterDetected++;
    if (budget.returned >= RESEARCH_ANALYSIS_LIMITS.anomalies
      || budget.sourceReferences >= RESEARCH_ANALYSIS_LIMITS.anomalySourceReferences) return;
    const sourceIds = references();
    if (budget.sourceReferences + sourceIds.length > RESEARCH_ANALYSIS_LIMITS.anomalySourceReferences) return;
    alerts.push({ ...candidate, sourceIds }); budget.returned++; budget.sourceReferences += sourceIds.length;
  };
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i], distribution = buildingDistribution(snapshot, metric);
    const rows = new Map(snapshot.rows.map(row => [row.id, row]));
    if (distribution.stats) {
      // A fence depends on every valid observation. Compute this evidence once;
      // do not scan or copy the full distribution for every unreturned outlier.
      const fenceSources = unique(distribution.observations.filter(row => row.value !== null).flatMap(row => row.sourceIds));
      for (const observation of distribution.observations.filter(row => row.outlier === true)) {
        retain({ rule: 'iqr_1_5', entityId: observation.entityId, name: observation.name, period: snapshot.period!,
          basePeriod: null, value: observation.value!, baseValue: null, change: null, changeUnit: null, threshold: null,
          lowerFence: distribution.stats.lowerFence, upperFence: distribution.stats.upperFence, sampleCount: distribution.coverage.valid,
        }, () => unique([...fenceSources, rows.get(observation.entityId)!.nameSource.id]));
      }
    }
    if (i === 0 || metric === 'totalArea' || order(snapshot.period!) - order(snapshots[i - 1].period!) !== 1) continue;
    const previous = new Map(aggregates[i - 1].contributions.map(c => [c.entityId, c]));
    const names = new Map(snapshot.rows.map(row => [row.id, row.name]));
    for (const contribution of aggregates[i].contributions) {
      const prior = previous.get(contribution.entityId);
      if (!prior) continue;
      const baseValue = output(from(prior.numerator).divide(from(prior.denominator)));
      const value = output(from(contribution.numerator).divide(from(contribution.denominator)));
      const change = changeBetween({ period: snapshots[i - 1].period!, value: baseValue, sourceIds: prior.sourceIds },
        { period: snapshot.period!, value, sourceIds: contribution.sourceIds }, metric);
      const threshold = Decimal.parse(metric === 'rent' ? 30 : 10)!;
      const amount = change.change && from(change.change);
      const absolute = amount && (amount.compare(Decimal.zero()) < 0 ? amount.multiply(Decimal.parse(-1)!) : amount);
      if (!absolute || absolute.compare(threshold) < 0) continue;
      retain({ rule: metric === 'rent' ? 'entity_qoq_rent_30_percent' : 'entity_qoq_vacancy_10_pp',
        entityId: contribution.entityId, name: names.get(contribution.entityId)!, period: snapshot.period!, basePeriod: snapshots[i - 1].period!,
        value, baseValue, change: change.change, changeUnit: change.changeUnit, threshold: output(threshold),
        lowerFence: null, upperFence: null, sampleCount: 1,
      }, () => unique([...change.sourceIds, rows.get(contribution.entityId)!.nameSource.id]));
    }
  }
  const detected = iqrDetected + quarterOnQuarterDetected;
  return { anomalies: alerts, anomalyCoverage: { complete: detected === alerts.length, detected,
    returned: alerts.length, omitted: detected - alerts.length, iqrDetected, quarterOnQuarterDetected } };
}

function analyzeSeries(key: string, label: string, input: readonly FactSnapshot[], metric: AggregateMetric,
  mode: 'per_period' | 'paired', budget: AnomalyBudget): ResearchSeries {
  const snapshots = [...input].sort((a, b) => order(a.period!) - order(b.period!));
  const aggregates = snapshots.map(snapshot => aggregateQuarter(snapshot, metric));
  const common = aggregates.slice(1).reduce((ids, aggregate) => new Set(aggregate.contributions.filter(c => ids.has(c.entityId)).map(c => c.entityId)),
    new Set(aggregates[0].contributions.map(c => c.entityId)));
  const perPeriod = snapshots.map((snapshot, i) => toPeriod(snapshot, metric, aggregates[i]));
  const commonSample = snapshots.map((snapshot, i) => toPeriod(snapshot, metric, aggregates[i], common));
  const periods = mode === 'paired' ? commonSample : perPeriod;
  const changes: ResearchChange[] = [], years: ResearchChange[] = [];
  const index = new Map(periods.map(period => [order(period.period), period]));
  for (const period of periods) {
    const previous = index.get(order(period.period) - 1), priorYear = index.get(order(period.period) - 4);
    if (previous) changes.push(changeBetween(previous, period, metric));
    if (priorYear) years.push(changeBetween(priorYear, period, metric));
  }
  const signs = changes.map(change => change.difference ? from(change.difference).compare(Decimal.zero()) : null);
  const direction: ResearchSeries['direction'] = periods.length === 1 ? 'single_period'
    : periods.some(period => period.value === null) || changes.length !== periods.length - 1 ? 'incomplete'
      : signs.every(sign => sign === 1) ? 'increasing' : signs.every(sign => sign === -1) ? 'decreasing'
        : signs.every(sign => sign === 0) ? 'stable' : 'fluctuating';
  const comparability = snapshots.slice(1).map((snapshot, i) => sampleComparison(snapshots[i], snapshot, metric));
  if (snapshots.length > 2) comparability.push(sampleComparison(snapshots[0], snapshots.at(-1)!, metric));
  return {
    key, label, metric, unit: metricUnit(metric), mode, formulaVersion: FORMULAS[metric], periods, perPeriod, commonSample,
    commonEntityIds: [...common].sort(), direction, overall: periods.length > 1 ? changeBetween(periods[0], periods.at(-1)!, metric) : null,
    quarterOnQuarter: changes, yearOnYear: years, comparability, ...detectAnomalies(snapshots, metric, aggregates, budget),
    classificationTime: 'current_catalog',
  };
}

function seriesFindings(series: ResearchSeries): ResearchAnalysis['findings'] {
  const findings: ResearchAnalysis['findings'] = [];
  const prefix = series.label ? `${series.label}：` : '';
  const unit = units[series.unit], label = metricLabel(series.metric), allSources = unique(series.perPeriod.flatMap(period => period.sourceIds));
  const overall = series.overall;
  const changeText = (change: ResearchChange) => change.change ? `${formatExact(change.change, change.changeUnit)} ${change.changeUnit === 'percentage_point' ? '个百分点' : units[change.changeUnit]}`
    : change.unavailableReason === 'zero_base' ? '基期为零，不计算相对变化率' : '缺少有效样本，不计算变化';
  if (overall) {
    const first = overall.baseValue ? `${formatExact(overall.baseValue, series.unit)} ${unit}` : '未知';
    const last = overall.currentValue ? `${formatExact(overall.currentValue, series.unit)} ${unit}` : '未知';
    const direction = { increasing: series.periods.length > 2 ? '逐季连续上升' : '', decreasing: series.periods.length > 2 ? '逐季连续下降' : '', stable: series.periods.length > 2 ? '各季持平' : '两期持平',
      fluctuating: '各季有波动或持平', incomplete: '期间有缺期或缺值，不判断连续涨跌', single_period: '' }[series.direction];
    findings.push({ id: `${series.key}/trend`, kind: 'trend', title: `${series.label || '当前范围'}${series.label.endsWith(` · ${label}`) ? '' : label}变化`,
      text: `${prefix}${quarterKey(overall.base)} 为 ${first}，${quarterKey(overall.current)} 为 ${last}。${overall.difference
        ? series.metric === 'vacancy' ? `变化 ${changeText(overall)}。` : `绝对变化 ${formatExact(overall.difference, overall.differenceUnit)} ${units[overall.differenceUnit]}；相对变化 ${changeText(overall)}。`
        : '起止值不完整，不计算总体变化。'}${direction ? direction + '。' : ''}`,
      sourceIds: overall.sourceIds, evidence: { seriesKey: series.key, calculation: 'overall', direction: series.direction, formulaVersion: series.formulaVersion, mode: series.mode },
    });
    const recent = series.quarterOnQuarter.at(-1);
    const yoy = series.yearOnYear.at(-1);
    if (recent || yoy) findings.push({ id: `${series.key}/changes`, kind: 'trend', title: '环比与同比',
      text: `${prefix}${recent ? `${quarterKey(recent.current)} 较 ${quarterKey(recent.base)} 环比 ${changeText(recent)}。` : ''}${yoy
        ? `${quarterKey(yoy.current)} 较 ${quarterKey(yoy.base)} 同比 ${changeText(yoy)}。` : '本次范围未同时包含相差四个季度的有效比较期，不报告同比。'}`,
      sourceIds: unique([...(recent?.sourceIds ?? []), ...(yoy?.sourceIds ?? [])]), evidence: { seriesKey: series.key,
        quarterOnQuarterIndex: recent ? series.quarterOnQuarter.length - 1 : null, yearOnYearIndex: yoy ? series.yearOnYear.length - 1 : null },
    });
    const comparison = series.comparability.at(-1)!;
    const sampleChanged = comparison.enteredEntityIds.length > 0 || comparison.exitedEntityIds.length > 0;
    findings.push({ id: `${series.key}/comparability`, kind: 'comparability', title: '样本与可比性',
      text: `${prefix}${quarterKey(comparison.base)} 有效 ${comparison.baseCount} 栋，${quarterKey(comparison.current)} 有效 ${comparison.currentCount} 栋；两期共同有效 ${comparison.commonCount} 栋，进入有效样本 ${comparison.enteredEntityIds.length} 栋、退出 ${comparison.exitedEntityIds.length} 栋。${comparison.denominatorUnit === 'm2' ? '有效面积分母' : '样本分母'}从 ${formatExact(comparison.baseDenominator, null)} 变为 ${formatExact(comparison.currentDenominator, null)} ${units[comparison.denominatorUnit]}。各期样本变化 ${changeText(comparison.perPeriod)}；两期共同样本变化 ${changeText(comparison.commonSample)}。${sampleChanged
        ? '样本构成不同，均值变化不能直接解释为市场真实变化。' : '两期有效楼宇相同；面积权重仍可能变化，不能据此推断原因。'}${series.periods.length > 2 ? `全期间共同有效样本 ${series.commonEntityIds.length} 栋，其逐期值已同时保留。` : ''}进入或退出只指本次指标有效性，不代表楼宇实际新增或退市。`,
      sourceIds: comparison.sourceIds, evidence: { seriesKey: series.key, comparabilityIndex: series.comparability.length - 1,
        allPeriodCommonCount: series.commonEntityIds.length, classificationTime: series.classificationTime },
    });
  }
  const latest = series.periods.at(-1)!;
  if (latest.value && latest.simpleMean && series.metric !== 'totalArea') findings.push({
    id: `${series.key}/weighting`, kind: 'method', title: '加权与简单平均',
    text: `${prefix}${quarterKey(latest.period)} 正式${label} ${formatExact(latest.value, series.unit)} ${unit}；同一参与样本逐楼简单平均 ${formatExact(latest.simpleMean, series.unit)} ${unit}。${series.metric === 'rent'
      ? '正式租金按有效总面积加权，简单平均仅供核对，不替代正式口径。' : '正式空置率为同一有效记录的空置面积合计÷总面积合计，逐楼比例简单平均仅供核对。'}`,
    sourceIds: latest.sourceIds, evidence: { period: latest.period, formulaVersion: series.formulaVersion, numerator: latest.numerator,
      denominator: latest.denominator, denominatorUnit: latest.denominatorUnit, weightedValue: latest.value, simpleMean: latest.simpleMean, usedCount: latest.usedCount },
  });
  const excluded = series.perPeriod.filter(period => period.coverage.valid < period.coverage.total);
  if (excluded.length) findings.push({ id: `${series.key}/coverage`, kind: 'quality', title: '缺失与排除情况',
    text: `${prefix}${excluded.map(period => `${quarterKey(period.period)} 候选 ${period.coverage.total} 栋，有效 ${period.coverage.valid} 栋，缺失 ${period.coverage.missing}、无效 ${period.coverage.invalid}、来源冲突 ${period.coverage.conflict}、未核验 ${period.coverage.unverified}`).join('；')}。缺失和无效值不按零处理。`,
    sourceIds: allSources, evidence: { periods: excluded.map(period => ({ period: period.period, coverage: period.coverage })) },
  });
  if (series.anomalies.length || series.anomalyCoverage?.detected) {
    const qoq = series.anomalies.filter(anomaly => anomaly.rule !== 'iqr_1_5'), iqr = series.anomalies.filter(anomaly => anomaly.rule === 'iqr_1_5');
    const first = qoq[0] ?? iqr[0];
    const coverage = series.anomalyCoverage;
    const detail = !first ? '' : first.basePeriod
      ? `${first.name} 从 ${quarterKey(first.basePeriod)} 的 ${formatExact(first.baseValue!, series.unit)} 变为 ${quarterKey(first.period)} 的 ${formatExact(first.value, series.unit)} ${unit}，变化 ${formatExact(first.change!, first.changeUnit)} ${units[first.changeUnit!]}。`
      : `${first.name} 在 ${quarterKey(first.period)} 的 ${label} ${formatExact(first.value, series.unit)} ${unit} 超出同组有效样本围栏。`;
    findings.push({ id: `${series.key}/anomalies`, kind: 'quality', title: '需要核查的变化',
      text: `${prefix}同楼相邻季度变化触发提醒 ${coverage?.quarterOnQuarterDetected ?? qoq.length} 条，1.5×IQR围栏外记录 ${coverage?.iqrDetected ?? iqr.length} 条。${coverage?.omitted
        ? `本次已完成检测；交互资源限额内仅列举 ${coverage.returned} 条，另有 ${coverage.omitted} 条未列举，请缩小范围查看其明细。` : ''}${detail}建议核查录入与统计口径；提醒不代表数据错误，不删除该记录，也不推断市场事件。`,
      sourceIds: unique([...allSources, ...(first?.sourceIds ?? [])]), evidence: { count: coverage?.detected ?? series.anomalies.length,
        adjacentQuarterCount: coverage?.quarterOnQuarterDetected ?? qoq.length, iqrCount: coverage?.iqrDetected ?? iqr.length,
        returned: series.anomalies.length, omitted: coverage?.omitted ?? 0, anomaliesPath: `series.${series.key}.anomalies` },
    });
  }
  return findings;
}

/** Canonical period evidence remains intact. Derived changes and the
 * mode-selected period alias point back to canonical periods instead of repeating
 * UUID/version source IDs many times in the durable result archive. */
function compactSeriesEvidence(series: ResearchSeries): ResearchSeries {
  const collection = series.mode === 'paired' ? 'commonSample' as const : 'perPeriod' as const;
  const periodIndex = new Map(series.periods.map((period, index) => [quarterKey(period.period), index]));
  const compactChange = (change: ResearchChange): ResearchChange => ({ ...change, sourceIds: [], sourceRefs: [
    { collection, index: periodIndex.get(quarterKey(change.base))! },
    { collection, index: periodIndex.get(quarterKey(change.current))! },
  ] });
  return { ...series,
    periods: series.periods.map((period, index) => ({ ...period, sourceIds: [], sourceRefs: [{ collection, index }] })),
    overall: series.overall ? compactChange(series.overall) : null,
    quarterOnQuarter: series.quarterOnQuarter.map(compactChange), yearOnYear: series.yearOnYear.map(compactChange),
    comparability: series.comparability.map(comparison => {
      const refs: NonNullable<ResearchChange['sourceRefs']> = [
        { collection: 'perPeriod', index: periodIndex.get(quarterKey(comparison.base))! },
        { collection: 'perPeriod', index: periodIndex.get(quarterKey(comparison.current))! },
      ];
      return { ...comparison, sourceIds: [], sourceRefs: refs,
        perPeriod: { ...comparison.perPeriod, sourceIds: [], sourceRefs: refs },
        commonSample: { ...comparison.commonSample, sourceIds: [], sourceRefs: refs },
      };
    }),
  };
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function skippedResearch(result: QueryResult, observationCount: number,
  reason: NonNullable<ResearchAnalysis['resourceUsage']>['reason']): QueryResult {
  const text = `本次范围包含 ${observationCount} 个楼宇×季度观察；补充研究分析达到交互资源限额，未完成额外的趋势解读、共同样本核查及异常检测。原查询指标、表格、图表和来源仍保留。请缩小地区、楼宇或季度范围后继续分析；不能据此判断不存在异常。`;
  const research: ResearchAnalysis = { version: 'research-analysis/1', series: [], rules: [],
    resourceUsage: { status: 'skipped', observationCount, reason, limits: RESEARCH_ANALYSIS_LIMITS },
    findings: [{ id: 'research/resource-limit', kind: 'method', title: '补充分析范围限制', text, sourceIds: [],
      evidence: { reason, observationCount, limits: RESEARCH_ANALYSIS_LIMITS } }] };
  return freeze({ ...result, parameters: { ...result.parameters, researchAnalysis: research },
    limitations: [...result.limitations, text] });
}

/** Adds interpretation to the SAME immutable, authorized snapshot. It does not
 * read a database, call a model, change a table value or expand source fields.
 * Selected snapshots must be the executor's post-filter candidates. */
export function attachResearchAnalysis(result: QueryResult, selected: readonly FactSnapshot[], universe = selected): QueryResult {
  // Single-quarter cross tabs keep their own cell coverage. Cross trends are
  // analyzed independently per intersection, never flattened to a market mean.
  const supported = ['aggregate', 'compare', 'trend', 'group_aggregate', 'group_trend', 'cross_trend'];
  if (!supported.includes(result.operation)) return result;
  const metrics = resultMetrics(result);
  if (!metrics.length) throw new Error('RESEARCH_METRIC_REQUIRED');
  if (!selected.length || selected.length > 40 || selected.length !== universe.length) throw new Error('RESEARCH_SNAPSHOT_REQUIRED');
  for (const snapshot of [...selected, ...universe]) {
    assertComplete(snapshot);
    if (!snapshot.period || snapshot.dataVersion !== result.dataVersion || snapshot.scopeFingerprint !== result.scopeFingerprint) throw new Error('RESEARCH_SNAPSHOT_MISMATCH');
  }
  const observationCount = Math.max(selected.reduce((n, snapshot) => n + snapshot.rows.length, 0),
    universe.reduce((n, snapshot) => n + snapshot.rows.length, 0));
  if (observationCount > RESEARCH_ANALYSIS_LIMITS.observations) return skippedResearch(result, observationCount, 'observation_limit');
  const fields = [...new Set(metrics.flatMap((metric): NumericField[] => metric === 'rent' ? ['totalArea', 'netEffectiveRent']
    : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea']))];
  const dimension = result.operation === 'group_aggregate' || result.operation === 'group_trend' ? result.parameters.groupBy : null;
  if (dimension !== null && dimension !== 'submarket' && dimension !== 'grade') throw new Error('RESEARCH_GROUP_REQUIRED');
  const sourceDimensions: ('submarket' | 'grade')[] = result.operation === 'cross_trend' ? ['submarket', 'grade']
    : dimension === 'submarket' || dimension === 'grade' ? [dimension] : [];
  function* requiredSources() {
    for (const snapshot of selected) for (const row of snapshot.rows) {
      yield row.nameSource;
      for (const field of fields) yield* getFact(row, field).sources;
    }
    for (const sourceDimension of sourceDimensions) for (const snapshot of universe) for (const row of snapshot.rows) {
      const source = row.dimensions?.[sourceDimension]?.source;
      if (!source) throw new Error('GROUP_SOURCE_REQUIRED');
      yield source;
    }
  }
  let sourceReferences = 0, sourceCharacters = 0;
  const requiredIds = new Set<string>();
  for (const source of requiredSources()) {
    sourceReferences++;
    if (!requiredIds.has(source.id)) { sourceCharacters += source.id.length; requiredIds.add(source.id); }
    if (sourceReferences > RESEARCH_ANALYSIS_LIMITS.inputSourceReferences
      || sourceCharacters > RESEARCH_ANALYSIS_LIMITS.inputSourceCharacters) return skippedResearch(result, observationCount, 'evidence_limit');
  }
  try {
    const archivedSources = new Map(result.sources.filter(source => requiredIds.has(source.id)).map(source => [source.id, JSON.stringify(source)]));
    for (const source of requiredSources()) {
      if (archivedSources.get(source.id) !== JSON.stringify(source)) throw new Error('RESEARCH_SOURCE_BINDING_MISMATCH');
    }
    if (new Set(selected.map(snapshot => quarterKey(snapshot.period!))).size !== selected.length) throw new Error('RESEARCH_DUPLICATE_PERIOD');
    const sorted = [...selected].sort((a, b) => order(a.period!) - order(b.period!));
    const sortedUniverse = sorted.map(snapshot => universe.find(candidate => quarterKey(candidate.period!) === quarterKey(snapshot.period!))!);
    if (sortedUniverse.some(snapshot => !snapshot)) throw new Error('RESEARCH_SNAPSHOT_MISMATCH');
    const mode = result.parameters.mode === 'paired' ? 'paired' : 'per_period';
    const budget: AnomalyBudget = { returned: 0, sourceReferences: 0 };
    const cross = result.operation === 'cross_trend' ? crossTabMemberships(sorted, sortedUniverse, CROSS_TREND_LIMITS.groups) : null;
    const series: ResearchSeries[] = metrics.flatMap(metric => {
      const key = (value: string) => metrics.length > 1 ? `${metric}/${value}` : value;
      const label = (value: string) => metrics.length > 1 ? `${value} · ${metricLabel(metric)}` : value;
      if (cross) {
        return cross.cells.map(cell => {
          const ids = new Set(cell.entityIds);
          const region = cross.rows.find(row => row.key === cell.regionKey)!, grade = cross.columns.find(column => column.key === cell.gradeKey)!;
          return { ...analyzeSeries(key(cell.key), label(`${region.label} / ${grade.label}`), sorted.map(snapshot => {
            const rows = snapshot.rows.filter(row => ids.has(row.id)); return { ...snapshot, rows, expectedCount: rows.length };
          }), metric, mode, budget), classificationSourceIds: cell.membershipSourceIds };
        });
      } else if (result.operation === 'group_aggregate' || result.operation === 'group_trend') {
      if (dimension !== 'submarket' && dimension !== 'grade') throw new Error('RESEARCH_GROUP_REQUIRED');
      const grouped = groupedQuarterAnalysis(sorted, sortedUniverse, dimension, metric, mode);
      return grouped.groups.map(group => {
        const ids = new Set(group.entityIds);
        return { ...analyzeSeries(key(group.key), label(group.label), sorted.map(snapshot => {
          const rows = snapshot.rows.filter(row => ids.has(row.id)); return { ...snapshot, rows, expectedCount: rows.length };
        }), metric, mode, budget), classificationSourceIds: group.sourceIds };
      });
    } else {
      const scope = sorted[0].queryScope?.submarkets;
      const scopeLabel = Array.isArray(scope) && scope.every(value => typeof value === 'string') ? scope.join('、') : '当前获权范围';
      return [analyzeSeries(key('scope'), label(scopeLabel), sorted, metric, mode, budget)];
    }
    });
    const candidate: ResearchAnalysis = { version: 'research-analysis/1', series: series.map(compactSeriesEvidence),
      findings: series.flatMap(item => seriesFindings(item).map(finding => ({ ...finding,
        sourceIds: unique([...finding.sourceIds, ...(item.classificationSourceIds ?? [])]),
        ...(metrics.length > 1 ? { evidence: { ...finding.evidence, metric: item.metric } } : {}) }))),
      resourceUsage: { status: series.some(item => item.anomalyCoverage?.complete === false) ? 'limited' : 'complete',
        observationCount, reason: null, limits: RESEARCH_ANALYSIS_LIMITS }, rules: [
      { id: 'exact_change/1', description: '使用未舍入有理数；租金/面积变化率=(期末−期初)÷期初×100%；空置率变化=(期末比例−期初比例)×100，单位为百分点。基期为零不计算相对变化率。' },
      { id: 'entity_qoq_rent_30_percent', description: '同楼、同指标、相邻季度有效净有效租金的绝对环比变化≥30%时提醒；是固定筛查阈值，不是错误判定或统计显著性结论。' },
      { id: 'entity_qoq_vacancy_10_pp', description: '同楼相邻季度有效空置率的绝对变化≥10个百分点时提醒；空置率沿用同楼同季面积口径。' },
      { id: 'iqr_1_5', description: '同组同季有效样本至少4栋，Type 7分位数；严格超出[Q1−1.5×IQR,Q3+1.5×IQR]才标记，异常仍参与统计。' },
      { id: 'sample_comparability/1', description: '各期样本与两期共同有效楼宇并列；趋势另保留全期间共同交集。进入/退出表示指标有效样本变化，不表示楼宇开业/退市。分类使用当前目录，无法重建历史市场全集。' },
      { id: 'research_evidence/1', description: '派生变化及所选模式的期间通过 sourceRefs 指向本组 perPeriod、commonSample 或 comparability 的明确索引，复用完整来源标识；分组分类证据见 classificationSourceIds。分析文字的依据按钮直接包含相应指标及分类记录。' },
      { id: 'research_resources/1', description: `补充分析最多 ${RESEARCH_ANALYSIS_LIMITS.observations} 个楼宇×季度观察、${RESEARCH_ANALYSIS_LIMITS.inputSourceReferences} 个输入来源引用、${RESEARCH_ANALYSIS_LIMITS.inputSourceCharacters} 个不同来源标识字符，补充输出最多 ${RESEARCH_ANALYSIS_LIMITS.outputBytes} 字节，合并结果最多 ${RESEARCH_ANALYSIS_LIMITS.combinedResultBytes} 字节；异常明细全结果最多 ${RESEARCH_ANALYSIS_LIMITS.anomalies} 条及 ${RESEARCH_ANALYSIS_LIMITS.anomalySourceReferences} 个证据引用。达到限额会明确标注检测或列举是否完整，保留原查询结果。` },
    ] };
    if (candidate.series.length > 400 || candidate.findings.length > 1000 || new TextEncoder().encode(JSON.stringify(candidate)).byteLength > RESEARCH_ANALYSIS_LIMITS.outputBytes)
      return skippedResearch(result, observationCount, 'output_limit');
    const combined = { ...result, parameters: { ...result.parameters, researchAnalysis: candidate } };
    // The existing encrypted archive limit is 16 MiB. Reserve at least 1 MiB for
    // the remaining execution metadata/envelope instead of failing a usable query.
    if (new TextEncoder().encode(JSON.stringify(combined)).byteLength > RESEARCH_ANALYSIS_LIMITS.combinedResultBytes)
      return skippedResearch(result, observationCount, 'output_limit');
    const research = researchAnalysisSchema.parse(candidate);
    const allowed = new Set(result.sources.map(source => source.id));
    const referenced = research.series.flatMap(item => [
      ...(item.classificationSourceIds ?? []),
      ...item.perPeriod.flatMap(period => period.sourceIds), ...item.commonSample.flatMap(period => period.sourceIds),
      ...item.anomalies.flatMap(anomaly => anomaly.sourceIds), ...item.comparability.flatMap(comparison => comparison.sourceIds),
    ]).concat(research.findings.flatMap(finding => finding.sourceIds));
    if (referenced.some(id => !allowed.has(id))) throw new Error('RESEARCH_SOURCE_BINDING_MISMATCH');
    return freeze({ ...result, parameters: { ...result.parameters, researchAnalysis: research } });
  } catch (error) {
    if (error instanceof Error && ['QUERY_SCOPE_REQUIRES_BACKGROUND_JOB', 'NUMERIC_PROJECTION_OVERFLOW'].includes(error.message))
      return skippedResearch(result, observationCount, 'exact_calculation_limit');
    throw error;
  }
}
