/** A mapped project whose use and market-entry status have not been verified. */
export const PENDING_FUTURE_SUPPLY_STATUS = 'pending';

export function isPendingFutureSupply(supply: { status?: unknown }): boolean {
  return supply.status === PENDING_FUTURE_SUPPLY_STATUS;
}

/** A supply whose project has since entered the market and lives in the stock list. */
export function isEnteredFutureSupply(supply: { is_entered_market?: unknown }): boolean {
  return supply.is_entered_market === true;
}

/** One display rule for map lists and details; pending status takes precedence. */
export function futureSupplyDate(supply: { status?: unknown; launch_year?: unknown; launch_quarter?: unknown }): string {
  if (isPendingFutureSupply(supply)) return '待核实';
  const year = Number(supply.launch_year);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return '待定';
  const quarter = String(supply.launch_quarter ?? '').trim().toUpperCase();
  return /^Q[1-4]$/.test(quarter) ? `${year}年 ${quarter}` : `${year}年`;
}
