import type { Candidate } from './contracts';

const DAY = 86_400_000;
function dateValue(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(result) && new Date(result).toISOString().slice(0, 10) === value ? result : null;
}

/** Display only: the authorized server remains the source of the estimated dates. */
export function expiryBar(start: string | null, end: string | null, asOf: string, windowEnd: string) {
  const a = dateValue(start), b = dateValue(end), from = dateValue(asOf), until = dateValue(windowEnd);
  if (a === null || b === null || from === null || until === null || b < a || until <= from || a >= until || b + DAY <= from) return null;
  return {
    left: (Math.max(a, from) - from) / (until - from) * 100,
    width: (Math.min(b + DAY, until) - Math.max(a, from)) / (until - from) * 100,
    point: a === b, before: a < from, after: b + DAY > until,
  };
}

export function expiryMonths(asOf: string, windowEnd: string) {
  const from = dateValue(asOf), until = dateValue(windowEnd);
  if (from === null || until === null || until <= from) return [];
  const current = new Date(from), result: { key: string; label: string; left: number }[] = [];
  current.setUTCDate(1);
  while (current.getTime() < until && result.length < 13) {
    const month = current.getUTCMonth() + 1;
    result.push({ key: current.toISOString().slice(0, 7), label: month === 1 ? `${current.getUTCFullYear()}/1月` : `${month}月`, left: Math.max(0, (current.getTime() - from) / (until - from) * 100) });
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return result;
}

export function expiryLabel(start: string | null, end: string | null) {
  const a = dateValue(start), b = dateValue(end);
  if (a === null || b === null || b < a) return '暂无法估算';
  if (a === b) return start!.replaceAll('-', '.');
  const first = new Date(a), last = new Date(b), year = first.getUTCFullYear(), month = first.getUTCMonth();
  const fullEndMonth = last.getUTCDate() === new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)).getUTCDate();
  if (first.getUTCDate() === 1 && fullEndMonth && year === last.getUTCFullYear()) {
    if (month === last.getUTCMonth()) return `${year} 年 ${month + 1} 月`;
    if (month % 3 === 0 && last.getUTCMonth() === month + 2) return `${year} 年第${['一', '二', '三', '四'][month / 3]}季度`;
  }
  return `${start!.replaceAll('-', '.')} — ${end!.replaceAll('-', '.')}`;
}

export function expiryNeedsReview(item: Candidate) {
  return item.has_later_name_match || item.review?.status === 'source_conflict' || Boolean(item.review && item.review.source_fingerprint !== item.source_fingerprint);
}
