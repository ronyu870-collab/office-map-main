import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

describe('Product language continuity', () => {
  it('keeps lease submission free from legacy whole-UI English copy', () => {
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
  });

  it('preserves Q1-Q4 as the professional quarter notation', () => {
    const periodModel = source('src/app/lease-submission/leaseEntryModel.ts');
    expect(periodModel).toContain('quarters.push(`Q${quarter}`)');
  });

  it('keeps quarterly table structure and workflow states in Chinese', () => {
    const workspace = source('src/app/update/components/QuarterlyUpdateWorkspace.tsx');
    for (const label of ['甲级', '乙级', '产业园', '项目概况', '历史参考', '本季度填报', '净有效租金', '空置面积', '租金变化', '面积变化', '提交成功']) {
      expect(workspace).toContain(label);
    }
    for (const legacy of ['Grade A', 'Grade B', 'Business Park', 'Submission succeeded', 'Project context', 'Previous quarter reference', 'Current quarter entry', 'Owner / PM', 'Total area', 'Rent Δ', 'Area Δ']) {
      expect(workspace).not.toContain(legacy);
    }
  });

  it('keeps research library product language clean without banning professional file-type terms', () => {
    const page = source('src/app/oss/page.tsx');
    const manager = source('src/components/OSSManager.tsx');
    const combined = `${page}\n${manager}`;

    expect(page).toContain('研究资料库');
    expect(combined).not.toContain('>Research Library</button>');
    expect(combined).not.toContain('>Upload status</span>');
    expect(combined).not.toContain('entry.message || entry.status');
  });
});

