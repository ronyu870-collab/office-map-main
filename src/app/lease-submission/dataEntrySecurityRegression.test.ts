import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('lease data entry authorization seams', () => {
  it('keeps server-side admin enforcement on team submissions', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/api/lease-submission/team-submissions/route.ts'), 'utf8');
    expect(source).toContain("callerProfile?.role !== 'admin'");
    expect(source).toContain("status: 403");
    expect(source).toContain('service role');
  });

  it('keeps session identity and owner/admin checks on record editing', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/leaseTransactionSubmitService.ts'), 'utf8');
    expect(source).toContain('session.user.id !== userId');
    expect(source).toContain('const isAdmin = roleRow?.role === "admin"');
    expect(source).toContain('!isAdmin && existing.submitter_id !== userId.trim()');
    expect(source).toContain('无权编辑此记录');
  });
});
