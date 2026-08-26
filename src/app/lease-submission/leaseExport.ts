export type LeaseExportRecord = Record<string, unknown>;

type LeaseExportColumn = {
  key: string;
  label: string;
  width: number;
};

// 业务字段按租赁成交填报顺序排列；系统字段放在末尾。
// 该列表覆盖 public.lease_transactions 当前全部 37 个数据库字段。
export const LEASE_EXPORT_COLUMNS: readonly LeaseExportColumn[] = [
  { key: 'company', label: '公司名称', width: 24 },
  { key: 'suspected_company_fullname', label: '疑似企业全称', width: 24 },
  { key: 'enterprise_type', label: '企业类型', width: 12 },
  { key: 'industry', label: '行业', width: 18 },
  { key: 'sub_industry', label: '细分行业', width: 18 },
  { key: 'demand_type', label: '需求类型', width: 12 },

  { key: 'new_building', label: '成交楼宇', width: 24 },
  { key: 'floor_info', label: '楼座', width: 12 },
  { key: 'floor', label: '楼层', width: 10 },
  { key: 'sub_market', label: '子市场', width: 14 },
  { key: 'district', label: '行政区', width: 12 },
  { key: 'building_grade', label: '楼宇级别', width: 12 },

  { key: 'old_address', label: '搬迁原址', width: 28 },
  { key: 'old_sub_market', label: '原址子市场', width: 14 },
  { key: 'old_district', label: '原址行政区', width: 12 },
  { key: 'old_building_grade', label: '原址楼宇级别', width: 14 },
  { key: 'relocation_area_change', label: '搬迁面积变化', width: 16 },

  { key: 'area_sqm', label: '成交面积（㎡）', width: 16 },
  { key: 'face_rent', label: '表面租金（元/㎡/月）', width: 22 },
  { key: 'is_face_rent_estimated', label: '表面租金是否预估', width: 18 },
  { key: 'lease_term_months', label: '租期（月）', width: 12 },
  { key: 'fit_out_months', label: '装修期（月）', width: 14 },
  { key: 'rent_free_months', label: '免租期（月）', width: 14 },
  { key: 'effective_rent', label: '有效租金（元/㎡/月）', width: 22 },
  { key: 'is_effective_rent_estimated', label: '有效租金是否预估', width: 18 },

  { key: 'transaction_year', label: '成交年份', width: 12 },
  { key: 'transaction_quarter', label: '成交季度', width: 12 },
  { key: 'transaction_date', label: '成交日期（历史字段）', width: 18 },
  { key: 'remarks', label: '备注', width: 32 },

  { key: 'data_source', label: '数据来源', width: 14 },
  { key: 'submitter_name', label: '提交人', width: 16 },
  { key: 'submitter_id', label: '提交人 ID', width: 38 },
  { key: 'original_submitter_name', label: '原始提交人', width: 16 },
  { key: 'original_submitter_id', label: '原始提交人 ID', width: 38 },
  { key: 'created_at', label: '填报时间', width: 22 },
  { key: 'updated_at', label: '更新时间', width: 22 },
  { key: 'id', label: '记录 ID', width: 38 },
] as const;

const BOOLEAN_KEYS = new Set([
  'is_face_rent_estimated',
  'is_effective_rent_estimated',
]);

const TIMESTAMP_KEYS = new Set(['created_at', 'updated_at']);

function formatShanghaiDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function exportValue(key: string, value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (BOOLEAN_KEYS.has(key)) return value === true ? '是' : value === false ? '否' : String(value);
  if (TIMESTAMP_KEYS.has(key)) return formatShanghaiDateTime(value);
  if (key === 'data_source' && value === 'broker_submission') return '业务员填报';
  if (typeof value === 'number') return value;
  return String(value);
}

export function buildLeaseExportRows(records: LeaseExportRecord[]): Array<Array<string | number>> {
  return [
    LEASE_EXPORT_COLUMNS.map((column) => column.label),
    ...records.map((record) =>
      LEASE_EXPORT_COLUMNS.map((column) => exportValue(column.key, record[column.key])),
    ),
  ];
}

export function leaseExportColumnWidths(): Array<{ wch: number }> {
  return LEASE_EXPORT_COLUMNS.map((column) => ({ wch: column.width }));
}

export function leaseExportFileName(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `租赁成交全量数据_${get('year')}${get('month')}${get('day')}_${get('hour')}${get('minute')}${get('second')}.xlsx`;
}
