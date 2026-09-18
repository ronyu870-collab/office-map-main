import { describe, expect, it } from 'vitest';

import { resolveLeaseReadAccess } from '../access';

describe('lease read authorization policy', () => {
  it('allows admins to read the unified live + historical source', () => {
    expect(resolveLeaseReadAccess('admin', null)).toEqual({
      authorized: true,
      canReadHistory: true,
      enforcedSource: null,
      denialReason: null,
    });
    expect(resolveLeaseReadAccess('admin', 'live').enforcedSource).toBe('live');
    expect(resolveLeaseReadAccess('admin', 'history').enforcedSource).toBe('history');
  });

  it('forces editors and viewers onto live records only', () => {
    for (const role of ['editor', 'viewer'] as const) {
      expect(resolveLeaseReadAccess(role, null)).toEqual({
        authorized: true,
        canReadHistory: false,
        enforcedSource: 'live',
        denialReason: null,
      });
      expect(resolveLeaseReadAccess(role, 'live').enforcedSource).toBe('live');
    }
  });

  it('rejects explicit historical reads from non-admin roles', () => {
    for (const role of ['editor', 'viewer'] as const) {
      expect(resolveLeaseReadAccess(role, 'history')).toEqual({
        authorized: false,
        canReadHistory: false,
        enforcedSource: 'live',
        denialReason: 'history',
      });
    }
  });

  it('denies unknown or missing roles by default', () => {
    for (const role of [null, undefined, '', 'user', 'ADMINISTRATOR']) {
      const access = resolveLeaseReadAccess(role, null);
      expect(access.authorized).toBe(false);
      expect(access.denialReason).toBe('role');
      expect(access.canReadHistory).toBe(false);
    }
  });
});
