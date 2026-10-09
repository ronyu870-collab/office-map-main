import { beforeEach, describe, expect, it } from 'vitest';
import { inspectAccountRecovery } from './quarterlyRecoveryCleanup';

const userId = 'synthetic:user';
const key = 'quarterly-draft:v1:synthetic%3Auser:2026:Q4:GradeB';
const identity = { userId, year: 2026, quarter: 4, tab: 'GradeB' };
const batch = { p_user_id: userId, p_year: 2026, p_quarter: 4, p_tab: 'GradeB', p_regular_rows: [], p_future_rows: [] };
const pending = { requestId: 'pending', batch };
const receipt = { regular_count: 0, future_count: 0, submitted_at: '2026-10-09T00:00:00Z' };
const acknowledged = { requestId: 'acknowledged', batch, receipt };
const put = (suffix: string, value: unknown) => localStorage.setItem(key + suffix, JSON.stringify(value));
beforeEach(() => localStorage.clear());

describe('account recovery cleanup preflight', () => {
  it.each(['acknowledged', 'missing', 'pending'])('blocks an immutable pending request with a %s pointer', (pointer) => {
    if (pointer !== 'missing') put(':submission', pointer === 'pending' ? pending : acknowledged);
    put(':submission:request:pending', pending);
    const before = { ...localStorage };
    expect(inspectAccountRecovery(localStorage, userId).status).toBe('pending');
    expect({ ...localStorage }).toEqual(before);
  });
  it('also protects a pending pointer with no immutable record', () => {
    put(':submission', pending);
    expect(inspectAccountRecovery(localStorage, userId).status).toBe('pending');
  });
  it('allows acknowledged and definitely rejected records plus normal reference/recovery wrappers', () => {
    put(':submission', acknowledged); put(':submission:request:acknowledged', acknowledged);
    put(':submission:request:rejected', { requestId: 'rejected', batch, rejected: { code: '22023', message: 'submission_period_changed' } });
    put('', { version: 1, identity, payload: { regular: {}, future: {} }, revision: 0, dirty: false });
    put(':reference:2026:Q3:r0', { identity, savedAt: receipt.submitted_at, value: { payload: {} } });
    put(':recovery:123:conflict-local:uuid', { identity, savedAt: receipt.submitted_at, value: { regular: {} } });
    const other = 'quarterly-draft:v1:synthetic%3Auser-other:2026:Q4:GradeA:submission';
    localStorage.setItem(other, 'malformed unrelated account');
    const result = inspectAccountRecovery(localStorage, userId);
    expect(result.status).toBe('safe'); expect(result.keys).toHaveLength(6);
    expect(result.keys).not.toContain(other);
    result.keys.forEach((entry) => localStorage.removeItem(entry));
    expect(localStorage.getItem(other)).toBe('malformed unrelated account');
  });
  it.each([null, [], {}, { ...pending, receipt: {} }, { ...pending, rejected: {} }, { ...pending, rejected: { code: 'unknown', message: 'timeout' } }, { ...pending, batch: { ...batch, p_user_id: 'other' } }])('fails closed on malformed submission %#', (value) => {
    put(':submission', value);
    expect(inspectAccountRecovery(localStorage, userId).status).toBe('invalid');
    expect(localStorage.getItem(key + ':submission')).toBe(JSON.stringify(value));
  });
  it('fails closed for corrupt JSON, unknown keys and mismatched immutable request IDs', () => {
    localStorage.setItem(key + ':submission', '{');
    expect(inspectAccountRecovery(localStorage, userId).status).toBe('invalid');
    localStorage.clear(); put(':unknown', {});
    expect(inspectAccountRecovery(localStorage, userId).status).toBe('invalid');
    localStorage.clear(); put(':submission:request:wrong', pending);
    expect(inspectAccountRecovery(localStorage, userId).status).toBe('invalid');
  });
  it('blocks dirty scoped recovery copies even if all requests are acknowledged', () => {
    put(':submission', acknowledged);
    put('', { version: 1, identity, payload: { regular: {}, future: {} }, revision: 0, dirty: true });
    expect(inspectAccountRecovery(localStorage, userId).status).toBe('pending');
  });
});
