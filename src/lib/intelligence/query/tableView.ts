import { cellText, type DisplayCell, type QueryResultView } from './presentation';

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
export type TableFilter = { key: string; value: string };
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
    if (filters.some(item => !row.cells[item.key] || tableCellText(row.cells[item.key], item.key, null) !== item.value)) return [];
    return !query || text[index].includes(query) ? [index] : [];
  });
  if (sort) indexes.sort((a, b) => {
    const left = result.table.rows[a].cells[sort.key], right = result.table.rows[b].cells[sort.key];
    const compared = compareDisplayCells(left, right);
    return (left.kind === 'unknown' || right.kind === 'unknown' ? compared : compared * (sort.direction === 'asc' ? 1 : -1)) || a - b;
  });
  return indexes;
}
