import type { NumericCondition } from '@/src/components/SidebarFilter';

/** Conditions narrow the current map collection; missing facts cannot match. */
export function matchesMapConditions(
  conditions: NumericCondition[] | undefined,
  read: (field: NumericCondition['field']) => unknown,
): boolean {
  return (conditions ?? []).every(condition => {
    const value = condition.value;
    if (value === '' || value === null || value === undefined) return true;
    if (condition.field === 'owner' || condition.field === 'property_management') {
      const query = String(value).trim().toLowerCase();
      return !query || String(read(condition.field) ?? '').toLowerCase().includes(query);
    }
    const threshold = Number(value);
    if (Number.isNaN(threshold)) return true;
    const raw = read(condition.field);
    if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return false;
    if (typeof raw !== 'number' && typeof raw !== 'string') return false;
    let actual = Number(raw);
    if (!Number.isFinite(actual)) return false;
    if (condition.field === 'vacancy_rate') actual *= 100;
    switch (condition.operator) {
      case '>=': return actual >= threshold;
      case '<=': return actual <= threshold;
      case '=': return actual === threshold;
      case '>': return actual > threshold;
      case '<': return actual < threshold;
    }
  });
}
