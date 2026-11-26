import { createHash } from 'node:crypto';
import { normalizeMapSubmarket } from '@/src/app/map/model/marketIdentity';
import { quarterSchema } from '@/src/lib/intelligence/query/contracts';
import type { QueryResult } from '@/src/lib/intelligence/query/result';
import type { PitchScope } from '../contracts/content';
import type { BusinessDataBinding, PitchContextSnapshot, ProposalBrief, VisualAssetReference } from '../integration-contracts';
import { resultSummary, resultViewSchema, units } from '@/src/lib/intelligence/query/presentation';
import { periodEnd } from './page-content';
import type { BoundBuilding, Distribution, Evidence, Field, Market, Metrics, Period, ProposalData } from './projection';

// This is the consumed portion of Agent 01's unified-pitch-context/1 protocol.
// Its reader stays upstream and is structurally assignable to this interface.
type UnifiedValue = {
  value: string | number | readonly string[] | null;
  unit: string | null;
  state: string;
  permission: string;
  disclosure: string;
};
type UnifiedResult = {
  id: string;
  entityId: string;
  binding: { domain: string; dataVersion: string; disclosure: string };
  result: QueryResult;
};
export interface UnifiedProposalContext {
  protocol: 'unified-pitch-context/1';
  request: { city: string; submarkets: readonly string[]; start?: Period };
  period: Period | null;
  disclosure: 'internal';
  isTestData: false;
  capturedAt: string;
  fingerprint: string;
  bindings: readonly BusinessDataBinding[];
  buildings: readonly { buildingId: string; name: string; static: Readonly<Record<string, UnifiedValue>>; quarter: Readonly<Record<string, UnifiedValue>> }[];
  results: readonly UnifiedResult[];
}
export type ProposalMaterials = Pick<ProposalData, 'maps' | 'customerBrief' | 'scoreWeights' | 'team' | 'case' | 'contact'> & {
  visuals?: readonly VisualAssetReference[];
  buildingMedia?: Readonly<Record<string, Pick<BoundBuilding, 'photos' | 'stackingPlan'>>>;
  spotlight?: Market['spotlight'];
  outlook?: Market['outlook'];
};

const metricColumns = { rent: 'netEffectiveRent', vacancy: 'vacancyRate', totalArea: 'trackedArea' } as const;
const resultMetric = (item: UnifiedResult) => Object.hasOwn(metricColumns, String(item.result.parameters.metric))
  ? metricColumns[item.result.parameters.metric as keyof typeof metricColumns] : undefined;
const quarterKey = (quarter: Period) => `${quarter.year}-Q${quarter.quarter}`;
const cityName = (city: string) => city.trim().replace(/市$/, '');
const shown = (field: UnifiedValue | undefined) => field?.state === 'valid' && field.permission === 'authorized' && field.disclosure === 'internal' ? field.value : null;
const stringField = (field: UnifiedValue | undefined) => { const value = shown(field); return typeof value === 'string' ? value : undefined; };
type ResultCells = QueryResult['table']['rows'][number]['cells'];
function numeric(cells: ResultCells, key: string) {
  const cell = cells[key];
  return cell?.kind === 'number' ? cell.value.numeric : null;
}
function text(cells: ResultCells, key: string) {
  const cell = cells[key];
  return cell?.kind === 'text' ? cell.value : null;
}

function sourceId(key: string) {
  const hash = createHash('sha256').update(key).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Bind content to the original receipt and its result lookup. The underlying result retains field-level provenance. */
function receipt<T>(context: UnifiedProposalContext, value: T, records: readonly UnifiedResult[], date: string): Evidence<T> {
  const sources = records.length ? records.map(record => ({ id: record.result.resultId, kind: 'record' as const,
    label: record.binding.domain === 'lease' ? '租赁成交库' : record.binding.domain === 'business' ? '楼书及项目档案' : '正式季度库',
    recordId: record.result.resultId, locator: `${record.id} · ${record.result.resultId}`, version: record.binding.dataVersion, dataAsOf: date,
  })) : [{ id: sourceId(context.fingerprint + ':catalog'), kind: 'record' as const, label: '楼宇目录',
    recordId: context.fingerprint, locator: `楼宇目录快照 ${context.fingerprint}`, version: context.fingerprint, dataAsOf: context.capturedAt.slice(0, 10) }];
  return { value, disclosure: context.disclosure, sources, data: context.bindings.filter(binding => records.some(record => record.binding.domain === binding.domain && record.binding.dataVersion === binding.dataVersion)) };
}

const profileLabels = { nameEn: '英文名称', address: '地址', completionYear: '入市年份', owner: '业主', propertyManagement: '物业管理', leed: '绿色建筑认证' };
const technicalLabels = { height: '楼宇高度', floors: '楼层数', standardFloorArea: '标准层面积', clearHeight: '净高', parking: '停车位', elevators: '电梯', gfaTotal: '总建筑面积', gfaOffice: '办公建筑面积', leasableArea: '可租面积' };
function fields(items: Readonly<Record<string, UnifiedValue>>, labels: Record<string, string>): Field[] {
  return Object.entries(labels).flatMap(([id, label]) => {
    const field = items[id], value = shown(field);
    return typeof value === 'number' || typeof value === 'string' ? [{ label, value, unit: field.unit ? units[field.unit] ?? field.unit : undefined }] : [];
  });
}

function marketObservations(context: UnifiedProposalContext, records: UnifiedResult[], operation: 'trend' | 'group_aggregate', current: Period) {
  const observations = new Map<string, { metrics: Metrics & { period: Period; name: string }; records: UnifiedResult[] }>();
  for (const record of records.filter(item => item.result.operation === operation)) {
    const metric = resultMetric(record);
    if (!metric) continue;
    for (const row of record.result.table.rows) {
      const label = text(row.cells, 'period');
      const matched = label?.match(/^(\d{4})-?Q([1-4])$/);
      if (!matched) continue;
      const period = quarterSchema.parse({ year: Number(matched[1]), quarter: Number(matched[2]) });
      const name = text(row.cells, 'name') ?? '';
      const key = JSON.stringify([name, label]);
      if (!observations.has(key)) observations.set(key, { metrics: { period, name }, records: [] });
      const target = observations.get(key)!;
      target.metrics[metric] = numeric(row.cells, 'value');
      target.records.push(record);
    }
  }
  return [...observations.values()].map(({ metrics, records }) => receipt(context, metrics, records, periodEnd(current)));
}

function marketProjection(context: UnifiedProposalContext, brief: ProposalBrief, target: BoundBuilding | undefined, period: Period, materials: ProposalMaterials): Market | undefined {
  const submarket = brief.scenario === 'leasing-agency' ? target?.submarket : undefined;
  if (brief.scenario === 'market-report' && context.request.submarkets.length) return undefined;
  const key = submarket ?? cityName(brief.city);
  const records = context.results.filter(item => item.entityId === key && item.binding.domain === 'quarter' && item.binding.disclosure === 'internal');
  const aggregates = records.filter(item => item.result.operation === 'aggregate' && resultMetric(item));
  if (!aggregates.length) return undefined;
  const metrics: Metrics & { period: Period } = { period };
  for (const record of aggregates) metrics[resultMetric(record)!] = numeric(record.result.table.rows[0]?.cells ?? {}, 'value');
  const summary = resultViewSchema.safeParse(aggregates[0].result);
  const coverage = summary.success ? resultSummary(summary.data).slice(1).join(' ') : '';
  return {
    city: brief.city, name: submarket ?? brief.city, submarket,
    quarter: receipt(context, metrics, aggregates, periodEnd(period)),
    history: marketObservations(context, records, 'trend', period),
    submarkets: marketObservations(context, records.filter(item => item.result.parameters.groupBy === 'submarket'), 'group_aggregate', period),
    grades: marketObservations(context, records.filter(item => item.result.parameters.groupBy === 'grade'), 'group_aggregate', period),
    methodology: receipt(context, coverage || '分组和历史的样本覆盖按相应来源回查。', aggregates, periodEnd(period)),
    spotlight: materials.spotlight, outlook: materials.outlook,
  };
}

function leaseProjection(context: UnifiedProposalContext, period: Period): ProposalData['leases'] {
  const date = periodEnd(period);
  const entries = context.results.filter(item => item.binding.domain === 'lease' && item.binding.disclosure === 'internal');
  const distribution = (id: string): Evidence<Distribution> | undefined => {
    const record = entries.find(item => item.id === id);
    if (!record) return undefined;
    const rows = record.result.table.rows.flatMap(({ cells }) => {
      const label = text(cells, 'group');
      const count = numeric(cells, 'count');
      return label ? [{ label, value: count }] : [];
    });
    const from = record.result.parameters.from;
    const methodology = typeof from === 'string' ? `${from}至${date} · 成交笔数` : `截至${date} · 获权成交样本`;
    return receipt(context, { unit: '笔', rows, methodology }, [record], date);
  };
  const record = entries.find(item => item.id === 'lease-representatives');
  const deals = record?.result.table.rows.flatMap(({ cells }) => {
    const building = text(cells, 'building'), period = text(cells, 'period');
    return building && period ? [{ building, period, industry: text(cells, 'industry'), area: numeric(cells, 'area') }] : [];
  });
  return { trend: distribution('lease-trend'), industries: distribution('lease-industry'), sizes: distribution('lease-area'),
    deals: record && deals?.length ? receipt(context, deals, [record], date) : undefined };
}

/** Translate Agent 01's authorized context into the proposal input. The caller
 * supplies the brief reviewed for this exact scope and Agent 02's pinned media. */
export function projectUnifiedProposalContext(context: UnifiedProposalContext, brief: ProposalBrief, scope: PitchScope, materials: ProposalMaterials = {}) {
  if (!context.period || (brief.period && brief.period.replace(/^(\d{4})Q/, '$1-Q') !== quarterKey(context.period))) throw new Error('PITCH_PROPOSAL_PERIOD_REQUIRED');
  if (context.protocol !== 'unified-pitch-context/1' || cityName(context.request.city) !== cityName(brief.city) || brief.audience !== 'internal')
    throw new Error('PITCH_PROPOSAL_INVALID_CONTEXT');
  const period = quarterSchema.parse(context.period);
  const date = periodEnd(period);
  const visible = context.results.filter(item => item.binding.disclosure === 'internal');
  const selected = visible.filter(item => item.id === 'selected-buildings');
  const dossiers = visible.filter(item => item.id === 'building-dossier');
  const buildings: BoundBuilding[] = context.buildings.flatMap(building => {
    const name = stringField(building.static.name);
    if (!name || name !== building.name) return [];
    const buildingId = building.buildingId;
    const basics = fields(building.static, profileLabels);
    const technical = fields(building.static, technicalLabels);
    const metrics: Metrics & { period: Period } = { period };
    for (const [key, field, unit] of [['netEffectiveRent', 'netEffectiveRent', 'CNY/m2/month'], ['vacancyRate', 'vacancy', 'ratio'], ['trackedArea', 'totalArea', 'm2']] as const) {
      const measure = building.quarter[field];
      const value = shown(measure);
      metrics[key] = measure?.unit === unit && typeof value === 'number' ? value : null;
    }
    const submarket = normalizeMapSubmarket(stringField(building.static.submarket)) || undefined;
    const metro = shown(building.static.metro);
    const transport = typeof metro === 'string' ? metro : Array.isArray(metro) ? metro.join('、') : undefined;
    return [{ id: buildingId, name, submarket, grade: stringField(building.static.grade), identity: receipt(context, { name }, [], date),
      profile: basics.length ? receipt(context, basics, dossiers, date) : undefined,
      technical: technical.length ? receipt(context, technical, dossiers, date) : undefined,
      transport: transport ? receipt(context, { description: transport }, dossiers, date) : undefined,
      quarter: selected.length ? receipt(context, metrics, selected, date) : undefined,
      ...materials.buildingMedia?.[buildingId] }];
  });
  const supplied = brief.buildingIds;
  const loaded = buildings.map(building => building.id);
  const ids = brief.scenario === 'leasing-agency' && supplied.length === 1 ? [...new Set([...supplied, ...loaded])]
    : supplied.length ? supplied : loaded;
  const target = buildings.find(building => building.id === ids[0]);
  const snapshot: PitchContextSnapshot = { brief: { ...brief, buildingIds: [...ids], period: quarterKey(period) }, scope, fingerprint: context.fingerprint,
    data: [...context.bindings], visuals: [...(materials.visuals ?? [])], isTestData: context.isTestData };
  const { maps, customerBrief, scoreWeights, team, case: caseStudy, contact } = materials;
  const data: ProposalData = { maps, customerBrief, scoreWeights, team, case: caseStudy, contact, buildings, market: marketProjection(context, brief, target, period, materials), leases: leaseProjection(context, period) };
  return { snapshot, data };
}
