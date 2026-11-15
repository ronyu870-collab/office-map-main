/** Exact arithmetic over database decimal representations; rounding belongs to presentation. */
export type ExactNumber = Readonly<{ numerator: string; denominator: string }>;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

function gcd(a: bigint, b: bigint): bigint {
  a = a < ZERO ? -a : a;
  b = b < ZERO ? -b : b;
  while (b !== ZERO) [a, b] = [b, a % b];
  return a;
}

export class Decimal {
  private constructor(readonly numerator: bigint, readonly denominator: bigint) {}

  static fraction(numerator: bigint, denominator: bigint): Decimal {
    if (denominator === ZERO) throw new Error('ZERO_DENOMINATOR');
    const sign = denominator < ZERO ? -ONE : ONE;
    const divisor = gcd(numerator, denominator);
    return new Decimal(numerator / divisor * sign, denominator / divisor * sign);
  }

  static parse(input: unknown): Decimal | null {
    if (typeof input !== 'string' && typeof input !== 'number') return null;
    if (typeof input === 'number' && !Number.isFinite(input)) return null;
    const value = String(input).trim();
    if (value.length > 100) return null;
    const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(value);
    if (!match) return null;
    const fractional = match[3] ?? '';
    const exponent = Number(match[4] ?? 0) - fractional.length;
    // Bound untrusted exponents and precision before allocating a bigint.
    if (Math.abs(exponent) > 80 || match[2].length + fractional.length > 80) return null;
    const coefficient = BigInt(`${match[1] === '-' ? '-' : ''}${match[2]}${fractional}`);
    return exponent >= 0
      ? Decimal.fraction(coefficient * TEN ** BigInt(exponent), ONE)
      : Decimal.fraction(coefficient, TEN ** BigInt(-exponent));
  }

  static zero(): Decimal { return Decimal.fraction(ZERO, ONE); }
  add(other: Decimal): Decimal {
    return Decimal.fraction(this.numerator * other.denominator + other.numerator * this.denominator, this.denominator * other.denominator);
  }
  subtract(other: Decimal): Decimal {
    return Decimal.fraction(this.numerator * other.denominator - other.numerator * this.denominator, this.denominator * other.denominator);
  }
  multiply(other: Decimal): Decimal {
    return Decimal.fraction(this.numerator * other.numerator, this.denominator * other.denominator);
  }
  divide(other: Decimal): Decimal {
    return Decimal.fraction(this.numerator * other.denominator, this.denominator * other.numerator);
  }
  compare(other: Decimal): number {
    const difference = this.numerator * other.denominator - other.numerator * this.denominator;
    return difference < ZERO ? -1 : difference > ZERO ? 1 : 0;
  }
  exact(): ExactNumber { return { numerator: this.numerator.toString(), denominator: this.denominator.toString() }; }
  /** Approximate projection for chart libraries only. Never feed this back into calculations. */
  toNumber(): number {
    const result = Number(this.numerator) / Number(this.denominator);
    if (!Number.isFinite(result)) throw new Error('NUMERIC_PROJECTION_OVERFLOW');
    return result;
  }
}
