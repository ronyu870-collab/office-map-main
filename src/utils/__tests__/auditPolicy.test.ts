import { describe, expect, it } from 'vitest';
import { AuditPolicyGate, isNoisyAuditAction } from '@/src/utils/auditPolicy';

describe('audit policy', () => {
  it('never throttles critical or unknown actions', () => {
    const gate = new AuditPolicyGate();
    for (let index = 0; index < 500; index += 1) {
      expect(gate.shouldRecord('DB_UPDATE', { index }, 1_000)).toBe(true);
    }
    expect(gate.shouldRecord('FUTURE_CRITICAL_ACTION', {}, 1_000)).toBe(true);
  });

  it('deduplicates repeated noisy actions only inside their short window', () => {
    const gate = new AuditPolicyGate();
    expect(gate.shouldRecord('PAGE_VIEW', { page: '/map' }, 1_000)).toBe(true);
    expect(gate.shouldRecord('PAGE_VIEW', { page: '/map' }, 5_000)).toBe(false);
    expect(gate.shouldRecord('PAGE_VIEW', { page: '/map' }, 16_001)).toBe(true);
  });

  it('caps runaway noisy traffic without suppressing critical writes', () => {
    const gate = new AuditPolicyGate();
    for (let index = 0; index < 120; index += 1) {
      expect(gate.shouldRecord('SEARCH', { query: `q-${index}` }, 10_000)).toBe(true);
    }
    expect(gate.shouldRecord('SEARCH', { query: 'overflow' }, 10_000)).toBe(false);
    expect(gate.shouldRecord('DB_DELETE', { table: 'buildings' }, 10_000)).toBe(true);
  });

  it('classifies only known high-frequency behavior as noisy', () => {
    expect(isNoisyAuditAction('MAP_FILTER')).toBe(true);
    expect(isNoisyAuditAction('PAGE_VIEW')).toBe(true);
    expect(isNoisyAuditAction('SUBMIT_LEASE_TRANSACTION')).toBe(false);
    expect(isNoisyAuditAction('DB_UPDATE')).toBe(false);
  });
});

it('ignores browsing correlation IDs while retaining actual content and entry changes',()=>{
 const gate=new AuditPolicyGate();
 expect(gate.shouldRecord('VIEW_MATERIAL_CONTENT',{target_id:'doc',page:1,correlation_id:'a'},0)).toBe(true);
 expect(gate.shouldRecord('VIEW_MATERIAL_CONTENT',{target_id:'doc',page:1,correlation_id:'b'},1)).toBe(false);
 expect(gate.shouldRecord('VIEW_MATERIAL_CONTENT',{target_id:'doc',page:2,correlation_id:'b'},2)).toBe(true);
 expect(gate.shouldRecord('VIEW_MATERIAL_CONTENT',{target_id:'doc',page:2,entry:'search'},3)).toBe(true);
 for(let i=0;i<200;i++)gate.shouldRecord('VIEW_MATERIAL_CONTENT',{target_id:'doc',page:i},4+i);
 expect(gate.shouldRecord('VIEW_MATERIAL_CONTENT',{target_id:'other'},1000)).toBe(false);
 expect(gate.shouldRecord('BUILDING_PHOTO_DOWNLOAD',{target_id:'photo'},1001)).toBe(true);
});
