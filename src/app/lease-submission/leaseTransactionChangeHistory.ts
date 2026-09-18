import type { LeaseTransaction } from '@/src/types/lease-transaction';

export interface LeaseFieldChange {
  key: string;
  label: string;
  before: unknown;
  after: unknown;
  beforeText: string;
  afterText: string;
}

const FIELD_CONFIG = [
  ['company', '企业名称'],
  ['suspected_company_fullname', '疑似企业全称'],
  ['enterprise_type', '企业类型'],
  ['industry', '所属行业'],
  ['sub_industry', '所属子行业'],
  ['demand_type', '需求类型'],
  ['relocation_area_change', '搬迁面积变化'],
  ['new_building', '成交楼宇'],
  ['sub_market', '子市场'],
  ['district', '区域'],
  ['building_grade', '楼宇等级'],
  ['floor_info', '楼座'],
  ['floor', '楼层'],
  ['old_address', '原址楼宇'],
  ['old_sub_market', '原址子市场'],
  ['old_district', '原址区域'],
  ['old_building_grade', '原址等级'],
  ['area_sqm', '成交面积'],
  ['face_rent', '表面租金'],
  ['effective_rent', '有效租金'],
  ['lease_term_months', '租期'],
  ['fit_out_months', '装修期'],
  ['rent_free_months', '免租期'],
  ['is_face_rent_estimated', '表面租金预估'],
  ['is_effective_rent_estimated', '有效租金预估'],
  ['transaction_year', '成交年份'],
  ['transaction_quarter', '成交季度'],
  ['remarks', '备注'],
] as const;

const NUMERIC_FIELDS = new Set([
  'area_sqm',
  'face_rent',
  'effective_rent',
  'lease_term_months',
  'fit_out_months',
  'rent_free_months',
  'transaction_year',
]);

const BOOLEAN_FIELDS = new Set([
  'is_face_rent_estimated',
  'is_effective_rent_estimated',
]);

function normalizeValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null;
  if (NUMERIC_FIELDS.has(key)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  if (BOOLEAN_FIELDS.has(key)) return value === true || value === 'true';
  return typeof value === 'string' ? value.trim() : value;
}

export function formatLeaseFieldValue(key: string, value: unknown): string {
  const normalized = normalizeValue(key, value);
  if (normalized === null) return '—';
  if (BOOLEAN_FIELDS.has(key)) return normalized ? '是' : '否';

  const number = typeof normalized === 'number' ? normalized : Number.NaN;
  if (Number.isFinite(number)) {
    const formatted = number.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    if (key === 'area_sqm') return `${formatted} ㎡`;
    if (key === 'face_rent' || key === 'effective_rent') return `${formatted} 元/㎡/月`;
    if (key === 'lease_term_months' || key === 'fit_out_months' || key === 'rent_free_months') return `${formatted} 个月`;
    return formatted;
  }

  return String(normalized);
}

export function buildLeaseTransactionChanges(
  before: Partial<LeaseTransaction> | Record<string, unknown>,
  after: Partial<LeaseTransaction> | Record<string, unknown>,
): LeaseFieldChange[] {
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;

  return FIELD_CONFIG.flatMap(([key, label]) => {
    const beforeValue = normalizeValue(key, beforeRecord[key]);
    const afterValue = normalizeValue(key, afterRecord[key]);
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) return [];
    return [{
      key,
      label,
      before: beforeValue,
      after: afterValue,
      beforeText: formatLeaseFieldValue(key, beforeValue),
      afterText: formatLeaseFieldValue(key, afterValue),
    }];
  });
}
