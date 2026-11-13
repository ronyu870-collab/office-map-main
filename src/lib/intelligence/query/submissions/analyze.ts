import { latestRows } from '@/src/lib/quarterly/latestRows';
import { createHash } from 'node:crypto';
import { Decimal } from '../decimal';
import type { SourceRef } from '../contracts';
import { SUBMISSION_POLICY, submissionFields, submissionFieldKeys, validateSubmissionSnapshot, type SubmissionField, type SubmissionSnapshot } from './contracts';

type Submission = SubmissionSnapshot['submissions'][number];
export type SubmissionIssue = { kind: 'missing' | 'invalid' | 'inconsistent' | 'unavailable'; code: string; fields: SubmissionField[]; sourceIds: string[] };
const sourceId = (table: string, id: string, field: string, version: string) => `${table}/${id}/${field}/${version}`;
const refId = (s: Pick<Submission,'id'|'version'>, field: string, table='quarterly_submissions') => sourceId(table, s.id, field, s.version);
const required: SubmissionField[] = ['asking_rent', 'management_fee', 'face_rent', 'rent_free_period', 'vacant_area'];
const D = (value: string) => Decimal.parse(value)!;

/** Same five required inputs as quarterly entry; completeness is NOT validity or approval. */
export function inspectSubmission(s: Pick<Submission,'id'|'version'|'values'>, table: 'quarterly_submissions'|'future_supply_submissions'='quarterly_submissions') {
  const issues: SubmissionIssue[] = [];
  const issue = (kind: SubmissionIssue['kind'], code: string, fields: SubmissionField[]) => issues.push({ kind, code, fields, sourceIds: fields.map(f => refId(s, f, table)) });
  const missing = (f: SubmissionField) => s.values[f] === null || s.values[f]?.trim() === '';
  const numbers = Object.fromEntries(submissionFieldKeys.map(f => [f, Decimal.parse(s.values[f])])) as Record<SubmissionField, Decimal | null>;
  for (const f of submissionFieldKeys) {
    const n = numbers[f];
    if (missing(f)) issue('missing', 'missing_field', [f]);
    else if (!n || n.compare(D('0')) < 0 || f === 'total_area' && n.compare(D('0')) === 0
      || f === 'rent_free_period' && n.compare(D('36')) > 0 || f === 'vacancy_rate' && n.compare(D('100')) > 0) issue('invalid', 'invalid_range_or_decimal', [f]);
  }
  const { total_area: area, vacant_area: vacant, vacancy_rate: stored, face_rent: face, rent_free_period: free, net_effective_rent: rent } = numbers;
  const areaValid = !!area && area.compare(D('0')) > 0;
  const vacancyValid = areaValid && !!vacant && vacant.compare(D('0')) >= 0 && vacant.compare(area!) <= 0;
  if (areaValid && vacant && vacant.compare(area!) > 0) issue('invalid', 'vacant_exceeds_total', ['total_area', 'vacant_area']);
  if (vacancyValid && stored && stored.subtract(vacant!.divide(area!).multiply(D('100'))).compare(D('0.011')) > 0
    || vacancyValid && stored && stored.subtract(vacant!.divide(area!).multiply(D('100'))).compare(D('-0.011')) < 0) {
    issue('inconsistent', 'stored_percentage_differs_from_areas', ['vacancy_rate', 'total_area', 'vacant_area']);
  }
  if (face && free && rent && face.compare(D('0')) >= 0 && free.compare(D('0')) >= 0 && free.compare(D('36')) <= 0) {
    const difference = rent.subtract(face.multiply(D('36').subtract(free)).divide(D('36')));
    if (difference.compare(D('0.005')) > 0 || difference.compare(D('-0.005')) < 0) issue('inconsistent', 'net_rent_differs_from_36_month_formula', ['net_effective_rent', 'face_rent', 'rent_free_period']);
  }
  const rentValid = areaValid && !!rent && rent.compare(D('0')) > 0;
  if (!rentValid) issue('unavailable', 'not_eligible_for_area_weighted_rent', ['total_area', 'net_effective_rent']);
  if (!vacancyValid) issue('unavailable', 'not_eligible_for_area_weighted_vacancy', ['total_area', 'vacant_area']);
  return { requiredComplete: required.every(f => !missing(f)), missingRequired: required.filter(missing), rentEligible: rentValid, vacancyEligible: vacancyValid, issues };
}

function freeze<T>(v: T): T {
  if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); }
  return v;
}

/** A read-only observation of submissions, never historical metrics, drafts or approval. */
export function analyzeSubmissionSnapshot(input: unknown) {
  const s = validateSubmissionSnapshot(input);
  const sources = new Map<string, SourceRef>();
  const add = (table: string, r: { id: string; version: string }, entityId: string, field: string, value: unknown, recordedAt: string | null, unit = 'text') => {
    const id = sourceId(table, r.id, field, r.version);
    const ref: SourceRef = { id, table, recordId: r.id, entityId, field, recordVersion: r.version, rawValue: value, unit,
      period: table === 'quarterly_submissions' ? s.period : null, recordedAt, businessAsOf: null, verification: 'database_only', original: null };
    if (sources.has(id) && JSON.stringify(sources.get(id)) !== JSON.stringify(ref)) throw new Error('SOURCE_ID_COLLISION');
    if (!sources.has(id) && sources.size >= 200000) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
    sources.set(id, ref); return id;
  };
  const byBuilding = new Map(s.buildings.map(b => [b.id, { assignments: [] as SubmissionSnapshot['assignments'], submissions: [] as SubmissionSnapshot['submissions'] }]));
  for (const a of s.assignments) byBuilding.get(a.buildingId)!.assignments.push(a);
  for (const r of s.submissions) byBuilding.get(r.buildingId)!.submissions.push(r);
  const owners = new Map<string, { userId: string; names: string[]; assignedBuildingIds: string[]; submittedBuildingIds: string[]; missingBuildingIds: string[]; sourceIds: string[] }>();
  let duplicateAssignmentRows = 0, invalidAssignmentRows = 0;
  const rows = s.buildings.map(b => {
    const group = byBuilding.get(b.id)!;
    const buildingSources = (['name','submarket','grade'] as const).map(f => add('buildings', b, b.id, f, b[f], null));
    const pairs = new Map<string, SubmissionSnapshot['assignments']>();
    const assignmentSources: string[] = [];
    for (const a of group.assignments) {
      assignmentSources.push(...(['buildingId','userId','userName','createdAt'] as const).map(f => add('building_assignments', a, b.id,
        ({ buildingId:'building_id',userId:'user_id',userName:'user_name',createdAt:'created_at' } as const)[f], a[f], a.createdAt)));
      if (!a.userId.trim()) { invalidAssignmentRows++; continue; }
      const values = pairs.get(a.userId) ?? []; if (values.length) duplicateAssignmentRows++;
      pairs.set(a.userId, [...values, a]);
    }
    const submissionSources: string[] = [];
    for (const r of group.submissions) {
      submissionSources.push(...(['buildingId','userId','userName','createdAt','updatedAt','year','quarter'] as const).map(f => add('quarterly_submissions', r, b.id,
        ({ buildingId:'building_id',userId:'user_id',userName:'user_name',createdAt:'created_at',updatedAt:'updated_at',year:'record_year',quarter:'record_quarter' } as const)[f], r[f], r.createdAt)));
      if (s.quality) for (const f of submissionFieldKeys) add('quarterly_submissions', r, b.id, f, r.values[f], r.createdAt, submissionFields[f].unit);
    }
    for (const [userId, assignments] of pairs) {
      const owner = owners.get(userId) ?? { userId, names: [], assignedBuildingIds: [], submittedBuildingIds: [], missingBuildingIds: [], sourceIds: [] };
      owner.names = [...new Set([...owner.names, ...assignments.map(a => a.userName)])];
      owner.assignedBuildingIds.push(b.id);
      (group.submissions.some(r => r.userId === userId) ? owner.submittedBuildingIds : owner.missingBuildingIds).push(b.id);
      owner.sourceIds.push(...buildingSources, ...assignments.map(a => sourceId('building_assignments', a.id, 'user_id', a.version)),
        ...group.submissions.filter(r => r.userId === userId).map(r => refId(r, 'user_id')));
      owners.set(userId, owner);
    }
    const latestUnresolved = group.submissions.some(r => r.createdAt === null);
    const winner = latestUnresolved ? null : latestRows(group.submissions.map(r => ({ ...r, building_id: r.buildingId, record_year: r.year, record_quarter: r.quarter, created_at: r.createdAt! })))[0] ?? null;
    return { buildingId: b.id, name: b.name, submarket: b.submarket, grade: b.grade,
      assigned: pairs.size > 0, assigneeIds: [...pairs.keys()].sort(), submitted: group.submissions.length > 0,
      rawSubmissionCount: group.submissions.length, latestUnresolved, latestSubmissionId: winner?.id ?? null,
      latestSubmittedBy: winner ? { userId: winner.userId, userName: winner.userName, createdAt: winner.createdAt } : null,
      quality: s.quality && winner ? inspectSubmission(winner) : null,
      sourceIds: [...buildingSources, ...assignmentSources, ...submissionSources],
    };
  });
  const count = (fn: (r: typeof rows[number]) => boolean) => rows.filter(fn).length;
  const assigned = count(r => r.assigned), submitted = count(r => r.assigned && r.submitted);
  const people = [...owners.values()].sort((a,b) => a.userId.localeCompare(b.userId));
  const settingsSources = s.settings.map(r => add('app_settings', { id: r.key, version: r.version }, '', 'value', r.value, r.updatedAt));
  return freeze({ version: SUBMISSION_POLICY, snapshotId: s.snapshotId, readAt: s.readAt, requestId: s.requestId,
    dataVersion: createHash('sha256').update(JSON.stringify(s)).digest('hex'), period: s.period, configuredPeriod: s.configuredPeriod, periodBasis: s.periodBasis,
    counts: { catalogBuildings: rows.length, assignedBuildings: assigned, unassignedBuildings: rows.length - assigned,
      submittedBuildings: count(r => r.submitted), assignedSubmittedBuildings: submitted, missingAssignedBuildings: assigned - submitted,
      unassignedSubmittedBuildings: count(r => !r.assigned && r.submitted), assignmentPairs: people.reduce((sum,p) => sum+p.assignedBuildingIds.length,0),
      submittedOwnerPairs: people.reduce((sum,p) => sum+p.submittedBuildingIds.length,0), missingOwnerPairs: people.reduce((sum,p) => sum+p.missingBuildingIds.length,0),
      duplicateAssignmentRows, invalidAssignmentRows, rawSubmissions: s.submissions.length,
      repeatSubmissionRows: s.submissions.length - count(r => r.submitted), latestUnresolvedBuildings: count(r => r.latestUnresolved) },
    submittedCoverage: assigned ? { numerator: String(submitted), denominator: String(assigned) } : null,
    quality: s.quality ? { evaluatedBuildings: count(r => r.quality !== null), requiredCompleteBuildings: count(r => !!r.quality?.requiredComplete),
      missingRequiredBuildings: count(r => !!r.quality?.missingRequired.length), flaggedBuildings: count(r => !!r.quality?.issues.length),
      rentEligibleBuildings: count(r => !!r.quality?.rentEligible), vacancyEligibleBuildings: count(r => !!r.quality?.vacancyEligible) } : null,
    rows, people, sources: [...sources.values()], settingsSourceIds: settingsSources,
    limitations: [
      '仅统计当前获权、启用、跟踪中的存量楼宇；不包括未来供应，不代表全部现实市场。',
      '分配是当前关系，按楼宇与负责人账号去重；不能据此还原历史季度应报任务。未分配与已分配未提交分开。',
      '楼宇提交覆盖按该季度任一人员提交计；人员任务按该负责人自己提交计，两个分母不能混用。',
      '提交存在不代表字段齐全、指标有效或已经审定；不读取草稿，不以历史building_metrics补填。',
      '最新记录按created_at微秒、id降序选择整条；不按字段回填。缺少提交时间时最新记录无法确定。',
      '姓名来自分配或提交当时保存的标签，同名账号不合并；不据此确认当前在职身份。',
      ...(s.quality ? ['输入齐全按报价、物业费、表面租金、免租期、空置面积五项；零值保留，齐全不等于有效。',
        '填报空置率单位为百分数；与面积重算差超过0.011个百分点标不一致。净有效租金按36个月公式，差超过0.005元/平方米/月标不一致。异常只提示复核，不改写原值。'] : []),
      '来源仅为数据库记录，未关联原始文件；未提交结论依据本次完整获权快照，不伪造不存在记录的来源。',
    ],
  });
}
