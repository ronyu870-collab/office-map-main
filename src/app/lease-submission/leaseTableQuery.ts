import type { LeaseTransaction } from '@/src/types/lease-transaction';

export const LEASE_TABLE_FIELDS = {
  company: { label: '公司名称', type: 'text' },
  suspectedCompanyFullname: { label: '疑似全称', type: 'text' },
  enterpriseType: { label: '企业类型', type: 'category' },
  industry: { label: '行业分类', type: 'category' },
  demandType: { label: '需求类型', type: 'category' },
  building: { label: '成交楼宇', type: 'text' },
  subMarket: { label: '子市场', type: 'category' },
  district: { label: '行政区', type: 'category' },
  grade: { label: '级别', type: 'category' },
  area: { label: '成交面积', type: 'number' },
  faceRent: { label: '表面租金', type: 'number' },
  effectiveRent: { label: '有效租金', type: 'number' },
  year: { label: '成交年份', type: 'category' },
  quarter: { label: '成交季度', type: 'period' },
  submitter: { label: '提交人', type: 'category' },
} as const;

export type LeaseColumnKey = keyof typeof LEASE_TABLE_FIELDS;
export type LeaseColumnFilter = { search?: string; values?: string[]; min?: string; max?: string };
export type LeaseTableFilters = Partial<Record<LeaseColumnKey, LeaseColumnFilter>>;
export type LeaseTableSort = { key: LeaseColumnKey; direction: 'asc' | 'desc' } | null;
export type LeaseFilterOption = { value: string; label: string };

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const gradeOrder = ['超甲级', '甲级', '乙级', '产业园'];

function text(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

/** Accept both current Qn and historical YYYYQn without comparing quarter labels alone. */
export function leasePeriod(row: LeaseTransaction): string | null {
  const match = /^(?:(\d{4}))?Q([1-4])$/i.exec(row.transaction_quarter?.trim() ?? '');
  if (!match) return null;
  const year = row.transaction_year > 0 ? row.transaction_year : Number(match[1]);
  return Number.isInteger(year) && year > 0 ? `${year}Q${match[2]}` : null;
}

export function leaseColumnValue(row: LeaseTransaction, key: LeaseColumnKey): string | number | null {
  switch (key) {
    case 'company': return text(row.company);
    case 'suspectedCompanyFullname': return text(row.suspected_company_fullname);
    case 'enterpriseType': return text(row.enterprise_type);
    case 'industry': return text(row.industry);
    case 'demandType': return text(row.demand_type);
    case 'building': return text(row.new_building);
    case 'subMarket': return text(row.sub_market);
    case 'district': return text(row.district);
    case 'grade': return text(row.building_grade);
    case 'area': return finite(row.area_sqm);
    case 'faceRent': return finite(row.face_rent);
    case 'effectiveRent': return finite(row.effective_rent);
    case 'year': return row.transaction_year > 0 ? finite(row.transaction_year) : null;
    case 'quarter': return leasePeriod(row);
    case 'submitter': return text(row.submitter_id);
  }
}

export function isLeaseFilterActive(filter?: LeaseColumnFilter): boolean {
  return Boolean(filter?.search?.trim() || filter?.values !== undefined || filter?.min || filter?.max);
}

export function leaseFilterOptions(rows: LeaseTransaction[], key: LeaseColumnKey): LeaseFilterOption[] {
  const options = new Map<string, string>();
  for (const row of rows) {
    // Picker scope follows the visible records, regardless of account activity metadata.
    const value = leaseColumnValue(row, key);
    const label = key === 'submitter' ? text(row.submitter_name) : value;
    options.set(value == null ? '' : String(value), label == null ? '未填写' : String(label));
  }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => {
    if (a.value === b.value) return 0;
    if (a.value === '') return 1;
    if (b.value === '') return -1;
    return collator.compare(a.label, b.label);
  });
}

export function leaseFilterSummary(key: LeaseColumnKey, filter: LeaseColumnFilter, options: LeaseFilterOption[]): string {
  const parts: string[] = [];
  if (filter.search?.trim()) parts.push(`包含“${filter.search.trim()}”`);
  if (filter.values !== undefined) {
    parts.push(filter.values.length ? filter.values.map((value) => options.find((option) => option.value === value)?.label ?? value).join('、') : '未选择任何值');
  }
  if (filter.min || filter.max) {
    const unit = key === 'area' ? ' ㎡' : LEASE_TABLE_FIELDS[key].type === 'number' ? ' 元/㎡/月' : '';
    parts.push(`${filter.min || '不限'}—${filter.max || '不限'}${unit}`);
  }
  return parts.join('；');
}

export function queryLeaseTable(rows: LeaseTransaction[], filters: LeaseTableFilters, sort: LeaseTableSort): LeaseTransaction[] {
  const filtered = rows.filter((row) => (Object.entries(filters) as [LeaseColumnKey, LeaseColumnFilter][]).every(([key, filter]) => {
    if (!isLeaseFilterActive(filter)) return true;
    const value = leaseColumnValue(row, key);
    const searchableValue = key === 'submitter' ? text(row.submitter_name) : value;
    if (filter.search?.trim() && !String(searchableValue ?? '').toLocaleLowerCase('zh-CN').includes(filter.search.trim().toLocaleLowerCase('zh-CN'))) return false;
    if (filter.values !== undefined && !filter.values.includes(value == null ? '' : String(value))) return false;
    if (filter.min || filter.max) {
      if (value == null) return false;
      if (LEASE_TABLE_FIELDS[key].type === 'number') {
        if (filter.min && Number(value) < Number(filter.min)) return false;
        if (filter.max && Number(value) > Number(filter.max)) return false;
      } else {
        if (filter.min && collator.compare(String(value), filter.min) < 0) return false;
        if (filter.max && collator.compare(String(value), filter.max) > 0) return false;
      }
    }
    return true;
  }));
  if (!sort) return filtered;
  return filtered.sort((a, b) => {
    const av = sort.key === 'submitter' ? text(a.submitter_name) : leaseColumnValue(a, sort.key);
    const bv = sort.key === 'submitter' ? text(b.submitter_name) : leaseColumnValue(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    let compared: number;
    if (typeof av === 'number' && typeof bv === 'number') compared = av - bv;
    else if (sort.key === 'grade') {
      const ai = gradeOrder.indexOf(String(av));
      const bi = gradeOrder.indexOf(String(bv));
      compared = (ai < 0 ? gradeOrder.length : ai) - (bi < 0 ? gradeOrder.length : bi)
        || collator.compare(String(av), String(bv));
    } else compared = collator.compare(String(av), String(bv));
    // Stable ties retain the server's original record order. Never mutate the input rows.
    return sort.direction === 'asc' ? compared : -compared;
  });
}
