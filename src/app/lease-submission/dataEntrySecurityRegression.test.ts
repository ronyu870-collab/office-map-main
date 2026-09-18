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
    expect(source).toContain('resolveEffectiveRequestIdentity(req, supabaseAdmin)');
    expect(source).toContain('canViewLeaseTeamSubmissions(identity.effectiveRole)');
    expect(source).toMatch(/status:\s*403/);
    expect(source).toMatch(/service role/i);
    expect(source).toContain('AbortSignal.timeout');
    expect(source).toContain('maxDuration = 30');
  });

  it('loads team submissions without a separate access probe', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/lease-submission/page.tsx'), 'utf8');
    expect(source).not.toContain('getLeaseTeamAccess');
    expect(source).toContain('canViewLeaseTeamSubmissions(role)');
    expect(source).toContain('getAllSubmissions(role)');
    expect(source).toContain("TEAM_ACCESS_DISABLED_MESSAGE = '团队成交汇总当前未向编辑用户开放'");
  });

  it('keeps core workspace readiness independent from team loading', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/lease-submission/page.tsx'), 'utf8');
    expect(source).toContain('const [coreLoading, setCoreLoading] = React.useState(true)');
    expect(source).toContain('const [teamLoading, setTeamLoading] = React.useState(false)');
    expect(source).toContain('const loadCoreData = React.useCallback');
    expect(source).toContain('const loadTeamData = React.useCallback');
    expect(source).toContain('void loadTeamData(role);');
    expect(source).toContain('await loadCoreData(uid);');
    expect(source).toContain("coreLoading ? '正在刷新数据' : '数据已就绪'");
    expect(source).toContain('teamLoading && teamSubmissions.length === 0');
    expect(source).not.toContain('requests.push(retryAsync(() => getAllSubmissions(role)');
  });

  it('bounds the browser request for team submissions', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/leaseTransactionSubmitService.ts'), 'utf8');
    expect(source).toContain('new AbortController()');
    expect(source).toContain('团队成交数据请求超时，请稍后重试');
    expect(source).toContain('withImpersonationHeaders');
  });

  it('keeps session identity and owner/admin checks on record editing', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/leaseTransactionSubmitService.ts'), 'utf8');
    expect(source).toMatch(/session\.user\.id\s*!==\s*userId/);
    expect(source).toMatch(/const\s+isAdmin\s*=\s*roleRow\?\.role\s*===\s*['"]admin['"]/);
    expect(source).toMatch(/!isAdmin\s*&&\s*existing\.submitter_id\s*!==\s*userId\.trim\(\)/);
    expect(source).toContain('无权编辑此记录');
  });
});
