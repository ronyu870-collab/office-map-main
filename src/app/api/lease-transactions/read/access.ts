export type LeaseReadSource = 'live' | 'history';

export type LeaseReadDenialReason = 'role' | 'history' | null;

export type LeaseReadAccess = {
  authorized: boolean;
  canReadHistory: boolean;
  enforcedSource: LeaseReadSource | null;
  denialReason: LeaseReadDenialReason;
};

/**
 * Server-side authorization contract for the unified lease read API.
 *
 * - admin: may read live + historical records and may explicitly filter either source.
 * - editor/viewer: may read live records only.
 * - unknown/missing roles: denied.
 *
 * Historical visibility must be enforced here, before the service-role query executes;
 * UI hiding is presentation-only and is never treated as an authorization boundary.
 */
export function resolveLeaseReadAccess(
  roleValue: unknown,
  requestedSourceValue: unknown,
): LeaseReadAccess {
  const role = typeof roleValue === 'string' ? roleValue.trim().toLowerCase() : '';
  const requestedSource: LeaseReadSource | null =
    requestedSourceValue === 'live' || requestedSourceValue === 'history'
      ? requestedSourceValue
      : null;

  if (role !== 'viewer' && role !== 'editor' && role !== 'admin') {
    return {
      authorized: false,
      canReadHistory: false,
      enforcedSource: 'live',
      denialReason: 'role',
    };
  }

  if (role === 'admin') {
    return {
      authorized: true,
      canReadHistory: true,
      enforcedSource: requestedSource,
      denialReason: null,
    };
  }

  if (requestedSource === 'history') {
    return {
      authorized: false,
      canReadHistory: false,
      enforcedSource: 'live',
      denialReason: 'history',
    };
  }

  return {
    authorized: true,
    canReadHistory: false,
    enforcedSource: 'live',
    denialReason: null,
  };
}
