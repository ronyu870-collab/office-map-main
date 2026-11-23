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

/** Canonical filter identity; keep explicit negative observations separate from missing data. */
export function leedFilterValue(value: unknown): string {
  const text = String(value ?? '').trim();
  const key = text.toUpperCase();
  if (unavailable.has(key)) return 'NULL';
  if (explicitNegative.has(key)) return 'N';
  const level = ['Platinum', 'Gold', 'Silver'].find(item => item.toUpperCase() === key);
  return level ?? text;
}

/** Preserve named certifications while rejecting known missing and negative observations. */
export function hasLeedCertification(value: unknown): boolean {
  const key = leedFilterValue(value);
  return key !== 'NULL' && key !== 'N';
}

export function leedFilterLabel(value: string): string {
  return value === 'NULL' ? '未提供认证' : value === 'N' ? '未认证（N）' : value;
}

/** The former full catalog had no way to include N; preserve newer explicit exclusions. */
export function restoreLeedFilterCatalog<T extends { leeds: string[] }>(filters: T | null, version?: number): T | null {
  const former = ['Platinum', 'Gold', 'Silver', 'NULL'];
  return filters && version !== 2 && filters.leeds.length === former.length && former.every(value => filters.leeds.includes(value))
    ? { ...filters, leeds: [...filters.leeds, 'N'] } : filters;
}
