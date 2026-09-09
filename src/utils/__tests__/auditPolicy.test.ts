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
