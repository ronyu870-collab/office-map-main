import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('quarterly viewer read-only parity', () => {
  it('allows viewer into the quarterly workspace but derives read-only from business write capability', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/update/components/QuarterlyUpdateWorkspace.tsx'),
      'utf8',
    );

    expect(source).toContain("!['viewer', 'editor', 'admin'].includes(role)");
    expect(source).toContain('setUserRole(role)');
    expect(source).toContain('const readOnly = !canWriteBusinessData(userRole) || isPreview || isImpersonating');
    expect(source).toContain("if (!draftUserName || !canWriteBusinessData(userRole) || isPreview || isImpersonating) return false");
    expect(source).toContain("setSubmitError('当前账号为只读模式，不能写入季度业务数据。')");
  });

  it('enforces viewer write denial in RLS rather than relying on disabled inputs', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260924142000_viewer_readonly_editor_parity.sql'),
      'utf8',
    );

    expect(migration).toContain('private.can_write_business_data()');
    expect(migration).toContain("r.role in ('editor', 'admin')");
    expect(migration).toContain('business writers insert own quarterly submissions');
    expect(migration).toContain('business writers create own update drafts');
    expect(migration).toContain('business writers update own update drafts');
    expect(migration).toContain('business writers insert own future submissions');
    expect(migration).toContain('create or replace function public.save_quarterly_draft');
    expect(migration).toContain("message = 'business_write_forbidden'");
  });
});
