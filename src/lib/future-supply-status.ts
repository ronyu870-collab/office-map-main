/** A mapped project whose use and market-entry status have not been verified. */
export const PENDING_FUTURE_SUPPLY_STATUS = 'pending';

export function isPendingFutureSupply(supply: { status?: unknown }): boolean {
  return supply.status === PENDING_FUTURE_SUPPLY_STATUS;
}
