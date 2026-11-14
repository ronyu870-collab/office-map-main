/** Display rounding only; never calculates using the approximate chart projection. */
export function formatExact(value: {exact:{numerator:string;denominator:string};numeric:number}, unit: string | null): string {
  const numerator = BigInt(value.exact.numerator) * BigInt(unit === 'ratio' ? 100 : 1);
  const denominator = BigInt(value.exact.denominator);
  const negative = numerator < BigInt(0), absolute = negative ? -numerator : numerator;
  const rounded = (absolute * BigInt(100) * BigInt(2) + denominator) / (denominator * BigInt(2));
  const whole = rounded / BigInt(100), fraction = (rounded % BigInt(100)).toString().padStart(2, '0').replace(/0+$/, '');
  return `${negative && rounded !== BigInt(0) ? '-' : ''}${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? '.' + fraction : ''}`;
}
