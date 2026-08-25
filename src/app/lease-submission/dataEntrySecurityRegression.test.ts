import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('lease data entry authorization seams', () => {
  it('keeps server-side admin enforcement on team submissions', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/api/lease-submission/team-submissions/route.ts'), 'utf8');
    expect(source).toMatch(/callerProfile\?\.role\s*!==\s*['"]admin['"]/);
    expect(source).toMatch(/status:\s*403/);
    expect(source).toMatch(/service role/i);
  });

  it('keeps session identity and owner/admin checks on record editing', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/leaseTransactionSubmitService.ts'), 'utf8');
    expect(source).toMatch(/session\.user\.id\s*!==\s*userId/);
    expect(source).toMatch(/const\s+isAdmin\s*=\s*roleRow\?\.role\s*===\s*['"]admin['"]/);
    expect(source).toMatch(/!isAdmin\s*&&\s*existing\.submitter_id\s*!==\s*userId\.trim\(\)/);
    expect(source).toContain('无权编辑此记录');
  });
});
