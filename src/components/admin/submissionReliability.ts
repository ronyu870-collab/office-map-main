export interface PageResult<T> { data: T[] | null; error: { message?: string } | null; }

/** Continue to an empty page: server row caps can be smaller than our page size. */
export async function fetchAllSubmissionPages<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>, signal?: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    signal?.throwIfAborted();
    const result = await fetchPage(rows.length, rows.length + 499);
    signal?.throwIfAborted();
    if (result.error) throw new Error(result.error.message || '读取失败');
    if (!result.data) throw new Error('数据响应不完整');
    if (result.data.length === 0) return rows;
    if (rows.length + result.data.length > 100_000) throw new Error('结果超过安全读取上限，无法确认完整性；请缩小筛选范围');
    rows.push(...result.data);
  }
}

export function parseSubmissionPeriod(rows: { key: string; value: unknown }[]) {
  const year = Number(rows.find(r => r.key === 'current_submission_year')?.value);
  const quarter = Number(rows.find(r => r.key === 'current_submission_quarter')?.value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new Error('当前填报季度配置无效');
  return { year, quarter };
}

const FIELD_LABELS: Record<string, string> = { qQuote: '报价', qProp: '物业费', qFace: '面租', qFree: '免租期', qVacArea: '空置面积', qOwner: '业主', qPropMan: '物业', qRemark: '备注' };
export interface AdminDraftEntry { id: string; kind: 'regular' | 'future'; values: Record<string, string | number | boolean>; }
export function draftEntries(value: unknown): AdminDraftEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const result: AdminDraftEntry[] = [];
  function collect(source: unknown, kind: AdminDraftEntry['kind']) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    for (const [id, row] of Object.entries(source)) {
      if (id === '__futureSupply__' || id === '__quarterly_meta__' || !row || typeof row !== 'object' || Array.isArray(row)) continue;
      const values = Object.fromEntries(Object.entries(row).filter(([key, v]) => key in FIELD_LABELS && ((typeof v === 'string' && v.trim() !== '') || typeof v === 'number' || typeof v === 'boolean')));
      if (Object.keys(values).length) result.push({ id, kind, values: values as AdminDraftEntry['values'] });
    }
  }
  collect(value, 'regular');
  collect((value as Record<string, unknown>).__futureSupply__, 'future');
  return result;
}
export function summarizeAdminDraft(value: unknown) {
  const entries = draftEntries(value);
  return { buildings: entries.length, fields: [...new Set(entries.flatMap(r => Object.keys(r.values).map(k => FIELD_LABELS[k] || k)))].join('、') || '-' };
}
export function draftProjectLabel(entry: AdminDraftEntry, buildings: Record<string, string> = {}, future: Record<string, string> = {}) {
  const name = (entry.kind === 'future' ? future : buildings)[entry.id];
  return `${entry.kind === 'future' ? '未来供应 · ' : ''}${name || (/^\d+$/.test(entry.id) ? `历史序号 ${Number(entry.id) + 1}（无法确认项目）` : `未找到项目（${entry.id}）`)}`;
}

export async function submissionPageResult<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>, signal?: AbortSignal) {
  const data = await fetchAllSubmissionPages(fetchPage, signal);
  return { data, error: null, count: data.length };
}
