const leaseRentFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Display only: callers retain the original numeric value for edits and calculations. */
export function formatLeaseRent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : leaseRentFormatter.format(value);
}
