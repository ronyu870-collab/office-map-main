import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedQueryIdentity } from '../query/serverAuthority';
import type { QueryResult, ResultCell } from '../query/result';
import type { SourceRef } from '../query/contracts';
import { Decimal } from '../query/decimal';
import { FIELD_REGISTRY_VERSION } from '../query/registry';
import { LEASE_DOMAIN, leaseBindingSchema, leaseFinancialFields, leasePlanSchema, leaseSnapshotSchema,
  type LeasePlan, type LeaseRow, type LeaseSnapshot } from './protocol';

const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export const leaseSnapshotHash = (s: LeaseSnapshot) => hash(s);
const unknown = (reason = 'missing'): ResultCell => ({ kind: 'unknown', state: reason === 'invalid' ? 'invalid' : reason === 'disclosure_threshold' ? 'unverified' : 'missing', reason, sourceIds: [] });
const text = (value: string | null): ResultCell => value === null || value === '' ? unknown() : ({ kind: 'text', value, sourceIds: [] });
function number(value: unknown): ResultCell {
  const n = Decimal.parse(value);
  return n && n.compare(Decimal.zero()) >= 0 ? { kind: 'number', value: { exact: n.exact(), numeric: n.toNumber() }, sourceIds: [] } : unknown(value == null ? 'missing' : 'invalid');
}
const labels: Record<string, [string, string | null]> = {
  building: ['楼宇或项目', null], submarket: ['子市场', null], industry: ['行业', null], period: ['成交期间', null],
  precision: ['期间精度', null], identity: ['楼宇匹配状态', null], source: ['记录来源', null], area: ['成交面积', 'm2'],
  count: ['成交记录数', 'transaction_count'], areaValidCount: ['有效面积记录数', 'transaction_count'],
  liveFaceRent: ['当前成交面价（录入口径）', 'lease_rent_raw'], historyFaceRent: ['历史成交面价（原始口径）', 'lease_rent_raw'],
  liveEffectiveRent: ['当前有效租金（非已核验净有效口径）', 'lease_rent_raw'],
  historyEffectiveRent: ['历史有效租金（口径待核验）', 'lease_rent_raw'],
  historyManagementFee: ['历史物业费（原始单位）', 'lease_fee_raw'],
  leaseMonths: ['租期', 'month'], fitOutMonths: ['装修期', 'month'], freeMonths: ['免租期', 'month'],
};
const column = (key: string) => ({ key, label: labels[key]?.[0] ?? key, unit: labels[key]?.[1] ?? null });
const quarter = (date: string) => date.slice(0, 4) + '-Q' + (Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1);

/** No similarity deductions. Stale verified links never continue to suppress a record. */
export function deduplicateLeaseRows(snapshot: LeaseSnapshot, source: LeasePlan['source']) {
  const selected = snapshot.rows.filter(r => source === 'combined' || r.source === source);
  const byId = new Map(selected.map(r => [r.id, r]));
  const removed = new Set<string>(); let verified = 0, stale = 0;
  if (source === 'combined') for (const link of snapshot.links) {
    const live = byId.get(link.live), history = byId.get(link.history);
    if (!live || !history) continue;
    if (live.fingerprint !== link.liveFingerprint || history.fingerprint !== link.historyFingerprint) { stale++; continue; }
    removed.add(history.id); verified++;
  }
  return { rows: selected.filter(r => !removed.has(r.id)), verified, stale, inputCount: selected.length };
}
export function authorizeLeasePlan(plan: LeasePlan, snapshot: LeaseSnapshot) {
  if (plan.mode === 'details' && !snapshot.details) throw new Error('QUERY_DENIED');
  if (plan.fields?.some(f => (leaseFinancialFields as readonly string[]).includes(f)) && !snapshot.financials) throw new Error('QUERY_DENIED');
  const required = plan.source === 'combined' ? ['live', 'history'] : [plan.source];
  if (required.some(s => !snapshot.sources.includes(s as 'live' | 'history'))) throw new Error('QUERY_DENIED');
}

const areaBands = [
  { upper: Decimal.parse('500')!, label: '0–<500 ㎡' },
  { upper: Decimal.parse('1000')!, label: '500–<1,000 ㎡' },
  { upper: Decimal.parse('3000')!, label: '1,000–<3,000 ㎡' },
] as const;

function areaBand(raw: LeaseRow['area']) {
  const area = Decimal.parse(raw);
  if (!area || area.compare(Decimal.zero()) < 0) return { key: 'area:unknown', label: '无有效面积' };
  const index = areaBands.findIndex(band => area.compare(band.upper) < 0);
  return index === -1 ? { key: 'area:3', label: '≥3,000 ㎡' }
    : { key: 'area:' + index, label: areaBands[index].label };
}

export function buildLeaseResult(snapshot: LeaseSnapshot, raw: unknown,
  options: { includeDetailSources?: boolean } = {}): QueryResult {
  const plan = leasePlanSchema.parse(raw); authorizeLeasePlan(plan, snapshot);
  const dedup = deduplicateLeaseRows(snapshot, plan.source);
  let uncertainDates = 0, boundaryDates = 0;
  const rows = dedup.rows.filter(row => {
    if (plan.submarkets && !plan.submarkets.includes(row.submarket ?? '')) return false;
    if (plan.buildingIds && (!['exact', 'reference'].includes(row.match) || !row.buildingId || !plan.buildingIds.includes(row.buildingId))) return false;
    if (plan.buildingName && row.building !== plan.buildingName && row.alias !== plan.buildingName) return false;
    if (plan.industry && row.industry !== plan.industry) return false;
    if (plan.industries && !plan.industries.includes(row.industry ?? '')) return false;
    if (!row.start || !row.end) { uncertainDates++; return false; }
    if (row.start < plan.from || row.end > plan.to) {
      if (row.end >= plan.from && row.start <= plan.to) boundaryDates++;
      return false;
    }
    return true;
  });
  let resultRows: Array<{ entityId: string; cells: Record<string, ResultCell> }>;
  let fields: string[]; let uncertainQuarter = 0;
  if (plan.mode === 'details') {
    fields = plan.fields ?? ['building', 'submarket', 'industry', 'period', 'precision', 'identity', 'source', 'area'];
    if (new Set(fields).size !== fields.length) throw new Error('LEASE_DUPLICATE_FIELDS');
    resultRows = rows.map(row => {
      const cells: Record<string, ResultCell> = { building: text(row.building), submarket: text(row.submarket), industry: text(row.industry),
        period: text(row.start === row.end ? row.start : row.start + ' / ' + row.end), precision: text(row.precision),
        identity: text(row.match), source: text(row.source === 'live' ? '当前成交' : '历史成交'), area: number(row.area) };
      for (const f of leaseFinancialFields) {
        const applicable = f.startsWith('live') ? row.source === 'live' : f.startsWith('history') ? row.source === 'history' : true;
        const key = f.replace(/^(live|history)/, '').replace(/^./, s => s.toLowerCase());
        cells[f] = applicable ? number(row.financials[key as keyof LeaseRow['financials']]) : unknown('not_applicable');
      }
      // Opaque identifier, not a customer identity or an operational row key.
      return { entityId: hash(row.id), cells };
    });
  } else {
    const groups = new Map<string, { label: string; rows: LeaseRow[] }>();
    if (plan.groupBy === 'total') groups.set('total', { label: '全部获权样本', rows: [] });
    for (const row of rows) {
      let key: string, label: string;
      if (plan.groupBy === 'quarter') {
        const precise = row.start && row.end && quarter(row.start) === quarter(row.end);
        if (!precise) { uncertainQuarter++; continue; }
        key = quarter(row.start!); label = key;
      } else if (plan.groupBy === 'building') {
        key = row.buildingId && ['exact', 'reference'].includes(row.match) ? row.buildingId : row.match + ':' + (row.alias ?? '未知');
        label = (row.building ?? '未知项目') + (row.match === 'project' ? '（项目，未分摊楼座）' : row.match === 'unmapped' ? '（未匹配）' : row.match === 'reference' ? '（参考楼宇）' : '');
      } else if (plan.groupBy === 'total') { key = 'total'; label = '全部获权样本'; }
      else if (plan.groupBy === 'area_band') ({ key, label } = areaBand(row.area));
      else { key = row[plan.groupBy] ?? 'unknown'; label = row[plan.groupBy] ?? '未知'; }
      const group = groups.get(key) ?? { label, rows: [] }; group.rows.push(row); groups.set(key, group);
    }
    fields = ['group', 'count', 'area', 'areaValidCount'];
    resultRows = [...groups.entries()].flatMap(([key, group]) => {
      // Aggregate-only users cannot obtain single-record facts through tiny groups.
      if (!snapshot.details && group.rows.length < snapshot.minGroupSize) return [];
      let sum = Decimal.zero(), valid = 0;
      for (const row of group.rows) { const n = Decimal.parse(row.area); if (n && n.compare(Decimal.zero()) >= 0) { sum = sum.add(n); valid++; } }
      return [{ entityId: hash(key), cells: { group: text(group.label), count: number(group.rows.length),
        area: !snapshot.details && valid < snapshot.minGroupSize ? unknown('disclosure_threshold') : valid ? { kind: 'number' as const, value: { exact: sum.exact(), numeric: sum.toNumber() }, sourceIds: [] } : unknown('no_valid_sample'), areaValidCount: number(valid) } }];
    });
  }
  if (plan.mode === 'aggregate' && plan.groupBy === 'quarter') {
    const present = new Set(resultRows.map(row => row.entityId));
    const ordinal = (date: string) => Number(date.slice(0, 4)) * 4 + Math.floor((Number(date.slice(5, 7)) - 1) / 3);
    for (let q = ordinal(plan.from); q <= ordinal(plan.to); q++) {
      const label = Math.floor(q / 4) + '-Q' + (q % 4 + 1), entityId = hash(label);
      if (!present.has(entityId)) resultRows.push({ entityId, cells: { group: text(label),
        count: unknown('no_valid_sample'), area: unknown('no_valid_sample'), areaValidCount: unknown('no_valid_sample') } });
    }
  }
  const key = plan.sort === 'period' ? (plan.mode === 'details' ? 'period' : 'group') : plan.sort;
  // Sort before projection: baseline area/period remain authorized even when
  // the user explicitly selects only descriptive detail columns.
  resultRows.sort((a, b) => {
    const ca = a.cells[key], cb = b.cells[key];
    if (ca.kind === 'unknown' || cb.kind === 'unknown') return ca.kind === cb.kind ? a.entityId.localeCompare(b.entityId) : ca.kind === 'unknown' ? 1 : -1;
    const cmp = ca.kind === 'number' && cb.kind === 'number'
      ? Decimal.fraction(BigInt(ca.value.exact.numerator), BigInt(ca.value.exact.denominator)).compare(Decimal.fraction(BigInt(cb.value.exact.numerator), BigInt(cb.value.exact.denominator)))
      : String(ca.kind === 'text' ? ca.value : '').localeCompare(String(cb.kind === 'text' ? cb.value : ''), 'zh-CN');
    return cmp * (plan.direction === 'desc' ? -1 : 1) || a.entityId.localeCompare(b.entityId);
  });
  const matchedRows = resultRows.length;
  if (plan.topN) {
    let count = Math.min(plan.topN, resultRows.length);
    const boundary = resultRows[count - 1]?.cells[key];
    while (boundary && boundary.kind !== 'unknown' && count < resultRows.length && JSON.stringify(resultRows[count].cells[key]) === JSON.stringify(boundary)) count++;
    resultRows = resultRows.slice(0, count);
  }
  const version = leaseSnapshotHash(snapshot), scope = hash(plan);
  // A snapshot-level provenance reference exposes no original row values or customer IDs.
  const sourceId = 'lease:' + version + ':' + scope;
  const detailSources: SourceRef[] = [];
  const detailRows = options.includeDetailSources && plan.mode === 'details' ? new Map(rows.map(row => [hash(row.id), row])) : null;
  resultRows = resultRows.map(row => {
    const record = detailRows?.get(row.entityId);
    return { ...row, cells: Object.fromEntries(fields.map(f => {
      const cell = row.cells[f];
      if (!record) return [f, { ...cell, sourceIds: [sourceId] }];
      const id = 'lease-detail:' + row.entityId + ':' + f + ':' + record.fingerprint;
      detailSources.push({ id, table: 'lease_research_snapshot', recordId: row.entityId,
        entityId: row.entityId, field: f, recordVersion: record.fingerprint,
        rawValue: cell.kind === 'unknown' ? null : cell.value, unit: column(f).unit ?? 'text',
        period: null, recordedAt: null, businessAsOf: record.start === record.end ? record.start : null,
        verification: 'database_only', original: null });
      return [f, { ...cell, sourceIds: [id] }];
    })) };
  });
  return {
    resultId: randomUUID(), createdAt: new Date().toISOString(), snapshotId: version, dataVersion: version,
    scopeFingerprint: scope, registryVersion: FIELD_REGISTRY_VERSION, operation: 'list', analysis: null,
    parameters: { dataDomain: LEASE_DOMAIN, leaseProviderMinGroupSize: snapshot.minGroupSize, leaseBindings: [{ plan, permissionRevision: snapshot.permission_revision, snapshotHash: version }],
      leaseCoverage: { matchedRows, returnedRows: resultRows.length, uncertainDates, boundaryDates, uncertainQuarter,
        verifiedDuplicates: dedup.verified, staleDuplicateLinks: dedup.stale },
      scope: { from: plan.from, to: plan.to, source: plan.source, groupBy: plan.groupBy, mode: plan.mode } },
    table: { id: 'lease-research', columns: fields.map(f => f === 'group' ? { key: 'group', label: plan.groupBy === 'quarter' ? '季度' : plan.groupBy === 'area_band' ? '成交面积区间' : '分组', unit: null } : column(f)), rows: resultRows },
    sources: [{ id: sourceId, table: 'lease_research_snapshot', recordId: version, entityId: version.slice(0, 8) + '-' + version.slice(8, 12) + '-4' + version.slice(13, 16) + '-a' + version.slice(17, 20) + '-' + version.slice(20, 32), field: 'authorized_projection',
      recordVersion: version, rawValue: null, unit: 'snapshot', period: null, recordedAt: null, businessAsOf: plan.to, verification: 'database_only', original: null }, ...detailSources],
    limitations: ['仅反映获权成交记录，不代表市场全集；成交面积不是净吸纳量。',
      '行业按已存字段精确筛选；TMT原始标签不自动扩展或等同于其他科技、媒体、通信分类，组合行业需明确指定。',
      '当前与历史表仅按人工核验的记录身份关联去重，默认保留当前记录；公司或面积相似不作重复依据，仍可能存在未经核验的跨表重叠。',
      '去重在期间和业务筛选之前执行；核验关联任一版本或楼宇映射变化即失效，保留两条并提示重新核验。',
      `本次获权数据池使用 ${dedup.verified} 条有效去重关联；${dedup.stale} 条关联版本失效。`,
      `未知期间排除 ${uncertainDates} 条，跨筛选边界的低精度期间排除 ${boundaryDates} 条；年份精度不能强分配到季度。`,
      `季度分组另排除 ${uncertainQuarter} 条不足以确定季度的记录，不将其绘制到时间轴；年度总计仍可在完整年度范围查询。`,
      'project/unmapped 保留不确定身份，项目面积不分摊到各楼座；限定单楼授权仅允许可靠 exact/reference 匹配。',
      '季度范围内没有可交付统计的期间保留未知，不当成零；时间轴保留这些期间，不跨缺期插值连线。',
      '缺失面积不当成零，面积合计仅含有效面积，成交笔数同时列出有效面积样本数。',
      '两表租金分别保留原始面价和有效租金口径；历史有效租金未认定为净有效租金，原始租金和物业费单位待核验，不跨表计算平均租金，不推算普通或净有效租金。',
      ...(!snapshot.details ? [`聚合专用资格：少于 ${snapshot.minGroupSize} 条的分组不交付；面积有效样本不足该阈值时面积值不交付，不提供原始明细。未交付内容不能用于推断分组是否存在或其数量；该披露规则不构成差分隐私保证。`] : []),
      ...(plan.groupBy === 'area_band' ? ['面积区间按左闭右开分组；零值属于首组，无有效面积单列。'] : []),
      ...(plan.topN ? [`Top ${plan.topN} 保留末位并列，共 ${matchedRows} 个匹配结果，交付 ${resultRows.length} 个。`] : [])],
  };
}

export async function loadLeaseSnapshot(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal): Promise<LeaseSnapshot> {
  if (identity.expiresAt <= Date.now() || identity.actorId !== identity.effectiveUserId) throw new Error('QUERY_DENIED');
  const { data, error } = await client.rpc('ai_lease_research_snapshot', { p_actor: identity.actorId,
    p_effective: identity.effectiveUserId, p_session: identity.sessionId }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new Error('LEASE_READ_UNAVAILABLE');
  if (data?.allowed !== true) throw new Error('QUERY_DENIED');
  if (data.over_limit === true) throw new Error('LEASE_SNAPSHOT_LIMIT');
  return leaseSnapshotSchema.parse(data);
}
export async function recheckLeaseResults(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal,
  results: readonly { parameters: Readonly<Record<string, unknown>> }[], exporting = false) {
  if (!results.length) return;
  const bindings = results.flatMap(result => leaseBindingSchema.array().min(1).max(64).parse(result.parameters.leaseBindings));
  const snapshot = await loadLeaseSnapshot(client, identity, signal);
  if (exporting && !snapshot.export) throw new Error('QUERY_DENIED');
  const version = leaseSnapshotHash(snapshot);
  for (const binding of bindings) {
    authorizeLeasePlan(binding.plan, snapshot);
    if (binding.permissionRevision !== snapshot.permission_revision || binding.snapshotHash !== version) throw new Error('QUERY_DENIED');
  }
}

export async function recheckLeaseResult(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal,
  result: { parameters: Readonly<Record<string, unknown>> }, exporting = false) {
  await recheckLeaseResults(client, identity, signal, [result], exporting);
}
