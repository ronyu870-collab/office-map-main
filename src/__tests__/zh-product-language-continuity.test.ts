import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

describe('Chinese product language continuity', () => {
  it('keeps lease submission free from legacy English UI copy', () => {
    const workspace = source('src/app/lease-submission/page.tsx');
    const form = source('src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx');
    const monitor = source('src/app/lease-submission/components/TeamSubmissionMonitor.tsx');
    const combined = `${workspace}\n${form}\n${monitor}`;

    const legacyVisibleCopy = [
      'LEASE SUBMISSION',
      'Required fields are marked with *',
      'Potential duplicate',
      'Checking potential duplicates',
      'Updating record in database',
      'Writing record to database',
      'Submission succeeded',
      'Record written to database',
      'Record ID',
      'New transaction record',
      'Edit transaction record',
      'Tenant & Requirement',
      'Transaction Building',
      'Previous Location',
      'Economics',
      'Timing & Context',
      'Loading buildings',
    ];

    for (const copy of legacyVisibleCopy) {
      expect(combined, `legacy visible copy returned: ${copy}`).not.toContain(copy);
    }
    expect(monitor).not.toContain('W{week.weekNumber}');
  });

  it('keeps research library controls from exposing office-product English labels', () => {
    const page = source('src/app/oss/page.tsx');
    const manager = source('src/components/OSSManager.tsx');
    const combined = `${page}\n${manager}`;

    expect(combined).not.toContain('>PowerPoint<');
    expect(combined).not.toContain('>Word<');
    expect(combined).not.toContain('>Excel<');
    expect(combined).not.toContain('名称 A–Z');
    expect(combined).not.toContain('entry.message || entry.status');
  });
});
