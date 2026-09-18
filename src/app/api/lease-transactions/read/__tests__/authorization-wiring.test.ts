import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync('src/app/api/lease-transactions/read/route.ts', 'utf8');

describe('lease read route authorization wiring', () => {
  it('derives record-source scope from the authenticated server-side role', () => {
    expect(routeSource).toContain("const access = resolveLeaseReadAccess(role, params.get('record_source'));");
    expect(routeSource).toContain("if (access.enforcedSource) query = query.eq('record_source', access.enforcedSource);");
    expect(routeSource).not.toContain("if (source === 'live' || source === 'history')");
  });

  it('returns the effective historical capability without exposing historical counts to non-admins', () => {
    expect(routeSource).toContain('canReadHistory: access.canReadHistory');
    expect(routeSource).toContain("effectiveSource: access.enforcedSource ?? 'all'");
    expect(routeSource).toContain("records: data ?? []");
    expect(routeSource).toContain("'Cache-Control': 'private, no-store'");
  });
});
