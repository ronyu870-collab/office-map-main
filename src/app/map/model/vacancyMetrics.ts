/**
 * building_metrics stores vacancy_rate as a fraction (0..1). In map memory,
 * NaN represents missing observations while zero remains a real zero.
 * quarterly_submissions uses percent units and is deliberately not handled here.
 */
export function mapOptionalNumber(input: unknown): number {
  if (input === null || input === undefined || (typeof input === 'string' && input.trim() === '')) {
    return Number.NaN;
  }
  const value = typeof input === 'number' ? input : typeof input === 'string' ? Number(input.trim()) : Number.NaN;
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Use physical vacant area when known; otherwise derive an aggregate-only
 * estimate from a valid vacancy fraction and building area. Never write it
 * back to Supabase or treat unknown values as 0% vacancies.
 */
export function observedVacantArea(
  metric: { total_area?: unknown; vacant_area?: unknown; vacancy_rate?: unknown } | null | undefined,
): number {
  const area = mapOptionalNumber(metric?.total_area);
  if (!(area > 0)) return Number.NaN;
  const vacant = mapOptionalNumber(metric?.vacant_area);
  if (Number.isFinite(vacant) && vacant >= 0 && vacant <= area) return vacant;
  const rate = mapOptionalNumber(metric?.vacancy_rate);
  return rate >= 0 && rate <= 1 ? area * rate : Number.NaN;
}
