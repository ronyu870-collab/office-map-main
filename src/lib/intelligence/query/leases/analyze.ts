import { createHash } from 'node:crypto';
import type { SourceRef } from '../contracts';
import { Decimal } from '../decimal';
import { LEASE_POLICY, validateLeaseSnapshot, type LeaseRecord } from './contracts';

const validDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value && d.getUTCFullYear() >= 1900 && d.getUTCFullYear() <= 2200 ? d : null;
};
/** Source periods retain their precision and may conflict; they are never lease commencement dates. */
export function inspectLeasePeriod(r: Pick<LeaseRecord, 'date'|'year'|'quarter'|'precision'|'periodStart'|'periodEnd'>) {
  const fail = (state: 'unknown'|'invalid'|'conflict', reason: string) => ({ state, reason, start: null, end: null });
  let start: string, end: string, precision: 'date'|'quarter'|'year';
  if (r.date !== null) {
    const d = validDate(r.date);
    if (!d) return fail('invalid', 'invalid_transaction_date');
    if (r.year !== null && r.year !== d.getUTCFullYear() || r.quarter !== null && r.quarter !== `Q${Math.floor(d.getUTCMonth() / 3) + 1}`)
      return fail('conflict', 'date_and_recorded_period_disagree');
    start = end = r.date; precision = 'date';
  } else {
    if (r.year === null) {
      if (r.quarter !== null) return fail('invalid', 'quarter_without_year');
      if (r.precision !== 'unknown' || r.periodStart !== null || r.periodEnd !== null) return fail('conflict', 'read_view_period_without_basis');
      return fail('unknown', 'period_missing');
    }
    if (!Number.isInteger(r.year) || r.year < 1900 || r.year > 2200) return fail('invalid', 'invalid_transaction_year');
    if (r.quarter !== null && !/^Q[1-4]$/.test(r.quarter)) return fail('invalid', 'invalid_transaction_quarter');
    const q = r.quarter ? Number(r.quarter[1]) : null;
    start = `${r.year}-${String(q ? q * 3 - 2 : 1).padStart(2, '0')}-01`;
    end = q ? new Date(Date.UTC(r.year, q * 3, 0)).toISOString().slice(0, 10) : `${r.year}-12-31`;
    precision = q ? 'quarter' : 'year';
  }
  if (r.precision !== precision || r.periodStart !== start || r.periodEnd !== end) return fail('conflict', 'read_view_period_disagrees');
  return { state: precision, reason: null, start, end };
}
const numericFields = ['area_sqm','face_rent','effective_rent','lease_term_months'] as const;
export function inspectLeaseNumber(raw: string | null, field: typeof numericFields[number]) {
  const value = Decimal.parse(raw), min = value?.compare(Decimal.zero());
  const state = raw === null || raw.trim() === '' ? 'missing' as const : !value || min! < 0 || field === 'lease_term_months' && min === 0 ? 'invalid' as const : 'valid' as const;
  return { state, value: state === 'valid' ? { exact: value!.exact(), numeric: value!.toNumber() } : null };
}
const unit = (field: string) => field === 'area_sqm' ? 'm2' : field === 'face_rent' || field === 'effective_rent' ? 'CNY/m2/month' : field === 'lease_term_months' ? 'month' : 'text';
const freeze = <T,>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export function analyzeLeaseSnapshot(input: unknown) {
  const snapshot = validateLeaseSnapshot(input), sources: SourceRef[] = [];
  const rows = snapshot.records.map(r => {
    const period = inspectLeasePeriod(r), refs: Record<string, string> = {};
    const add = (field: string, rawValue: unknown, table = 'lease_transactions_read_v1', recordId = r.id) => {
      if (sources.length >= 200000) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
      const id = `${table}/${recordId}/${field}/${r.version}`;
      sources.push({ id, table, recordId, entityId: r.id, field, recordVersion: r.version, rawValue, unit: unit(field),
        period: period.state === 'date' || period.state === 'quarter' ? { year: Number(period.start!.slice(0, 4)), quarter: Math.ceil(Number(period.start!.slice(5, 7)) / 3) } : null,
        recordedAt: r.createdAt, businessAsOf: null, verification: r.source === 'history' ? 'historical' : 'database_only', original: null });
      refs[field] = id;
    };
    const base = { company: r.company, new_building: r.buildingName, sub_market: r.submarket, building_id: r.buildingId,
      building_match_scope: r.buildingScope, related_building_ids: r.relatedBuildingIds, transaction_date: r.date,
      transaction_year: r.year, transaction_quarter: r.quarter, transaction_time_precision: r.precision,
      transaction_period_start: r.periodStart, transaction_period_end: r.periodEnd, period_source: r.periodSource, quality_status: r.quality };
    Object.entries(base).forEach(([k, v]) => add(k, v));
    Object.entries(r.values).forEach(([k, v]) => add(k, v));
    if (r.source === 'live') Object.entries(r.estimates).forEach(([k, v]) => add(`is_${k}_estimated`, v, 'lease_transactions', r.sourceRecordId));
    if (snapshot.fields.includes('lease_term_months') && r.source === 'history') add('source_lease_term_raw', r.termRaw, 'lease_transactions_history', r.sourceRecordId);
    if (snapshot.fields.includes('source_evidence') && r.source === 'history') {
      for (const [k, v] of Object.entries(r.evidence ?? { file: null, sheet: null, row: null })) add(`source_${k}`, v, 'lease_transactions_history', r.sourceRecordId);
    }
    const numbers = Object.fromEntries(numericFields.filter(k => snapshot.fields.includes(k)).map(k => [k, { ...inspectLeaseNumber(r.values[k], k), sourceIds: [refs[k]] }]));
    const rentNature = Object.fromEntries(Object.entries(r.estimates).map(([k, v]) => [k, {
      state: v === 'true' ? 'estimated' : v === 'false' ? 'not_marked_estimated' : 'unknown', sourceIds: [r.source === 'live' ? refs[`is_${k}_estimated`] : refs[k]],
      reason: r.source === 'history' ? 'historical_estimate_flag_not_exposed' : null,
    }]));
    return { recordId: r.id, source: r.source, sourceRecordId: r.sourceRecordId, company: r.company,
      building: { id: r.buildingId, name: r.buildingName, scope: r.buildingScope, relatedIds: r.relatedBuildingIds }, submarket: r.submarket,
      period: { ...period, source: r.periodSource }, numbers, rentNature, values: r.values, evidence: r.evidence,
      sourceIds: Object.values(refs), fieldSources: refs };
  });
  const summaries = snapshot.sources.map(source => {
    const selected = snapshot.records.filter(r => r.source === source);
    const areaValues = selected.map(r => ({ row: r, fact: snapshot.fields.includes('area_sqm') ? inspectLeaseNumber(r.values.area_sqm, 'area_sqm') : null }));
    const known = areaValues.filter(r => r.fact?.state === 'valid');
    const areaSum = known.reduce((sum, r) => sum.add(Decimal.parse(r.row.values.area_sqm)!), Decimal.zero());
    const rents = Object.fromEntries((['face_rent','effective_rent'] as const).filter(k => snapshot.fields.includes(k)).map(k => [k,
      ['estimated','not_marked_estimated','unknown'].map(nature => {
        const members = selected.filter(r => (r.estimates[k] === 'true' ? 'estimated' : r.estimates[k] === 'false' ? 'not_marked_estimated' : 'unknown') === nature);
        const paired = snapshot.fields.includes('area_sqm') ? members.filter(r => inspectLeaseNumber(r.values[k], k).state === 'valid'
          && inspectLeaseNumber(r.values.area_sqm, 'area_sqm').state === 'valid' && Decimal.parse(r.values.area_sqm)!.compare(Decimal.zero()) > 0) : [];
        const denominator = paired.reduce((s, r) => s.add(Decimal.parse(r.values.area_sqm)!), Decimal.zero());
        const numerator = paired.reduce((s, r) => s.add(Decimal.parse(r.values.area_sqm)!.multiply(Decimal.parse(r.values[k])!)), Decimal.zero());
        return { nature, records: members.length, validRentRecords: members.filter(r => inspectLeaseNumber(r.values[k], k).state === 'valid').length,
          pairedRecords: paired.length, pairedIds: paired.map(r => r.id), denominator: denominator.exact(), numerator: numerator.exact(),
          weightedRent: paired.length ? { exact: numerator.divide(denominator).exact(), numeric: numerator.divide(denominator).toNumber() } : null };
      })]));
    return { source, records: selected.length, distinctRecordedNames: new Set(selected.map(r => r.company?.trim().toLowerCase()).filter(Boolean)).size,
      area: snapshot.fields.includes('area_sqm') ? { valid: known.length, missing: areaValues.filter(r => r.fact?.state === 'missing').length,
        invalid: areaValues.filter(r => r.fact?.state === 'invalid').length, sum: known.length ? { exact: areaSum.exact(), numeric: areaSum.toNumber() } : null,
        includedIds: known.map(r => r.row.id) } : null, rents };
  });
  return freeze({ policy: LEASE_POLICY, snapshotId: snapshot.snapshotId, requestId: snapshot.requestId, readAt: snapshot.readAt,
    dataVersion: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), fields: snapshot.fields, recordCount: rows.length,
    uniqueBusinessDealCount: null, rows, summaries, sources,
    limitations: ['日常与历史记录按来源分别统计；没有经确认的跨来源去重映射，不能将合并记录数称为独立成交笔数。',
      '项目级关联只保留一条成交记录和原面积，不能把同一成交分摊或复制到每个关联楼座；reference不是运营楼宇。',
      '企业名称只是原记录文字，相同名称不证明同一法人，不据相似名称或AI关系合并成交。',
      '成交日期/季度/年份不是起租或到期日；保留原时间精度，矛盾值待核实，未知不推算。',
      '表面租金和有效租金分别保留，单位元/㎡/月；估算、未标估算与估算状态未知分别计算，不称已核验合同价。',
      '租期按记录中的月数展示，历史原文及单位仍须核实；零租期无效，不据此直接承诺到期时间。',
      '面积是记录的成交面积；只对同一来源有效面积求和，不等于全市场需求或净吸纳量。',
      '来源定位是数据库原字段及原文件/工作表/行号文字；未接通可核验原件版本时不伪造文档链接或已核验标记。'] });
}
