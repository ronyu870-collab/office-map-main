export type QuarterlyDraftRow = Record<string, string | number | null | undefined>;

export const QUARTERLY_REQUIRED_FIELDS = ['qQuote', 'qProp', 'qFace', 'qFree', 'qVacArea'] as const;

export function isQuarterlyRowComplete(row: QuarterlyDraftRow): boolean {
  // Preserve the legacy submission contract: the five operational fields are
  // considered complete only when each has a truthy value. Owners, property
  // management and remarks remain optional, and force-submit remains available.
  return QUARTERLY_REQUIRED_FIELDS.every((field) => Boolean(row[field]));
}

export interface QuarterlyRowIssue {
  field?: string;
  severity: 'warning' | 'info';
  message: string;
}

export function getQuarterlyRowIssues(
  row: QuarterlyDraftRow,
  totalArea: number,
): QuarterlyRowIssue[] {
  const issues: QuarterlyRowIssue[] = [];

  for (const field of QUARTERLY_REQUIRED_FIELDS) {
    if (!row[field]) {
      issues.push({
        field,
        severity: 'warning',
        message: '该字段在现有提交流程中属于必填项；仍可使用原有“强行提交”流程。',
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
      issues.push({ field, severity: 'warning', message: `${label}不是有效数字，请核对。` });
    } else if (parsed < 0) {
      issues.push({ field, severity: 'warning', message: `${label}为负值，请核对是否录入正确。` });
    }
  }

  const vacantArea = Number(row.qVacArea);
  if (Number.isFinite(vacantArea) && vacantArea >= 0 && totalArea > 0 && vacantArea > totalArea) {
    issues.push({
      field: 'qVacArea',
      severity: 'warning',
      message: '空置面积高于项目总面积，请核对。此提示不改变原有提交规则。',
    });
  }

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
  const faceRent = parseFloat(String(row.qFace ?? '')) || 0;
  const freeMonth = parseFloat(String(row.qFree ?? '')) || 0;
  const vacantArea = parseFloat(String(row.qVacArea ?? '')) || 0;
  const safeTotalArea = context.totalArea || 1;
  const netEffectiveRent = faceRent > 0 ? faceRent * (36 - freeMonth) / 36 : null;
  const vacancyRate = row.qVacArea !== undefined && row.qVacArea !== ''
    ? vacantArea / safeTotalArea
    : null;

  return {
    user_id: context.userId,
    user_name: context.userName,
    record_year: context.year,
    record_quarter: context.quarter,
    asking_rent: row.qQuote ? Math.round(Number(row.qQuote)) : null,
    management_fee: row.qProp ? Math.round(Number(row.qProp)) : null,
    face_rent: row.qFace ? parseFloat(String(row.qFace)) : null,
    rent_free_period: row.qFree ? parseFloat(String(row.qFree)) : null,
    net_effective_rent: netEffectiveRent !== null ? parseFloat(netEffectiveRent.toFixed(2)) : null,
    vacant_area: row.qVacArea ? Math.round(Number(row.qVacArea)) : null,
    vacancy_rate: vacancyRate !== null ? parseFloat((vacancyRate * 100).toFixed(2)) : null,
    total_area: safeTotalArea,
    owner: row.qOwner || null,
    property_management: row.qPropMan || null,
    notes: row.qRemark || null,
  };
}
