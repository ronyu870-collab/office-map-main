import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

describe('Product language continuity', () => {
  it('keeps the broker lease form free from the legacy English workspace shown in production', () => {
    const page = source('src/app/lease-submission/page.tsx');
    const form = source('src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx');
    const saveStatus = source('src/components/data-entry/SaveStatus.tsx');
    const combined = `${page}\n${form}\n${saveStatus}`;

    const legacyVisibleCopy = [
      'LEASE SUBMISSION',
      'New transaction record',
      'Edit transaction record',
      'Validation ready',
      'changed fields',
      'Required fields are marked with *',
      'Required *',
      'TENANT & REQUIREMENT',
      'Identity and demand classification',
      'TRANSACTION BUILDING',
      'Entity-first selection; auto-fill market attributes',
      'PREVIOUS LOCATION',
      'ECONOMICS',
      'TIMING & CONTEXT',
      'Potential duplicate',
      'Checking potential duplicates',
      'Updating record in database',
      'Writing record to database',
      'Submission succeeded',
      'Record written to database',
      'Validation errors appear beside the affected field.',
      '>Cancel<',
      '>Submit record<',
      '>Ready<',
    ];

    for (const copy of legacyVisibleCopy) {
      expect(combined, `legacy visible copy returned: ${copy}`).not.toContain(copy);
    }

    for (const requiredChineseCopy of [
      '租赁成交填报',
      '新增成交记录',
      '校验就绪',
      '企业与需求',
      '成交楼宇',
      '租赁商务条件',
      '成交时间与备注',
      '取消',
      '提交记录',
    ]) {
      expect(form, `missing current broker-facing copy: ${requiredChineseCopy}`).toContain(requiredChineseCopy);
    }

    expect(saveStatus).toContain("idle: { label: '就绪'");
  });

  it('preserves Q1-Q4 as the professional quarter notation', () => {
    const periodModel = source('src/app/lease-submission/leaseEntryModel.ts');
    const schema = source('src/app/lease-submission/schemas/leaseTransactionSchema.ts');
    expect(periodModel).toContain('quarters.push(`Q${quarter}`)');
    expect(schema).toContain(".regex(/^Q[1-4]$/");
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
