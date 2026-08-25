import { describe, expect, it } from 'vitest';

import { buildQuarterlySubmissionPayload, getQuarterlyRowIssues, isQuarterlyRowComplete } from './quarterlyDataEntry';

describe('quarterly data entry model', () => {
  it('preserves the legacy five-field completeness contract', () => {
    expect(isQuarterlyRowComplete({ qQuote: '100', qProp: '30', qFace: '90', qFree: '3', qVacArea: '500' })).toBe(true);
    expect(isQuarterlyRowComplete({ qQuote: '100', qProp: '30', qFace: '90', qFree: '3', qVacArea: '' })).toBe(false);
    // Existing flow used truthiness, so zero remains incomplete rather than silently changing business behavior.
    expect(isQuarterlyRowComplete({ qQuote: '100', qProp: '30', qFace: '90', qFree: '0', qVacArea: '500' })).toBe(false);
  });

  it('presents impossible-looking values as warnings instead of inventing a new hard block', () => {
    const issues = getQuarterlyRowIssues({ qQuote: '100', qProp: '30', qFace: '90', qFree: '3', qVacArea: '1200' }, 1000);
    expect(issues.some((issue) => issue.field === 'qVacArea' && issue.severity === 'warning')).toBe(true);
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
