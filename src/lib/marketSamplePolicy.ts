/** Same-quarter formal research policy. Current-state map estimates are a
 * separate product: they may include zero rent and a vacancy-ratio estimate.
 * Do not mix that projection into published-quarter comparisons. */
export const FORMAL_QUARTER_SAMPLE_POLICY = {
  version: 'formal-quarter-samples/1',
  positiveArea: true,
  positiveRent: true,
  vacantAreaNonnegative: true,
  deriveVacancyFromRatio: false,
} as const;

export function formalQuarterRentEligible(area: number, rent: number) {
  return Number.isFinite(area) && area > 0 && Number.isFinite(rent) && rent > 0;
}
export function formalQuarterVacancyEligible(area: number, vacant: number) {
  return Number.isFinite(area) && area > 0 && Number.isFinite(vacant) && vacant >= 0 && vacant <= area;
}
