import assert from 'node:assert/strict';

/** The default retains every existing 640+80 sample. Isolated CI jobs
 * explicitly select each additional browser suite, while still executing the
 * complete real Auth/HTTP regression matrix in that same fresh stack. */
export function queryPerformanceSuite(raw = 'regression') {
  assert.ok(['regression', 'cross_trend', 'p2_workspace'].includes(raw), 'INVALID_QUERY_PERFORMANCE_SUITE');
  return raw;
}
