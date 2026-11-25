import { cellText, type DisplayCell, type QueryResultView } from './presentation';
import { z } from 'zod';

export const resultTableViewSchema = z.strictObject({ version: z.literal('result-table-view/1'),
  sort: z.strictObject({ key: z.string().min(1).max(100), direction: z.enum(['asc', 'desc']) }).nullable().default(null),
  filters: z.array(z.strictObject({ key: z.string().min(1).max(100), value: z.string().max(100),
    operator: z.enum(['eq', 'gte', 'lte']).optional() })).max(10).default([]), page: z.number().int().min(0).max(4000).default(0) });
export type ResultTableReference = { parameters: Readonly<Record<string, unknown>>; table: { columns: readonly { key: string; label: string; unit: string | null }[] } };
export type ResultTableView = z.infer<typeof resultTableViewSchema>;
export function validatedResultTableView(result: ResultTableReference, input: unknown): ResultTableView {
  const view = resultTableViewSchema.parse(input);
  for (const key of [view.sort?.key, ...view.filters.map(f => f.key)].filter(Boolean)) {
    if (!result.table.columns.some(c => c.key === key)) throw new Error('AGENT_FIELD_NOT_AVAILABLE');
  }
  for (const filter of view.filters) if (filter.operator && filter.operator !== 'eq') {
    if (!Number.isFinite(Number(filter.value)) || result.table.columns.find(c => c.key === filter.key)?.unit === null) throw new Error('AGENT_INVALID_TOOL_ARGUMENTS');
  }
  return view;
}
export function restoredResultTableView(result: ResultTableReference): ResultTableView {
  try { return validatedResultTableView(result, result.parameters.agentTableView); }
  catch { return { version: 'result-table-view/1', sort: null, filters: [], page: 0 }; }
}

export type TableSort = { key: string; direction: 'asc' | 'desc' } | null;
export function compareDisplayCells(a: DisplayCell, b: DisplayCell): number {
  if (a.kind === 'unknown' || b.kind === 'unknown') return a.kind === b.kind ? 0 : a.kind === 'unknown' ? 1 : -1;
  if (a.kind === 'number' && b.kind === 'number') {
    const left = BigInt(a.value.exact.numerator) * BigInt(b.value.exact.denominator);
    const right = BigInt(b.value.exact.numerator) * BigInt(a.value.exact.denominator);
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return (a.kind === 'text' ? a.value : '').localeCompare(b.kind === 'text' ? b.value : '', 'zh-CN', { numeric: true });
}
export const gradeLabel = (value: string) => ({ A: '甲级', B: '乙级' }[value] ?? value);
export function tableCellText(cell: DisplayCell, key: string, unit: string | null): string {
  return key === 'grade' && cell.kind === 'text' ? gradeLabel(cell.value) : cellText(cell, unit);
}
export type TableFilter = { key: string; value: string; operator?: 'eq' | 'gte' | 'lte' };
const searchIndexes = new WeakMap<QueryResultView, string[]>();
function searchIndex(result: QueryResultView) {
  let index = searchIndexes.get(result);
  if (!index) {
    index = result.table.rows.map(row => result.table.columns.map(column => tableCellText(row.cells[column.key], column.key, column.unit).toLocaleLowerCase()).join('\u0000'));
    searchIndexes.set(result, index);
  }
  return index;
}
export function tableRowIndexes(result: QueryResultView, search: string, filter: TableFilter | readonly TableFilter[] | null, sort: TableSort): number[] {
  const query = search.trim().toLocaleLowerCase();
  const filters: readonly TableFilter[] = !filter ? [] : 'key' in filter ? [filter] : filter;
  const text = query ? searchIndex(result) : [];
  const indexes = result.table.rows.flatMap((row, index) => {
    if (filters.some(item => {
      const cell = row.cells[item.key];
      if (!cell) return true;
      if (item.operator === 'gte' || item.operator === 'lte') return cell.kind !== 'number'
        || !Number.isFinite(Number(item.value)) || (item.operator === 'gte' ? cell.value.numeric < Number(item.value) : cell.value.numeric > Number(item.value));
      return tableCellText(cell, item.key, null) !== item.value;
    })) return [];
    return !query || text[index].includes(query) ? [index] : [];
  });
  if (sort) indexes.sort((a, b) => {
    const left = result.table.rows[a].cells[sort.key], right = result.table.rows[b].cells[sort.key];
    const compared = compareDisplayCells(left, right);
    return (left.kind === 'unknown' || right.kind === 'unknown' ? compared : compared * (sort.direction === 'asc' ? 1 : -1)) || a - b;
  });
  return indexes;
}
