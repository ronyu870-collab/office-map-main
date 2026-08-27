import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { canViewLeaseTeamSubmissions } from '@/src/utils/accessControl';

describe('lease data entry authorization seams', () => {
  it('allows editors and admins, but not viewers, to read team submissions', () => {
    expect(canViewLeaseTeamSubmissions('editor')).toBe(true);
    expect(canViewLeaseTeamSubmissions('admin')).toBe(true);
    expect(canViewLeaseTeamSubmissions('viewer')).toBe(false);
    expect(canViewLeaseTeamSubmissions('unknown')).toBe(false);
  });

  it('keeps server-side role enforcement and bounded requests on team submissions', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/api/lease-submission/team-submissions/route.ts'), 'utf8');
    expect(source).toContain('canViewLeaseTeamSubmissions(callerProfile?.role)');
    expect(source).toMatch(/status:\s*403/);
    expect(source).toMatch(/service role/i);
    expect(source).toContain('AbortSignal.timeout');
    expect(source).toContain('maxDuration = 30');
  });

  it('bounds the browser request for team submissions', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/leaseTransactionSubmitService.ts'), 'utf8');
    expect(source).toContain('new AbortController()');
    expect(source).toContain('团队成交数据请求超时，请稍后重试');
  });

  it('keeps session identity and owner/admin checks on record editing', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/leaseTransactionSubmitService.ts'), 'utf8');
    expect(source).toMatch(/session\.user\.id\s*!==\s*userId/);
    expect(source).toMatch(/const\s+isAdmin\s*=\s*roleRow\?\.role\s*===\s*['"]admin['"]/);
    expect(source).toMatch(/!isAdmin\s*&&\s*existing\.submitter_id\s*!==\s*userId\.trim\(\)/);
    expect(source).toContain('无权编辑此记录');
  });
});
