/** Shared whole-record selection for quarterly reporting and trusted AI reads. */
export interface VersionedQuarterRow {
  id: string | number;
  building_id: string;
  record_year: number;
  record_quarter: number;
  created_at: string;
  updated_at?: string | null;
}
// PostgreSQL timestamps can differ within a millisecond. Do not truncate that ordering.
function timestamp(value: string): [number, string] {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('提交时间缺失或无效，无法确定最新记录');
  const fraction = (value.match(/:\d{2}\.(\d+)/)?.[1] ?? '').padEnd(9, '0');
  return [Math.floor(ms / 1000), fraction];
}
export function compareTime(a: string, b: string): number {
  const aa = timestamp(a), bb = timestamp(b);
  return aa[0] - bb[0] || aa[1].localeCompare(bb[1]);
}
export function compareId(a: string | number, b: string | number): number {
  const aa = String(a), bb = String(b);
  if (/^\d+$/.test(aa) && /^\d+$/.test(bb)) return aa.length - bb.length || aa.localeCompare(bb);
  return aa.localeCompare(bb);
}
/** Pick an entire record, across all submitters. Never backfill individual fields. */
export function latestRows<T extends VersionedQuarterRow>(rows: readonly T[], historical = false): T[] {
  const winners = new Map<string, T>();
  for (const row of rows) {
    if (!row.building_id || row.id == null) throw new Error('记录缺少楼宇或记录标识，无法去重');
    const time = historical ? row.updated_at || row.created_at : row.created_at;
    timestamp(time);
    const key = `${row.record_year}:${row.record_quarter}:${row.building_id}`;
    const old = winners.get(key);
    if (!old || (compareTime(time, historical ? old.updated_at || old.created_at : old.created_at) || compareId(row.id, old.id)) > 0) winners.set(key, row);
  }
  return [...winners.values()];
}
