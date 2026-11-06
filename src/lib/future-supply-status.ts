/** A mapped project whose use and market-entry status have not been verified. */
export const PENDING_FUTURE_SUPPLY_STATUS = 'pending';

export function isPendingFutureSupply(supply: { status?: unknown }): boolean {
  return supply.status === PENDING_FUTURE_SUPPLY_STATUS;
}

/** A supply whose project has since entered the market and lives in the stock list. */
export function isEnteredFutureSupply(supply: { is_entered_market?: unknown }): boolean {
  return supply.is_entered_market === true;
}
