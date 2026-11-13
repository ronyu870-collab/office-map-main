import { composeQuarterlyNotes } from './quarterlyBatch';

export type QuarterlyDraftRow = Record<string, string | number | null | undefined>;

export const QUARTERLY_REQUIRED_FIELDS = ['qQuote', 'qProp', 'qFace', 'qFree', 'qVacArea'] as const;

export function hasQuarterlyValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function isQuarterlyRowComplete(row: QuarterlyDraftRow): boolean {
  return QUARTERLY_REQUIRED_FIELDS.every((field) => hasQuarterlyValue(row[field]));
}

export interface QuarterlyRowIssue {
  field?: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export function getQuarterlyRowIssues(
  row: QuarterlyDraftRow,
  totalArea: number,
): QuarterlyRowIssue[] {
  const issues: QuarterlyRowIssue[] = [];

  for (const field of QUARTERLY_REQUIRED_FIELDS) {
    if (!hasQuarterlyValue(row[field])) {
      issues.push({
        field,
        severity: 'warning',
        message: '该字段尚未填写；仍可提交不完整记录，提交覆盖不代表填报完整。',
      });
    }
  }

  const numericFields: Array<[string, unknown, string]> = [
    ['qQuote', row.qQuote, '报价'],
    ['qProp', row.qProp, '物业费'],
    ['qFace', row.qFace, '表面租金'],
    ['qFree', row.qFree, '免租期'],
    ['qVacArea', row.qVacArea, '空置面积'],
  ];

  for (const [field, value, label] of numericFields) {
    if (value === '' || value === null || value === undefined) continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      issues.push({ field, severity: 'error', message: `${label}不是有效数字，请核对。` });
    } else if (parsed < 0) {
      issues.push({ field, severity: 'error', message: `${label}为负值，请核对是否录入正确。` });
    }
  }

  const vacantArea = Number(row.qVacArea);
  if (Number.isFinite(vacantArea) && vacantArea >= 0 && totalArea > 0 && vacantArea > totalArea) {
    issues.push({
      field: 'qVacArea',
      severity: 'error',
      message: '空置面积高于已知项目总面积，请修正后提交。',
    });
  }

  if (hasQuarterlyValue(row.qFree) && Number(row.qFree) > 36) issues.push({ field: 'qFree', severity: 'error', message: '当前净有效租金按36个月租约计算，免租期不能超过36个月。' });
  if (!(totalArea > 0)) issues.push({ severity: 'info', message: '项目总面积未知，空置率将保留为空，请核实面积。' });
  return issues;
}

export interface QuarterlySubmissionContext {
  userId: string | null;
  userName: string;
  year: number;
  quarter: number;
  totalArea: number;
}

export function buildQuarterlySubmissionPayload(
  row: QuarterlyDraftRow,
  context: QuarterlySubmissionContext,
) {
  const numberOrNull = (value: unknown): number | null => {
    if (!hasQuarterlyValue(value)) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error('存在无效数字，请核对后提交。');
    return parsed;
  };
  const rounded = (value: unknown) => { const number = numberOrNull(value); return number === null ? null : Math.round(number); };
  const faceRent = numberOrNull(row.qFace);
  const freeMonth = numberOrNull(row.qFree);
  const vacantArea = numberOrNull(row.qVacArea);
  const safeTotalArea = Number.isFinite(context.totalArea) && context.totalArea > 0 ? context.totalArea : null;
  const netEffectiveRent = faceRent !== null && freeMonth !== null ? faceRent * (36 - freeMonth) / 36 : null;
  const vacancyRate = vacantArea !== null && safeTotalArea !== null ? vacantArea / safeTotalArea : null;

  return {
    user_id: context.userId,
    user_name: context.userName,
    record_year: context.year,
    record_quarter: context.quarter,
    asking_rent: rounded(row.qQuote),
    management_fee: rounded(row.qProp),
    face_rent: faceRent,
    rent_free_period: freeMonth,
    net_effective_rent: netEffectiveRent !== null ? Number(netEffectiveRent.toFixed(2)) : null,
    vacant_area: rounded(row.qVacArea),
    vacancy_rate: vacancyRate !== null ? Number((vacancyRate * 100).toFixed(2)) : null,
    total_area: safeTotalArea,
    owner: row.qOwner || null,
    property_management: row.qPropMan || null,
    notes: composeQuarterlyNotes(row),
  };
}
