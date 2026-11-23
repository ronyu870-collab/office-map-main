const explicitNegative = new Set(['N', 'NO', 'NONE', 'FALSE', 'NOT CERTIFIED', 'UNCERTIFIED', '未认证', '无认证', '无', '否']);
const unavailable = new Set(['', 'NULL', 'UNKNOWN', 'N/A', '-', '—']);
/** A missing observation is not evidence that a project is uncertified. */
export function leedFallbackBadge(value: unknown): 'N' | '–' {
  return explicitNegative.has(String(value ?? '').trim().toUpperCase()) ? 'N' : '–';
}
export function leedDisplayValue(value: unknown): string {
  const text = String(value ?? '').trim();
  const key = text.toUpperCase();
  if (unavailable.has(key)) return '未提供';
  return explicitNegative.has(key) ? '未认证' : text;
}
