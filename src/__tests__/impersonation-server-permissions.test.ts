import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('server-side impersonation permission inheritance', () => {
  it('treats the impersonation header as untrusted and resolves the target role server-side', () => {
    const helper = source('src/lib/server/impersonationAuth.ts');

    expect(helper).toContain("IMPERSONATION_REQUEST_HEADER = 'x-colliers-impersonate-user'");
    expect(helper).toContain('client.auth.getUser(accessToken)');
    expect(helper).toContain("callerRole !== 'admin'");
    expect(helper).toContain(".from('user_roles')");
    expect(helper).toContain(".eq('user_id', targetUserId)");
    expect(helper).toContain('effectiveUserId: targetProfile.user_id');
    expect(helper).toContain('effectiveRole');
  });

  it('keeps browser impersonation state tab-scoped and sends it explicitly to application APIs', () => {
    const headers = source('src/services/impersonationHeaders.ts');
    const leasePage = source('src/app/lease-submission/history/page.tsx');
    const mapBridge = source('src/app/map/MapLeaseTransactionsBridge.tsx');
    const leaseService = source('src/services/leaseTransactionSubmitService.ts');
    const intelligenceApi = source('src/services/intelligenceApi.ts');
    const oss = source('src/components/OSSManager.tsx');
    const apiClient = source('src/services/apiClient.ts');

    expect(headers).toContain("sessionStorage.getItem(STORAGE_KEY)");
    expect(headers).toContain("IMPERSONATION_REQUEST_HEADER = 'X-Colliers-Impersonate-User'");
    for (const client of [leasePage, mapBridge, leaseService, intelligenceApi, apiClient]) {
      expect(client).toContain('withImpersonationHeaders');
    }
    expect(oss).toContain('getImpersonationRequestHeaders');
  });

  it('uses the effective role or user on every service-role business read boundary', () => {
    const leaseRead = source('src/app/api/lease-transactions/read/route.ts');
    const submissions = source('src/app/api/submissions/route.ts');
    const teamSubmissions = source('src/app/api/lease-submission/team-submissions/route.ts');
    const leaseExport = source('src/app/api/lease-submission/export/route.ts');
    const intelligence = source('src/lib/intelligence/serverContext.ts');

    expect(leaseRead).toContain('resolveLeaseReadAccess(identity.effectiveRole');
    expect(submissions).toContain("identity.effectiveRole === 'admin'");
    expect(submissions).toContain("query.eq('submitter_id', identity.effectiveUserId)");
    expect(teamSubmissions).toContain('const callerRole = identity.effectiveRole');
    expect(leaseExport).toContain("identity.effectiveRole !== 'admin'");
    expect(intelligence).toContain('isIntelligencePreviewEnabled(identity.effectiveRole)');
  });

  it('prevents the real admin JWT from mutating privileged data while simulation is active', () => {
    const helper = source('src/lib/server/impersonationAuth.ts');
    const adminUsers = source('src/app/api/admin/users/route.ts');
    const leaseSettings = source('src/app/api/admin/lease-team-access/route.ts');
    const transfer = source('src/app/api/admin/transfer-submission/route.ts');
    const createUser = source('src/app/api/admin/create-user/route.ts');
    const resetPassword = source('src/app/api/admin/reset-password/route.ts');
    const passwordChange = source('src/app/api/auth/complete-password-change/route.ts');
    const oss = source('src/app/api/oss/route.ts');

    expect(helper).toContain('denyImpersonatedMutation');
    for (const route of [adminUsers, leaseSettings, transfer, createUser, resetPassword, passwordChange]) {
      expect(route).toContain('denyImpersonatedMutation');
    }
    expect(oss).toContain('verified.isImpersonating');
  });

  it('keeps the impersonation control plane bound to the real admin identity', () => {
    const route = source('src/app/api/admin/impersonate/route.ts');

    expect(route).toContain('verifyAdmin(req)');
    expect(route).toContain("roleRow.role !== 'admin'");
    expect(route).not.toContain('resolveEffectiveRequestIdentity');
    expect(route).not.toContain('IMPERSONATION_COOKIE');
  });
});
