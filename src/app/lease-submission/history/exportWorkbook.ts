type Cell = string | number | null;
export const HISTORY_EXPORT_COLUMNS = [
  ['company', '企业', 32],
  ['new_building', '楼宇（原始成交名称）', 30],
  ['record_source', '来源', 14],
  ['building_match_scope', '楼宇关联范围', 16],
  ['industry', '行业', 20],
  ['sub_industry', '子行业', 20],
  ['sub_market', '子市场', 18],
  ['district', '行政区', 16],
  ['demand_type', '需求类型', 16],
  ['transaction_year', '成交年份', 12],
  ['transaction_quarter', '成交季度', 12],
  ['transaction_period', '成交期间', 17],
  ['area_sqm', '面积（㎡）', 16],
  ['face_rent', '表面租金（元/㎡/月）', 24],
  ['effective_rent', '净有效租金（元/㎡/月）', 25],
  ['lease_term_months', '租期（月）', 14],
  ['agency_company', '代理公司', 25],
  ['agency_person', '代理人员', 16],
  ['remarks', '备注', 40],
] as const;

export type HistoryExportRow = Partial<Record<(typeof HISTORY_EXPORT_COLUMNS)[number][0], Cell>>;

export async function createHistoryWorkbook(records: HistoryExportRow[], scope: string) {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.aoa_to_sheet([
    HISTORY_EXPORT_COLUMNS.map(([, label]) => label),
    ...records.map(row => HISTORY_EXPORT_COLUMNS.map(([key]) => {
      if (key === 'record_source') return row[key] === 'live' ? '系统成交' : row[key] === 'history' ? '归档历史' : null;
      if (key === 'building_match_scope') {
        return ({ exact: '楼宇', project: '项目', reference: '历史参考', unmapped: '未关联' } as Record<string, string>)[String(row[key])] ?? null;
      }
      return row[key] ?? null;
    })),
  ]);
  worksheet['!cols'] = HISTORY_EXPORT_COLUMNS.map(([, , wch]) => ({ wch }));
  worksheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(HISTORY_EXPORT_COLUMNS.length - 1)}${records.length + 1}` };
  const manifest = XLSX.utils.aoa_to_sheet([['筛选范围', scope], ['实际记录数', records.length], ['导出时间', new Date().toISOString()]]);
  manifest['!cols'] = [{ wch: 18 }, { wch: 75 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, worksheet, '筛选成交');
  XLSX.utils.book_append_sheet(book, manifest, '导出范围');
  return { XLSX, book };
}
