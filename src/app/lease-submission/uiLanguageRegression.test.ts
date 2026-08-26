import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Chinese product language regression', () => {
  it('keeps lease submission user-facing copy in Chinese', () => {
    const form = source('./components/LeaseTransactionWorkspaceForm.tsx');
    const monitoring = source('./monitoring/page.tsx');
    const teamMonitor = source('./components/TeamSubmissionMonitor.tsx');
    const saveStatus = source('../../components/data-entry/SaveStatus.tsx');

    const forbidden = [
      'LEASE SUBMISSION',
      'Potential duplicate',
      'Tenant & Requirement',
      'Transaction Building',
      'Previous Location',
      'Timing & Context',
      'Loading buildings…',
      'Submission succeeded',
      'Record written to database',
      'Team Monitoring',
      '>Cancel<',
      'Submit record',
      'Update record',
    ];

    for (const phrase of forbidden) {
      expect(`${form}\n${monitoring}\n${teamMonitor}`).not.toContain(phrase);
    }

    for (const phrase of ['Ready', 'Unsaved changes', 'Saving…', 'Save failed', 'Submitting…', 'Submitted', 'Retry']) {
      expect(saveStatus).not.toContain(`label: '${phrase}'`);
    }
  });

  it('does not expose internal English library labels or upload states', () => {
    const manager = source('../../components/OSSManager.tsx');

    for (const phrase of [
      '>PowerPoint<',
      '>Word<',
      '>Excel<',
      '名称 A–Z',
      '完整 OSS 路径',
      'entry.message || entry.status',
    ]) {
      expect(manager).not.toContain(phrase);
    }

    expect(manager).toContain('演示文稿');
    expect(manager).toContain('文字文档');
    expect(manager).toContain('电子表格');
    expect(manager).toContain('uploadStatusLabel(entry.status)');
  });
});
