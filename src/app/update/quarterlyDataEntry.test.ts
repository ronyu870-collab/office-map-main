import { describe, expect, it } from 'vitest';

import { buildQuarterlySubmissionPayload, getQuarterlyRowIssues, isQuarterlyRowComplete } from './quarterlyDataEntry';

describe('quarterly data entry model', () => {
  it('requires five operational fields and preserves numeric and string zeros', () => {
    expect(isQuarterlyRowComplete({ qQuote: '100', qProp: '30', qFace: '90', qFree: '3', qVacArea: '500' })).toBe(true);
    expect(isQuarterlyRowComplete({ qQuote: '100', qProp: '30', qFace: '90', qFree: '3', qVacArea: '' })).toBe(false);
    expect(isQuarterlyRowComplete({ qQuote: '100', qProp: '30', qFace: '90', qFree: '0', qVacArea: '500' })).toBe(true);
    expect(isQuarterlyRowComplete({ qQuote: '100', qProp: '30', qFace: '90', qFree: 0, qVacArea: '500' })).toBe(true);
  });

  it('preserves zero and null independently without inventing total area', () => {
    const context = { userId: 'user-1', userName: 'Broker', year: 2026, quarter: 3, totalArea: 0 };
    const zero = buildQuarterlySubmissionPayload({ qQuote: 0, qProp: 0, qFace: 0, qFree: 0, qVacArea: 0 }, context);
    expect(zero.asking_rent).toBe(0);
    expect(zero.vacant_area).toBe(0);
    expect(zero.total_area).toBeNull();
    expect(zero.vacancy_rate).toBeNull();
    const blank = buildQuarterlySubmissionPayload({ qVacArea: null }, { ...context, totalArea: 100 });
    expect(blank.vacant_area).toBeNull();
    expect(blank.vacancy_rate).toBeNull();
    expect(() => buildQuarterlySubmissionPayload({ qFace: '12oops' }, context)).toThrow();
  });

  it('rejects invalid numeric bounds while retaining partial submissions', () => {
    const issues = getQuarterlyRowIssues({ qQuote: '100', qProp: '30', qFace: '90', qFree: '3', qVacArea: '1200' }, 1000);
    expect(issues.some((issue) => issue.field === 'qVacArea' && issue.severity === 'error')).toBe(true);
  });

  it('builds the same calculated submission values as the legacy page', () => {
    const payload = buildQuarterlySubmissionPayload(
      { qQuote: '101.4', qProp: '30.2', qFace: '90', qFree: '3', qVacArea: '500', qOwner: 'Owner', qPropMan: 'PM', qRemark: 'Note' },
      { userId: 'user-1', userName: 'Broker', year: 2026, quarter: 3, totalArea: 10000 },
    );

    expect(payload.asking_rent).toBe(101);
    expect(payload.management_fee).toBe(30);
    expect(payload.net_effective_rent).toBe(82.5);
    expect(payload.vacancy_rate).toBe(5);
    expect(payload.owner).toBe('Owner');
    expect(payload.property_management).toBe('PM');
  });
});

