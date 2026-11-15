import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aggregateQuarter, compareQuarters, rankBuildings, trendQuarters } from './analytics';
import { assertComplete, quarterKey, type FactSnapshot, type NumericOutput, type SourceRef } from './contracts';
import { assertFieldContext, getFact } from './facts';
import { FIELD_REGISTRY_VERSION, numericFields, type NumericField } from './registry';
import { DIMENSION_REGISTRY_VERSION, catalogDimensions, type CatalogDimension } from './registry';
import { groupedQuarterAnalysis } from './grouping';
import { crossTabQuarter, crossTabTrend } from './crossTab';
import { buildingDistribution, distributionFields, distributionLabel, type DistributionMeasure } from './distribution';
import { rentVacancyRelationship } from './relationship';
import { relativeQuarterContextSchema, relativeQuarterNotice, type RelativeQuarterContext } from './relativeQuarter';
import type { QueryPlan } from './plan';

const BROCHURE_LIMITATION = '楼书记录尚未确定有效版本优先级；不同值按冲突处理，相同值也不能据此确认当前现实状态。';

export type ResultCell =
  | { kind: 'text'; value: string; sourceIds: readonly string[] }
  | { kind: 'number'; value: NumericOutput; sourceIds: readonly string[] }
  | { kind: 'unknown'; state: 'missing' | 'invalid' | 'conflict' | 'unverified'; reason: string; sourceIds: readonly string[] };
export type ResultTable = {
  id: string;
  columns: readonly { key: string; label: string; unit: string | null }[];
  rows: readonly { entityId: string; cells: Readonly<Record<string, ResultCell>> }[];
};
export type QueryAnalysis = ReturnType<typeof rankBuildings> | ReturnType<typeof aggregateQuarter> | ReturnType<typeof compareQuarters> | ReturnType<typeof trendQuarters> | ReturnType<typeof groupedQuarterAnalysis> | ReturnType<typeof crossTabQuarter> | ReturnType<typeof crossTabTrend> | ReturnType<typeof rentVacancyRelationship> | ReturnType<typeof buildingDistribution> | null;
export type MultiMetricAnalysis = Readonly<{ version: 'multi-metric/1'; results: readonly {
  metric: 'rent' | 'vacancy' | 'totalArea'; analysis: QueryAnalysis;
}[] }>;
export type QueryResult = Readonly<{
  resultId: string;
  createdAt: string;
  snapshotId: string;
  dataVersion: string;
  scopeFingerprint: string;
  registryVersion: string;
  operation: 'list' | 'rank' | 'aggregate' | 'compare' | 'trend' | 'group_aggregate' | 'group_trend' | 'cross_aggregate' | 'cross_trend' | 'relationship' | 'distribution';
  parameters: Readonly<Record<string, unknown>>;
  table: ResultTable;
  analysis: QueryAnalysis | MultiMetricAnalysis;
  sources: readonly SourceRef[];
  limitations: readonly string[];
}>;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function collectSources(snapshot: FactSnapshot, fields: readonly NumericField[]): SourceRef[] {
  const sources = new Map<string, SourceRef>();
  const add = (source: SourceRef) => {
    const prior = sources.get(source.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(source)) throw new Error('SOURCE_ID_COLLISION');
    sources.set(source.id, structuredClone(source));
  };
  for (const row of snapshot.rows) add(row.nameSource);
  for (const row of snapshot.rows) for (const field of fields) for (const source of getFact(row, field).sources) {
    if (source.entityId !== row.id) throw new Error('SOURCE_BINDING_MISMATCH');
    add(source);
  }
  return [...sources.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function envelope(snapshot: FactSnapshot, content: Pick<QueryResult, 'operation' | 'parameters' | 'table' | 'analysis'>, fields: readonly NumericField[]): QueryResult {
  const sources = collectSources(snapshot, fields);
  return deepFreeze({
    resultId: randomUUID(), createdAt: new Date().toISOString(), snapshotId: snapshot.snapshotId,
    dataVersion: snapshot.dataVersion, scopeFingerprint: snapshot.scopeFingerprint,
    registryVersion: FIELD_REGISTRY_VERSION, ...content, parameters: { ...content.parameters, scope: structuredClone(snapshot.queryScope ?? {}) }, sources,
    limitations: [
      '仅反映当前获权数据库样本，不代表现实市场全集。',
      ...(snapshot.queryScope?.inventoryTime === 'current_catalog' ? ['候选楼宇按当前目录确定；历史季度指标不代表当时的历史楼宇全集。'] : []),
      ...(snapshot.queryScope?.brochureSelection === 'all_unresolved_record_candidates' && fields.some(field => numericFields[field].temporal === 'source')
        ? [BROCHURE_LIMITATION] : []),
      ...(sources.some(source => source.verification === 'database_only') ? ['部分数据仅关联数据库记录，原始资料尚未关联。'] : []),
      ...(sources.some(source => source.verification === 'historical') ? ['包含历史来源，不能据此确认当前有效性。'] : []),
    ],
  });
}

export function buildListResult(snapshot: FactSnapshot, fields: readonly NumericField[], includeVacancy = false): QueryResult {
  assertComplete(snapshot);
  if (fields.length > 6 || new Set(fields).size !== fields.length || fields.some(field => !Object.hasOwn(numericFields, field))) throw new Error('INVALID_QUERY_FIELDS');
  assertFieldContext(snapshot, fields);
  const vacancy = includeVacancy && fields.includes('totalArea') && fields.includes('vacantArea');
  return envelope(snapshot, {
    operation: 'list', parameters: { fields: [...fields], period: snapshot.period }, analysis: null,
    table: {
      id: 'buildings', columns: [{ key: 'name', label: '楼宇', unit: null }, ...fields.map(field => ({ key: field, label: numericFields[field].label, unit: numericFields[field].unit })), ...(vacancy ? [{ key: 'vacancy', label: '楼宇空置率', unit: 'ratio' }] : [])],
      rows: snapshot.rows.map(row => {
        const cells: Record<string, ResultCell> = { name: { kind: 'text', value: row.name, sourceIds: [row.nameSource.id] } };
        for (const field of fields) {
          const fact = getFact(row, field);
          const sourceIds = fact.sources.map(source => source.id);
          cells[field] = fact.state === 'valid'
            ? { kind: 'number', value: { exact: fact.value.exact(), numeric: fact.value.toNumber() }, sourceIds }
            : { kind: 'unknown', state: fact.state, reason: fact.reason, sourceIds };
        }
        if (vacancy) {
          const analysis = aggregateQuarter({ ...snapshot, rows: [row], expectedCount: 1 }, 'vacancy');
          const sourceIds = [...new Set([...analysis.contributions.flatMap(item => item.sourceIds), ...analysis.excluded.flatMap(item => item.sourceIds)])];
          const excluded = analysis.excluded[0];
          cells.vacancy = analysis.value ? { kind: 'number', value: analysis.value, sourceIds }
            : { kind: 'unknown', state: excluded?.state ?? 'missing', reason: excluded?.reason ?? 'no_valid_sample', sourceIds };
        }
        return { entityId: row.id, cells };
      }),
    },
  }, fields);
}

export function buildRankResult(snapshot: FactSnapshot, field: NumericField, limit: number, direction: 'asc' | 'desc'): QueryResult {
  const analysis = rankBuildings(snapshot, field, limit, direction);
  return envelope(snapshot, {
    operation: 'rank', parameters: { field, limit, direction, period: snapshot.period }, analysis,
    table: {
      id: 'ranking', columns: [{ key: 'name', label: '楼宇', unit: null }, { key: field, label: numericFields[field].label, unit: numericFields[field].unit }],
      rows: analysis.rows.map(row => ({ entityId: row.entityId, cells: {
        name: { kind: 'text', value: row.name, sourceIds: [snapshot.rows.find(entity => entity.id === row.entityId)!.nameSource.id] }, [field]: { kind: 'number', value: row.value, sourceIds: row.sourceIds },
      } })),
    },
  }, [field]);
}

export function buildAggregateResult(snapshot: FactSnapshot, metric: Parameters<typeof aggregateQuarter>[1]): QueryResult {
  const analysis = aggregateQuarter(snapshot, metric);
  const fields: NumericField[] = metric === 'rent' ? ['totalArea', 'netEffectiveRent'] : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea'];
  return envelope(snapshot, {
    operation: 'aggregate', parameters: { metric, period: snapshot.period }, analysis,
    table: {
      id: 'aggregate', columns: [{ key: 'value', label: metric === 'rent' ? '面积加权净有效租金' : metric === 'vacancy' ? '空置率' : '总面积', unit: analysis.unit }],
      rows: [{ entityId: 'aggregate', cells: { value: analysis.value
        ? { kind: 'number', value: analysis.value, sourceIds: analysis.contributions.flatMap(row => row.sourceIds) }
        : { kind: 'unknown', state: 'missing', reason: 'no_valid_sample', sourceIds: [] } } }],
    },
  }, fields);
}

export function buildDistributionResult(snapshot: FactSnapshot, measure: DistributionMeasure): QueryResult {
  const analysis=buildingDistribution(snapshot,measure);
  const result=envelope(snapshot,{operation:'distribution',parameters:{measure,period:snapshot.period,formulaVersion:analysis.version},analysis,
    table:{id:'distribution_observations',columns:[{key:'name',label:'楼宇',unit:null},{key:'value',label:distributionLabel(measure),unit:analysis.unit},{key:'bin',label:'所属区间',unit:null},{key:'outlier',label:'离群标记',unit:null}],
      rows:analysis.observations.map((o,i)=>({entityId:o.entityId,cells:{
        name:{kind:'text',value:o.name,sourceIds:[snapshot.rows[i].nameSource.id]},
        value:o.value?{kind:'number',value:o.value,sourceIds:o.sourceIds}:{kind:'unknown',state:o.state==='valid'?'missing':o.state,reason:o.reason??'no_valid_sample',sourceIds:o.sourceIds},
        bin:{kind:'text',value:o.bin===null?'未参与':`区间 ${o.bin+1}`,sourceIds:o.sourceIds},
        outlier:{kind:'text',value:o.value===null?'未参与':o.outlier===null?'样本不足4栋，未判定':o.outlier?'超出1.5×IQR围栏，保留':'围栏内',sourceIds:o.sourceIds},
      }}))}},distributionFields(measure));
  return deepFreeze({...result,limitations:[...result.limitations,
    '逐楼等权分布，分位采用Type 7线性插值；简单平均不替代市场租金面积加权口径。',
    '等宽分箱数为ceil(log2(n)+1)，最多20箱；左闭右开，最后一箱含上界，常量仅一箱。区间用未舍入值判断。',
    '少于4栋不判定离群；其余按Q1−1.5×IQR与Q3+1.5×IQR标记，异常值保留，不等于数据错误。',
    '小样本和缺失可能影响分布，不能据此推断整个现实市场；所有统计只使用本次有效记录。',
  ]});
}

export function buildRelationshipResult(snapshot: FactSnapshot): QueryResult {
  const analysis = rentVacancyRelationship(snapshot);
  const metricCell = (metric: ReturnType<typeof aggregateQuarter>): ResultCell => {
    const sourceIds = [...new Set([...metric.contributions.flatMap(row => row.sourceIds), ...metric.excluded.flatMap(row => row.sourceIds)])];
    const c = metric.coverage;
    return metric.value ? { kind: 'number', value: metric.value, sourceIds } : { kind: 'unknown', state: c.conflict ? 'conflict' : c.invalid ? 'invalid' : c.unverified ? 'unverified' : 'missing', reason: metric.excluded[0]?.reason ?? 'no_valid_sample', sourceIds };
  };
  const result = envelope(snapshot, { operation: 'relationship', parameters: { period: snapshot.period, formulaVersion: analysis.version, weighting: analysis.weighting }, analysis,
    table: { id: 'rent_vacancy_relationship', columns: [
      { key: 'name', label: '楼宇', unit: null }, { key: 'rent', label: '净有效租金', unit: 'CNY/m2/month' },
      { key: 'vacancy', label: '楼宇空置率', unit: 'ratio' }, { key: 'joint', label: '联合样本', unit: null },
    ], rows: analysis.rows.map((row, i) => {
      const rent = metricCell(row.rent), vacancy = metricCell(row.vacancy);
      return { entityId: row.entityId, cells: { name: { kind: 'text', value: snapshot.rows[i].name, sourceIds: [snapshot.rows[i].nameSource.id] }, rent, vacancy,
        joint: { kind: 'text', value: row.jointValid ? '参与' : '不参与：至少一项缺失、无效、冲突或未核验', sourceIds: [...new Set([...rent.sourceIds, ...vacancy.sourceIds])] } } };
    }) } }, ['totalArea', 'netEffectiveRent', 'vacantArea']);
  return deepFreeze({ ...result, limitations: [...result.limitations,
    '每栋楼为一个等权观察值，空置率由同栋同季有效空置面积除总面积；租金和空置率均沿用现有有效性规则。',
    'Pearson系数只描述联合有效样本的线性关系，按6位小数近似；不足3栋或变量恒定时不计算。',
    '未作显著性检验；小样本、异常值与样本选择可能显著影响结果，不代表现实市场，不推断因果或预测。',
  ] });
}

export function buildCrossTabResult(selected: FactSnapshot, universe: FactSnapshot, metric: Parameters<typeof aggregateQuarter>[1]): QueryResult {
  const analysis = crossTabQuarter(selected, universe, metric);
  const fields: NumericField[] = metric === 'rent' ? ['totalArea', 'netEffectiveRent'] : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea'];
  const unit = metric === 'rent' ? 'CNY/m2/month' : metric === 'vacancy' ? 'ratio' : 'm2';
  const count = (n: number, sourceIds: readonly string[]): ResultCell => ({ kind: 'number', value: { exact: { numerator: String(n), denominator: '1' }, numeric: n }, sourceIds });
  const result = envelope(universe, { operation: 'cross_aggregate', analysis,
    parameters: { metric, period: universe.period, dimensionVersion: DIMENSION_REGISTRY_VERSION, tableVersion: 'cross-quarter/1',
      rowDimension: 'submarket', columnDimension: 'grade', rowGroups: analysis.rows, columnGroups: analysis.columns },
    table: { id: 'cross_quarters', columns: [
      { key: 'name', label: '子市场', unit: null }, { key: 'grade', label: '等级', unit: null },
      { key: 'value', label: metric === 'rent' ? '面积加权净有效租金' : metric === 'vacancy' ? '空置率' : '总面积', unit },
      { key: 'usedCount', label: '有效样本', unit: 'building_count' },
      { key: 'denominator', label: metric === 'totalArea' ? '样本分母' : '有效面积分母', unit: metric === 'totalArea' ? 'building_count' : 'm2' },
      { key: 'coverage', label: '候选覆盖', unit: null },
    ], rows: analysis.cells.map(cell => {
      const row = analysis.rows.find(r => r.key === cell.regionKey)!, column = analysis.columns.find(c => c.key === cell.gradeKey)!;
      const a = cell.analysis, c = a.coverage;
      const sourceIds = [...new Set([...cell.membershipSourceIds, ...a.contributions.flatMap(c => c.sourceIds), ...a.excluded.flatMap(e => e.sourceIds)])];
      return { entityId: cell.key, cells: {
        name: { kind: 'text', value: row.label, sourceIds: row.sourceIds }, grade: { kind: 'text', value: column.label, sourceIds: column.sourceIds },
        value: a.value ? { kind: 'number', value: a.value, sourceIds } : { kind: 'unknown', state: c.conflict ? 'conflict' : c.invalid ? 'invalid' : c.unverified ? 'unverified' : 'missing', reason: 'no_valid_sample', sourceIds },
        usedCount: count(c.valid, sourceIds), denominator: { kind: 'number', value: a.denominator, sourceIds },
        coverage: { kind: 'text', value: `候选 ${c.total}；缺失 ${c.missing}、无效 ${c.invalid}、冲突 ${c.conflict}、未核验 ${c.unverified}`, sourceIds },
      } };
    }) } }, fields);
  return deepFreeze({ ...result, sources: mergeSources([result.sources, analysis.membershipSources]), limitations: [...result.limitations,
    '按当前目录子市场与等级交叉，不代表历史季度分类；未填写分类单列未知。',
    '每格独立使用有效样本与分母；空组合或没有有效样本的指标未知，不是零。不对格均值再次平均，不相加空置率。',
    '颜色仅帮助比较数值，不代表推荐、风险或因果关系；单楼小样本不能代表整个类别。',
  ] });
}

function mergeSources(groups: readonly (readonly SourceRef[])[]): SourceRef[] {
  const sources = new Map<string, SourceRef>();
  for (const group of groups) for (const source of group) {
    const previous = sources.get(source.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(source)) throw new Error('SOURCE_ID_COLLISION');
    sources.set(source.id, structuredClone(source));
  }
  return [...sources.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function buildCrossTrendResult(selected: readonly FactSnapshot[], universe: readonly FactSnapshot[],
  metric: Parameters<typeof trendQuarters>[1], mode: 'per_period' | 'paired', metricCount = 1): QueryResult {
  const analysis = crossTabTrend(selected, universe, metric, mode, metricCount);
  const fields: NumericField[] = metric === 'rent' ? ['totalArea', 'netEffectiveRent'] : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea'];
  const unit = metric === 'rent' ? 'CNY/m2/month' : metric === 'vacancy' ? 'ratio' : 'm2';
  const sources = mergeSources([...universe.map(snapshot => collectSources(snapshot, fields)), analysis.membershipSources]);
  const count = (n: number, sourceIds: readonly string[]): ResultCell => ({ kind: 'number', value: { exact: { numerator: String(n), denominator: '1' }, numeric: n }, sourceIds });
  const result = envelope(universe.at(-1)!, { operation: 'cross_trend', analysis,
    parameters: { metric, mode, start: selected[0].period, end: selected.at(-1)!.period,
      dimensionVersion: DIMENSION_REGISTRY_VERSION, tableVersion: 'cross-trend/1',
      rowDimension: 'submarket', columnDimension: 'grade', rowGroups: analysis.rows, columnGroups: analysis.columns },
    table: { id: 'cross_trend', columns: [
      { key: 'name', label: '子市场', unit: null }, { key: 'grade', label: '等级', unit: null }, { key: 'period', label: '季度', unit: null },
      { key: 'value', label: metric === 'rent' ? '面积加权净有效租金' : metric === 'vacancy' ? '空置率' : '总面积', unit },
      { key: 'usedCount', label: '实际参与', unit: 'building_count' }, { key: 'availableCount', label: '有效样本', unit: 'building_count' },
      { key: 'denominator', label: metric === 'totalArea' ? '样本分母' : '有效面积分母', unit: metric === 'totalArea' ? 'building_count' : 'm2' },
      { key: 'coverage', label: '候选覆盖', unit: null },
    ], rows: analysis.cells.flatMap(cell => {
      const region = analysis.rows.find(row => row.key === cell.regionKey)!, grade = analysis.columns.find(column => column.key === cell.gradeKey)!;
      const ids = new Set(cell.entityIds);
      return cell.analysis.periods.map((period, index) => {
        const all = [...new Set([...cell.membershipSourceIds, ...universe[index].rows.filter(row => ids.has(row.id))
          .flatMap(row => [row.nameSource.id, ...fields.flatMap(field => getFact(row, field).sources.map(source => source.id))])])];
        const used = [...new Set([...period.sourceIds, ...cell.membershipSourceIds])], coverage = period.availableCoverage;
        return { entityId: `${cell.key}/${quarterKey(period.period)}`, cells: {
          name: { kind: 'text', value: region.label, sourceIds: region.sourceIds }, grade: { kind: 'text', value: grade.label, sourceIds: grade.sourceIds },
          period: { kind: 'text', value: quarterKey(period.period), sourceIds: [] },
          value: period.value ? { kind: 'number', value: period.value, sourceIds: used } : {
            kind: 'unknown', state: coverage.conflict ? 'conflict' : coverage.invalid ? 'invalid' : coverage.unverified ? 'unverified' : 'missing',
            reason: mode === 'paired' ? 'no_common_valid_sample' : 'no_valid_sample', sourceIds: all },
          usedCount: count(period.usedEntityIds.length, used), availableCount: count(coverage.valid, all),
          denominator: { kind: 'number', value: period.denominator, sourceIds: used },
          coverage: { kind: 'text', value: `候选 ${coverage.total}；缺失 ${coverage.missing}、无效 ${coverage.invalid}、冲突 ${coverage.conflict}、未核验 ${coverage.unverified}`, sourceIds: all },
        } };
      });
    }) },
  }, fields);
  return deepFreeze({ ...result, sources, limitations: [...result.limitations,
    '按当前目录子市场与等级交叉查看各季度，不代表历史季度分类或当时市场全集；未填写分类单列未知。',
    '每格独立计算指标与分母，不能对格均值再次平均或相加空置率；小样本不能代表整个类别。',
    mode === 'paired' ? '每格分别使用全部查询季度的共同有效楼宇交集；不同格、不同指标不共用同一批楼宇。' : '每格各期独立使用有效样本；样本结构变化可能影响趋势，不据此推断市场原因。',
    '空组合与缺期保留未知，不跨期补值或填零。',
  ] });
}

export function buildCompareResult(base: FactSnapshot, current: FactSnapshot, metric: Parameters<typeof compareQuarters>[2], mode: 'per_period' | 'paired'): QueryResult {
  if (base.dataVersion !== current.dataVersion) throw new Error('SNAPSHOT_VERSION_MISMATCH');
  const analysis = compareQuarters(base, current, metric, mode);
  const fields: NumericField[] = metric === 'rent' ? ['totalArea', 'netEffectiveRent'] : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea'];
  const unit = metric === 'rent' ? 'CNY/m2/month' : metric === 'vacancy' ? 'ratio' : 'm2';
  const allUsed = [...new Set([...analysis.base.sourceIds, ...analysis.current.sourceIds])].sort();
  const cell = (value: NumericOutput | null, sourceIds: readonly string[], reason = 'no_valid_sample'): ResultCell => value
    ? { kind: 'number', value, sourceIds }
    : { kind: 'unknown', state: 'missing', reason, sourceIds };
  const result = envelope(current, {
    operation: 'compare', parameters: { tableVersion: 'comparison-table/2', metric, mode, base: base.period, current: current.period, baseSnapshotId: base.snapshotId, currentSnapshotId: current.snapshotId }, analysis,
    table: {
      id: 'comparison', columns: [
        { key: 'base', label: quarterKey(base.period!), unit }, { key: 'current', label: quarterKey(current.period!), unit },
        { key: 'difference', label: '数值差', unit: metric === 'vacancy' ? 'percentage_point' : unit }, { key: 'change', label: '变化', unit: analysis.changeUnit },
      ],
      rows: [{ entityId: 'aggregate', cells: {
        base: cell(analysis.base.value, analysis.base.sourceIds), current: cell(analysis.current.value, analysis.current.sourceIds),
        difference: cell(metric === 'vacancy' ? analysis.change : analysis.difference, allUsed), change: cell(analysis.change, allUsed, analysis.unavailableReason ?? 'no_valid_sample'),
      } }],
    },
  }, fields);
  return deepFreeze({ ...result, sources: mergeSources([collectSources(base, fields), result.sources]) });
}

export function buildTrendResult(snapshots: readonly FactSnapshot[], metric: Parameters<typeof trendQuarters>[1], mode: 'per_period'|'paired'): QueryResult {
  const analysis=trendQuarters(snapshots,metric,mode);
  const fields:NumericField[]=metric==='rent'?['totalArea','netEffectiveRent']:metric==='vacancy'?['totalArea','vacantArea']:['totalArea'];
  const unit=metric==='rent'?'CNY/m2/month':metric==='vacancy'?'ratio':'m2';
  const sources=mergeSources(snapshots.map(s=>collectSources(s,fields)));
  const count=(n:number,sourceIds:readonly string[]):ResultCell=>({kind:'number',value:{exact:{numerator:String(n),denominator:'1'},numeric:n},sourceIds});
  const result=envelope(snapshots.at(-1)!,{operation:'trend',parameters:{metric,mode,start:snapshots[0].period,end:snapshots.at(-1)!.period,tableVersion:'quarter-trend/1'},analysis,
    table:{id:'quarter_trend',columns:[{key:'period',label:'季度',unit:null},{key:'value',label:metric==='rent'?'面积加权净有效租金':metric==='vacancy'?'空置率':'总面积',unit},
      {key:'usedCount',label:'实际参与',unit:'building_count'},{key:'availableCount',label:'有效样本',unit:'building_count'},
      {key:'denominator',label:metric==='totalArea'?'样本分母':'有效面积分母',unit:metric==='totalArea'?'building_count':'m2'},
      {key:'coverage',label:'候选覆盖',unit:null}],
      rows:analysis.periods.map((p,i)=>{const all=collectSources(snapshots[i],fields).map(s=>s.id),c=p.availableCoverage;
        return {entityId:quarterKey(p.period),cells:{period:{kind:'text',value:quarterKey(p.period),sourceIds:[]},
          value:p.value?{kind:'number',value:p.value,sourceIds:p.sourceIds}:{kind:'unknown',state:'missing',reason:mode==='paired'?'no_common_valid_sample':'no_valid_sample',sourceIds:all},
          usedCount:count(p.usedEntityIds.length,p.sourceIds),availableCount:count(c.valid,all),denominator:{kind:'number',value:p.denominator,sourceIds:p.sourceIds},
          coverage:{kind:'text',value:`候选 ${c.total}；缺失 ${c.missing}、无效 ${c.invalid}、冲突 ${c.conflict}、未核验 ${c.unverified}`,sourceIds:all}}};})}},fields);
  return deepFreeze({...result,sources,limitations:[...result.limitations,'时间范围逐季连续展开；没有有效值的季度保留未知，不跨期补值或填零。',
    mode==='paired'?'共同样本是全部查询季度中均满足条件且指标有效的楼宇交集；任一期全缺会使共同样本为空。':'各期分别使用当期有效样本，样本变化可能影响趋势，不据此解释市场原因。']});
}

export function buildGroupedResult(selected: readonly FactSnapshot[], universe: readonly FactSnapshot[], dimension: CatalogDimension,
  metric: Parameters<typeof trendQuarters>[1], mode: 'per_period' | 'paired'): QueryResult {
  const analysis = groupedQuarterAnalysis(selected, universe, dimension, metric, mode);
  const fields: NumericField[] = metric === 'rent' ? ['totalArea', 'netEffectiveRent'] : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea'];
  const unit = metric === 'rent' ? 'CNY/m2/month' : metric === 'vacancy' ? 'ratio' : 'm2';
  const sources = mergeSources([...universe.map(s => collectSources(s, fields)), analysis.membershipSources]);
  const count = (n: number, sourceIds: readonly string[]): ResultCell => ({ kind: 'number', value: { exact: { numerator: String(n), denominator: '1' }, numeric: n }, sourceIds });
  const trend = selected.length > 1;
  const result = envelope(universe.at(-1)!, { operation: trend ? 'group_trend' : 'group_aggregate',
    parameters: { metric, mode, groupBy: dimension, dimensionVersion: DIMENSION_REGISTRY_VERSION, tableVersion: 'grouped-quarter/1',
      ...(trend ? { start: selected[0].period, end: selected.at(-1)!.period } : { period: selected[0].period }),
      groups: analysis.groups.map(g => ({ key: g.key, value: g.value, label: g.label })) }, analysis,
    table: { id: 'grouped_quarters', columns: [
      { key: 'name', label: catalogDimensions[dimension].label, unit: null }, { key: 'period', label: '季度', unit: null },
      { key: 'value', label: metric === 'rent' ? '面积加权净有效租金' : metric === 'vacancy' ? '空置率' : '总面积', unit },
      { key: 'usedCount', label: '实际参与', unit: 'building_count' }, { key: 'availableCount', label: '有效样本', unit: 'building_count' },
      { key: 'denominator', label: metric === 'totalArea' ? '样本分母' : '有效面积分母', unit: metric === 'totalArea' ? 'building_count' : 'm2' },
      { key: 'coverage', label: '候选覆盖', unit: null },
    ], rows: analysis.groups.flatMap(group => group.analysis.periods.map((p, i) => {
      const ids = new Set(group.entityIds), all = [...group.sourceIds, ...universe[i].rows.filter(row => ids.has(row.id)).flatMap(row => [row.nameSource.id, ...fields.flatMap(field => getFact(row, field).sources.map(s => s.id))])];
      const used = [...new Set([...p.sourceIds, ...group.sourceIds])], coverage = p.availableCoverage;
      return { entityId: `${group.key}/${quarterKey(p.period)}`, cells: {
        name: { kind: 'text', value: group.label, sourceIds: group.sourceIds }, period: { kind: 'text', value: quarterKey(p.period), sourceIds: [] },
        value: p.value ? { kind: 'number', value: p.value, sourceIds: used } : { kind: 'unknown', state: 'missing', reason: mode === 'paired' ? 'no_common_valid_sample' : 'no_valid_sample', sourceIds: [...new Set(all)] },
        usedCount: count(p.usedEntityIds.length, used), availableCount: count(coverage.valid, [...new Set(all)]),
        denominator: { kind: 'number', value: p.denominator, sourceIds: used },
        coverage: { kind: 'text', value: `候选 ${coverage.total}；缺失 ${coverage.missing}、无效 ${coverage.invalid}、冲突 ${coverage.conflict}、未核验 ${coverage.unverified}`, sourceIds: [...new Set(all)] },
      } };
    })) },
  }, fields);
  return deepFreeze({ ...result, sources, limitations: [...result.limitations,
    `按当前目录的${catalogDimensions[dimension].label}分组，不代表历史季度的分类；未填写的分类单列未知。`,
    '空组或无有效样本的指标未知，不是零；当前获权样本不代表该区域或等级的现实全集。',
    ...(trend ? [mode === 'paired' ? '每组分别取全部查询季度的共同有效楼宇交集；不是跨区域取同一批楼宇。' : '每组各期独立取有效样本；样本变化可能影响趋势，不推断市场原因。', '缺期保留未知，不跨期补值。'] : []),
  ] });
}

/** Record the executor's validated conditions in the existing immutable result,
 * including structured requests that do not pass through semantic metadata. */
export function attachExecutedPlan(result: QueryResult, plan: QueryPlan): QueryResult {
  return deepFreeze({ ...result, parameters: { ...result.parameters, executedPlan: structuredClone(plan) } });
}

/** Trusted executor adds the complete authorized filter decision trail, including
 * unknown candidates, without allowing a second query to change result values. */
export function attachFilterEvidence(result: QueryResult, evidence: readonly { snapshot: FactSnapshot; fields: readonly NumericField[]; decisions: readonly { entityId: string; state: 'true' | 'false' | 'unknown' }[] }[]): QueryResult {
  for (const item of evidence) {
    assertComplete(item.snapshot);
    assertFieldContext(item.snapshot, item.fields);
    if (item.snapshot.dataVersion !== result.dataVersion || item.snapshot.scopeFingerprint !== result.scopeFingerprint) throw new Error('FILTER_SNAPSHOT_MISMATCH');
    const ids = new Set(item.snapshot.rows.map(row => row.id));
    if (item.decisions.length !== ids.size || new Set(item.decisions.map(row => row.entityId)).size !== ids.size
      || item.decisions.some(row => !ids.has(row.entityId) || !['true', 'false', 'unknown'].includes(row.state))) throw new Error('FILTER_DECISION_INCOMPLETE');
  }
  return deepFreeze({ ...result,
    parameters: { ...result.parameters, filterEvaluation: evidence.map(item => ({
      snapshotId: item.snapshot.snapshotId, period: item.snapshot.period, fields: [...item.fields],
      total: item.snapshot.expectedCount, matched: item.decisions.filter(row => row.state === 'true').length,
      notMatched: item.decisions.filter(row => row.state === 'false').length, unknown: item.decisions.filter(row => row.state === 'unknown').length,
      decisions: structuredClone(item.decisions),
    })) },
    sources: mergeSources([result.sources, ...evidence.map(item => collectSources(item.snapshot, item.fields))]),
    limitations: [...new Set([
      ...result.limitations,
      ...(evidence.some(item => item.snapshot.queryScope?.brochureSelection === 'all_unresolved_record_candidates'
        && item.fields.some(field => numericFields[field].temporal === 'source')) ? [BROCHURE_LIMITATION] : []),
      '筛选缺值或冲突单列为未知，仅明确满足条件的楼宇参与结果；跨期筛选逐期执行，再按比较模式取样。',
    ])],
  });
}

/** Integrity digest is a comparison aid, not an authorization token or tamper-proof audit seal. */
export function resultDigest(result: QueryResult): string {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

export type ChartBinding = { resultId: string; tableId: string; kind: 'bar' | 'line' | 'scatter'; x: string; y: string };

/** No chart-supplied numbers. Every mark references a table cell in this result. */
export function bindChart(result: QueryResult, binding: ChartBinding) {
  binding = z.strictObject({ resultId: z.uuid(), tableId: z.string(), kind: z.enum(['bar', 'line', 'scatter']), x: z.string(), y: z.string() }).parse(binding);
  if (binding.resultId !== result.resultId || binding.tableId !== result.table.id) throw new Error('RESULT_BINDING_MISMATCH');
  if (!['bar', 'line', 'scatter'].includes(binding.kind)) throw new Error('UNSUPPORTED_CHART');
  const xColumn = result.table.columns.find(column => column.key === binding.x);
  const yColumn = result.table.columns.find(column => column.key === binding.y);
  if (!xColumn || !yColumn) throw new Error('UNKNOWN_CHART_COLUMN');
  if (binding.kind === 'line') throw new Error('TIME_AXIS_REQUIRED'); // Enabled with the trend result adapter, not categorical building rows.
  return deepFreeze({
    ...binding, xUnit: xColumn.unit, yUnit: yColumn.unit, connectNulls: false,
    points: result.table.rows.map(row => {
      const x = row.cells[binding.x], y = row.cells[binding.y];
      if (y.kind === 'text' || (binding.kind === 'scatter' && x.kind === 'text')) throw new Error('NUMERIC_AXIS_REQUIRED');
      return {
        entityId: row.entityId,
        x: x.kind === 'unknown' ? null : x.kind === 'number' ? x.value.numeric : x.value,
        y: y.kind === 'number' ? y.value.numeric : null,
        state: y.kind === 'unknown' ? y.state : x.kind === 'unknown' ? x.state : 'valid',
        cells: { x: binding.x, y: binding.y },
      };
    }),
    limitations: result.limitations,
  });
}

/** Attach server-resolved calendar semantics before auditing or delivering the result. */
export function attachRelativeQuarterContext(result: QueryResult, context: RelativeQuarterContext): QueryResult {
  const parsed = relativeQuarterContextSchema.parse(context);
  return deepFreeze({ ...result, parameters: { ...result.parameters, timeResolution: parsed },
    limitations: [...result.limitations, relativeQuarterNotice(parsed)] });
}
