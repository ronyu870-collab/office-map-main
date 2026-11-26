import { mapOptionalNumber } from './vacancyMetrics';

export const MARKET_CONTRACT_VERSION = 'map-market/1';
export type QuarterlyFact = {
  id?: unknown;
  record_year?: unknown;
  record_quarter?: unknown;
  is_draft?: boolean | null;
  is_locked?: boolean | null;
  updated_at?: string | null;
  created_at?: string | null;
  data_source?: string | null;
};

export function quarterKey(row: QuarterlyFact): number | null {
  const year = mapOptionalNumber(row.record_year), quarter = mapOptionalNumber(row.record_quarter);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 && Number.isInteger(quarter) && quarter >= 1 && quarter <= 4
    ? year * 4 + quarter - 1 : null;
}

export function isFormalQuarterlyFact(row: QuarterlyFact): boolean {
  return row.is_locked === true && row.is_draft !== true && quarterKey(row) !== null;
}

const timestamp = (input: string | null | undefined) => {
  const value = Date.parse(input ?? '');
  return Number.isFinite(value) ? value : -Infinity;
};

/** Total ordering shared by latest-state and same-quarter selection. */
export function compareQuarterlyFacts(a: QuarterlyFact, b: QuarterlyFact): number {
  const period = (quarterKey(a) ?? -Infinity) - (quarterKey(b) ?? -Infinity);
  if (period) return period;
  const locked = Number(a.is_locked === true) - Number(b.is_locked === true);
  if (locked) return locked;
  for (const field of ['updated_at', 'created_at'] as const) {
    if (timestamp(a[field]) !== timestamp(b[field])) return timestamp(a[field]) > timestamp(b[field]) ? 1 : -1;
  }
  const left = String(a.id ?? ''), right = String(b.id ?? '');
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) return BigInt(left) > BigInt(right) ? 1 : BigInt(left) < BigInt(right) ? -1 : 0;
  return left > right ? 1 : left < right ? -1 : 0;
}

export function latestFormalMetric<T extends QuarterlyFact>(rows: readonly T[] | null | undefined): T | null {
  let latest: T | null = null;
  for (const row of rows ?? []) {
    if (!isFormalQuarterlyFact(row)) continue;
    if (!latest || compareQuarterlyFacts(row, latest) > 0) latest = row;
  }
  return latest;
}
