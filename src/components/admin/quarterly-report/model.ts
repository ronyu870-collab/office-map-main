/** Quarterly reporting only. Never writes back to submissions or historical metrics. */
export interface Period { year: number; quarter: number }
export interface MetricRow {
  id: string | number;
  building_id: string;
  record_year: number;
  record_quarter: number;
  created_at: string;
  updated_at?: string | null;
  total_area?: number | string | null;
  asking_rent?: number | string | null;
  management_fee?: number | string | null;
  face_rent?: number | string | null;
  rent_free_period?: number | string | null;
  net_effective_rent?: number | string | null;
  vacant_area?: number | string | null;
  vacancy_rate?: number | string | null;
  user_id?: string | null;
  user_name?: string | null;
  owner?: string | null;
  property_management?: string | null;
  notes?: string | null;
}
export interface Building {
  id: string; name: string; grade: string | null; submarket: string | null; sort_order?: number | null;
}
export interface User { user_id: string; chinese_name?: string | null; full_name?: string | null }
export type Grade = 'A' | 'B' | 'BP';
export const GRADES: { key: Grade; label: string }[] = [
  { key: 'A', label: '甲级写字楼' }, { key: 'B', label: '乙级写字楼' }, { key: 'BP', label: '产业园' },
];
const SUBMARKETS: Record<Grade, string[]> = {
  A: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '丽泽', '其他', '通州'],
  B: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '其他'],
  BP: ['望京-酒仙桥', '丰台科技园', '上地', '亦庄', '北清路', '通惠河传媒走廊', '其他'],
};
export const METHOD_NOTE = '本季按最新提交统计，不补齐未填楼宇；环比对比上季全部数据。租金按总面积加权，空置率＝空置面积合计÷对应总面积；缺失或无效值不计入对应指标。';

export function previousPeriod(p: Period): Period {
  if (!Number.isInteger(p.year) || !Number.isInteger(p.quarter) || p.quarter < 1 || p.quarter > 4) throw new Error('季度无效');
  return p.quarter === 1 ? { year: p.year - 1, quarter: 4 } : { year: p.year, quarter: p.quarter - 1 };
}
export function periodLabel(p: Period) { return `${p.year} Q${p.quarter}`; }
export function finite(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function gradeOf(value: string | null | undefined): Grade | null {
  const g = (value ?? '').trim().toUpperCase();
  if (['A', 'P', '甲级', '超甲级', '超甲级(PREMIUM)'].includes(g)) return 'A';
  if (['B', '乙级'].includes(g)) return 'B';
  if (['BP', '产业园', '产业园区'].includes(g)) return 'BP';
  return null;
}
// PostgreSQL timestamps can differ within a millisecond. Do not truncate that ordering.
function timestamp(value: string): [number, string] {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('提交时间缺失或无效，无法确定最新记录');
  const fraction = (value.match(/:\d{2}\.(\d+)/)?.[1] ?? '').padEnd(9, '0');
  return [Math.floor(ms / 1000), fraction];
}
function compareTime(a: string, b: string): number {
  const aa = timestamp(a), bb = timestamp(b);
  return aa[0] - bb[0] || aa[1].localeCompare(bb[1]);
}
function compareId(a: string | number, b: string | number): number {
  const aa = String(a), bb = String(b);
  if (/^\d+$/.test(aa) && /^\d+$/.test(bb)) return aa.length - bb.length || aa.localeCompare(bb);
  return aa.localeCompare(bb);
}
/** Pick an entire record, across all submitters. Never backfill individual fields. */
export function latestRows(rows: MetricRow[], historical = false): MetricRow[] {
  const winners = new Map<string, MetricRow>();
  for (const row of rows) {
    if (!row.building_id || row.id == null) throw new Error('记录缺少楼宇或记录标识，无法去重');
    const time = historical ? row.updated_at || row.created_at : row.created_at;
    timestamp(time);
    const key = `${row.record_year}:${row.record_quarter}:${row.building_id}`;
    const old = winners.get(key);
    if (!old || (compareTime(time, historical ? old.updated_at || old.created_at : old.created_at) || compareId(row.id, old.id)) > 0) winners.set(key, row);
  }
  return [...winners.values()];
}
export interface Evaluation { area: number | null; rent: number | null; vacant: number | null; vacancy: number | null; issues: string[] }
export function evaluate(row?: MetricRow, vacancyUnit: 'percent' | 'ratio' = 'percent'): Evaluation {
  if (!row) return { area: null, rent: null, vacant: null, vacancy: null, issues: [] };
  const a = finite(row.total_area), r = finite(row.net_effective_rent), v = finite(row.vacant_area);
  const area = a !== null && a > 0 ? a : null;
  const rent = area !== null && r !== null && r > 0 ? r : null;
  const vacant = area !== null && v !== null && v >= 0 && v <= area ? v : null;
  const vacancy = area !== null && vacant !== null ? vacant / area : null;
  const issues: string[] = [];
  if (area === null) issues.push('总面积缺失或无效');
  if (r === null || r <= 0) issues.push('净有效租金缺失或无效');
  if (v === null || v < 0 || (area !== null && v > area)) issues.push('空置面积缺失或无效');
  const storedRate = finite(row.vacancy_rate);
  // building_metrics stores ratios; quarterly_submissions stores percentages. Never infer units from magnitude.
  const savedRate = storedRate === null ? null : vacancyUnit === 'ratio' ? storedRate * 100 : storedRate;
  if (vacancy !== null && savedRate !== null && Math.abs(savedRate - vacancy * 100) > 0.011) issues.push('填报空置率与面积不一致');
  return { area, rent, vacant, vacancy, issues };
}
export function rateChange(current: number | null, previous: number | null): number | null {
  return current !== null && previous !== null && previous > 0 ? (current - previous) / previous : null;
}
export function difference(current: number | null, previous: number | null): number | null {
  return current !== null && previous !== null ? current - previous : null;
}
export interface Detail {
  source: MetricRow; name: string; grade: Grade | null; category: string; submarket: string; submitter: string; order: number;
  values: Evaluation; previous?: MetricRow; previousValues: Evaluation; checks: string[];
}
export interface Aggregate {
  count: number; rentCount: number; vacancyCount: number;
  rent: number | null; vacancy: number | null;
}
export interface MarketRow { name: string; current: Aggregate; previous: Aggregate; rentChange: number | null; vacancyChange: number | null; total: boolean }
export interface MarketGroup { key: Grade; label: string; rows: MarketRow[] }
export interface Report {
  period: Period; previous: Period; capturedAt: string;
  raw: Detail[]; latest: Detail[]; markets: MarketGroup[];
  currentIssueCount: number; previousIssueCount: number; unclassifiedCount: number;
}
export interface ReportInput {
  period: Period; submissions: MetricRow[]; previousMetrics: MetricRow[];
  buildings: Building[]; users: User[]; capturedAt: string;
}
function marketOrder(grade: Grade | null, name: string) {
  const i = grade ? SUBMARKETS[grade].indexOf(name) : -1;
  return i < 0 ? 100 : i;
}
function sortDetails(a: Detail, b: Detail) {
  const rank = (g: Grade | null) => g === 'A' ? 0 : g === 'B' ? 1 : g === 'BP' ? 2 : 3;
  return rank(a.grade) - rank(b.grade) || marketOrder(a.grade, a.submarket) - marketOrder(b.grade, b.submarket)
    || a.submarket.localeCompare(b.submarket, 'zh-CN') || a.order - b.order || a.name.localeCompare(b.name, 'zh-CN')
    || a.source.building_id.localeCompare(b.source.building_id)
    || compareTime(b.source.created_at, a.source.created_at) || compareId(b.source.id, a.source.id);
}
function aggregate(rows: Detail[]): Aggregate {
  let rentArea = 0, weightedRent = 0, vacantArea = 0, vacancyArea = 0, rentCount = 0, vacancyCount = 0;
  for (const { values: v } of rows) {
    if (v.area !== null && v.rent !== null) { rentArea += v.area; weightedRent += v.rent * v.area; rentCount++; }
    if (v.area !== null && v.vacant !== null) { vacancyArea += v.area; vacantArea += v.vacant; vacancyCount++; }
  }
  return { count: rows.length, rentCount, vacancyCount, rent: rentArea > 0 ? weightedRent / rentArea : null, vacancy: vacancyArea > 0 ? vacantArea / vacancyArea : null };
}
export function buildReport(input: ReportInput): Report {
  const previous = previousPeriod(input.period);
  const inPeriod = (r: MetricRow, p: Period) => r.record_year === p.year && r.record_quarter === p.quarter;
  const submissions = input.submissions.filter(r => inPeriod(r, input.period));
  const prior = latestRows(input.previousMetrics.filter(r => inPeriod(r, previous)), true);
  const previousByBuilding = new Map(prior.map(r => [r.building_id, r]));
  const buildingById = new Map(input.buildings.map(b => [b.id, b]));
  const userById = new Map(input.users.map(u => [u.user_id, u.chinese_name || u.full_name || u.user_id]));
  const detail = (source: MetricRow, compare: boolean, vacancyUnit: 'percent' | 'ratio' = 'percent'): Detail => {
    const b = buildingById.get(source.building_id), grade = gradeOf(b?.grade);
    const values = evaluate(source, vacancyUnit), previousRow = compare ? previousByBuilding.get(source.building_id) : undefined;
    const checks = [...values.issues];
    if (!b) checks.push('楼宇资料缺失');
    else if (!grade) checks.push('楼宇类型未分类');
    if (!b?.submarket?.trim()) checks.push('子市场未分类');
    return { source, name: b?.name || source.building_id, grade, category: GRADES.find(g => g.key === grade)?.label ?? '未分类',
      submarket: b?.submarket?.trim() || '未分类', submitter: userById.get(source.user_id ?? '') || source.user_name || source.user_id || '',
      order: b?.sort_order ?? 0, values, previous: previousRow, previousValues: evaluate(previousRow, 'ratio'), checks };
  };
  const latest = latestRows(submissions).map(r => detail(r, true)).sort(sortDetails);
  const raw = submissions.map(r => detail(r, false)).sort(sortDetails);
  const previousDetails = prior.map(r => detail(r, false, 'ratio'));
  const markets = GRADES.map(g => {
    const currentRows = latest.filter(r => r.grade === g.key), previousRows = previousDetails.filter(r => r.grade === g.key);
    const names = [...new Set([...currentRows, ...previousRows].map(r => r.submarket))]
      .sort((a, b) => marketOrder(g.key, a) - marketOrder(g.key, b) || a.localeCompare(b, 'zh-CN'));
    const row = (name: string, total = false): MarketRow => {
      const current = aggregate(total ? currentRows : currentRows.filter(r => r.submarket === name));
      const baseline = aggregate(total ? previousRows : previousRows.filter(r => r.submarket === name));
      return { name, current, previous: baseline, rentChange: rateChange(current.rent, baseline.rent),
        vacancyChange: difference(current.vacancy, baseline.vacancy), total };
    };
    // The baseline deliberately includes ALL previous-quarter buildings, not a matched panel.
    return { ...g, rows: [row('整体', true), ...names.map(n => row(n))] };
  });
  return { period: input.period, previous, capturedAt: input.capturedAt, raw, latest, markets,
    currentIssueCount: latest.filter(r => r.checks.length).length,
    previousIssueCount: previousDetails.filter(r => r.checks.length).length,
    unclassifiedCount: [...latest, ...previousDetails].filter(r => r.grade === null).length };
}
export function snapshotLabel(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));
}
export function formatNumber(n: number | null, decimals = 1): string { return n === null ? '—' : n.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
export function formatRate(n: number | null, signed = false, pp = false): string {
  if (n === null) return '—';
  const rounded = Math.round(n * 1000) / 10;
  return `${signed && rounded > 0 ? '+' : ''}${Object.is(rounded, -0) ? '0.0' : rounded.toFixed(1)}${pp ? '' : '%'}`;
}
