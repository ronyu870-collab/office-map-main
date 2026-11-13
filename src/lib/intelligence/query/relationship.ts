import { aggregateQuarter } from './analytics';
import { assertComplete, type FactSnapshot, type NumericOutput } from './contracts';
import { Decimal } from './decimal';

const from = (value: NumericOutput) => Decimal.fraction(BigInt(value.exact.numerator), BigInt(value.exact.denominator));

/** Round sqrt of a nonnegative rational to 6 decimal places with integer
 * arithmetic. This is explicitly an approximation, never an exact Pearson r. */
function signedRoot6(square: Decimal, sign: number): number {
  const scale = BigInt(1000000), numerator = square.numerator * scale * scale, denominator = square.denominator;
  let low = BigInt(0), high = scale + BigInt(1);
  while (high - low > BigInt(1)) {
    const mid = (low + high) / BigInt(2);
    if (mid * mid * denominator <= numerator) low = mid; else high = mid;
  }
  if (BigInt(4) * numerator >= denominator * (BigInt(2) * low + BigInt(1)) ** BigInt(2)) low++;
  return sign * Number(low) / Number(scale);
}

/** Equal-weight building observations in one quarter; no pooled area weights,
 * cross-quarter filling, fitted causal claim or missing-to-zero substitution. */
export function rentVacancyRelationship(snapshot: FactSnapshot) {
  assertComplete(snapshot);
  if (!snapshot.period) throw new Error('QUARTER_REQUIRED');
  const rows = snapshot.rows.map(row => {
    const one = { ...snapshot, rows: [row], expectedCount: 1 };
    const rent = aggregateQuarter(one, 'rent'), vacancy = aggregateQuarter(one, 'vacancy');
    return { entityId: row.id, rent, vacancy, jointValid: rent.value !== null && vacancy.value !== null };
  });
  const joint = rows.filter(row => row.jointValid);
  const n = Decimal.parse(joint.length)!;
  let sumX = Decimal.zero(), sumY = Decimal.zero(), sumXX = Decimal.zero(), sumYY = Decimal.zero(), sumXY = Decimal.zero();
  for (const row of joint) {
    const x = from(row.rent.value!), y = from(row.vacancy.value!);
    sumX = sumX.add(x); sumY = sumY.add(y); sumXX = sumXX.add(x.multiply(x)); sumYY = sumYY.add(y.multiply(y)); sumXY = sumXY.add(x.multiply(y));
    // Unrelated ratio denominators can grow rapidly. Refuse the whole query
    // before unbounded arithmetic; never truncate observations or round inputs.
    if ([sumX, sumY, sumXX, sumYY, sumXY].some(v => v.numerator.toString(2).length > 16384 || v.denominator.toString(2).length > 16384)) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  }
  const xx = n.multiply(sumXX).subtract(sumX.multiply(sumX));
  const yy = n.multiply(sumYY).subtract(sumY.multiply(sumY));
  const xy = n.multiply(sumXY).subtract(sumX.multiply(sumY));
  const reason = joint.length < 3 ? 'fewer_than_three_joint_samples' : xx.compare(Decimal.zero()) === 0 || yy.compare(Decimal.zero()) === 0 ? 'constant_variable' : null;
  const squared = reason ? null : xy.multiply(xy).divide(xx.multiply(yy));
  if (squared && (squared.compare(Decimal.zero()) < 0 || squared.compare(Decimal.parse(1)!) > 0)) throw new Error('RELATIONSHIP_MOMENT_INVARIANT');
  return { version: 'building-rent-vacancy-pearson/1' as const, weighting: 'equal_building' as const,
    coverage: { candidates: rows.length, rentValid: rows.filter(r => r.rent.value !== null).length, vacancyValid: rows.filter(r => r.vacancy.value !== null).length, jointValid: joint.length, excluded: rows.length - joint.length },
    rows, jointEntityIds: joint.map(row => row.entityId).sort(),
    moments: { n: joint.length, sumX: sumX.exact(), sumY: sumY.exact(), sumXX: sumXX.exact(), sumYY: sumYY.exact(), sumXY: sumXY.exact(), xx: xx.exact(), yy: yy.exact(), xy: xy.exact() },
    correlation: { value: squared ? signedRoot6(squared, xy.compare(Decimal.zero())) : null, approximate: true as const, decimalPlaces: 6, squaredExact: squared?.exact() ?? null, unavailableReason: reason },
  };
}
