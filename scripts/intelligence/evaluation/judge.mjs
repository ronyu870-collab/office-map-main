import { isDeepStrictEqual } from 'node:util';
// Exact structural evidence, deliberately independent of product calculation.
export function judge(actual, expected) {
  const errors = [];
  for (const [key, value] of Object.entries(expected)) if (!isDeepStrictEqual(actual[key], value)) errors.push(key);
  if (JSON.stringify(actual).includes('SYNTHETIC_FORBIDDEN_SENTINEL')) errors.push('leakage');
  return { status: errors.length ? 'FAIL' : 'PASS', errors };
}
