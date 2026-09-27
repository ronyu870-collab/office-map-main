import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canAccessModule,
  canViewLeaseTeamSubmissions,
  canWriteBusinessData,
} from '@/src/utils/accessControl';
import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import { resolveLeaseReadAccess } from '@/src/app/api/lease-transactions/read/access';
import { MapDataStore } from '@/src/app/map/model/MapDataStore';
import { canAccessAdminConsole } from '@/src/utils/adminAccess';
import { isDemoMode } from '@/src/config/demoMode';

describe('viewer/editor parity contract', () => {
  it('keeps all non-admin business workspace entry permissions identical', () => {
    for (const moduleId of ['map', 'update', 'lease-submission', 'oss', 'intelligence']) {
      expect(canAccessModule(moduleId, 'viewer')).toBe(canAccessModule(moduleId, 'editor'));
      expect(canAccessModule(moduleId, 'viewer')).toBe(true);
    }
  });

  it('keeps intelligence preview visibility identical for viewer and editor', () => {
    expect(isIntelligencePreviewEnabled('viewer')).toBe(isIntelligencePreviewEnabled('editor'));
  });

  it('does not let demo presentation state break Viewer/Editor parity', () => {
    expect(isDemoMode('demo@colliers.com')).toBe(false);
    expect(canAccessAdminConsole({ role: 'viewer', isDemo: true })).toBe(false);
    expect(canAccessAdminConsole({ role: 'editor', isDemo: true })).toBe(false);
  });

  it('keeps live lease read authorization identical while denying history to both', () => {
    expect(resolveLeaseReadAccess('viewer', null)).toEqual(resolveLeaseReadAccess('editor', null));
    expect(resolveLeaseReadAccess('viewer', 'live')).toEqual(resolveLeaseReadAccess('editor', 'live'));
    expect(resolveLeaseReadAccess('viewer', 'history')).toEqual(resolveLeaseReadAccess('editor', 'history'));
  });

  it('keeps team-submission reads identical but business writes different by design', () => {
    expect(canViewLeaseTeamSubmissions('viewer')).toBe(true);
    expect(canViewLeaseTeamSubmissions('editor')).toBe(true);
    expect(canWriteBusinessData('viewer')).toBe(false);
    expect(canWriteBusinessData('editor')).toBe(true);
  });

  it('keeps Map role visibility identical for the same input dataset', () => {
    const buildings = [
      { id: 'a', grade: 'A' },
      { id: 'b', grade: 'B' },
      { id: 'bp', grade: 'BP' },
      { id: 'p', grade: 'P' },
    ] as any;
    const store = new MapDataStore(buildings);
    expect(store.getRoleVisible('viewer')).toEqual(store.getRoleVisible('editor'));
    expect(store.getRoleVisible('viewer')).toHaveLength(buildings.length);
  });

  it('keeps quarterly workspace readable for viewer but derives mutation from write capability', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/update/components/QuarterlyUpdateWorkspace.tsx'),
      'utf8',
    );
    expect(source).toContain("!['viewer', 'editor', 'admin'].includes(role)");
    expect(source).toContain(
      'const readOnly = !canWriteBusinessData(userRole) || isPreview || isImpersonating',
    );
  });

  it('keeps the service-role team API permanently open to viewer/editor reads', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/lease-submission/team-submissions/route.ts'),
      'utf8',
    );
    expect(source).toContain(
      'const canAccessTeamSubmissions = canViewLeaseTeamSubmissions(identity.effectiveRole)',
    );
    expect(source).not.toContain('editor_can_view_lease_team_submissions');
    expect(source).not.toContain("from('system_settings')");
  });

  it('removes the obsolete global team-read switch from Admin and RLS', () => {
    expect(fs.existsSync(
      path.join(process.cwd(), 'src/components/admin/LeaseTeamAccessControl.tsx'),
    )).toBe(false);
    expect(fs.existsSync(
      path.join(process.cwd(), 'src/app/api/admin/lease-team-access/route.ts'),
    )).toBe(false);

    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20260927074605_remove_lease_team_access_switch.sql',
      ),
      'utf8',
    );
    expect(migration).toContain("r.role in ('viewer', 'editor', 'admin')");
    expect(migration).toContain('drop table if exists public.system_settings');
    expect(migration).not.toContain('editor_can_view_lease_team_submissions');
  });

  it('keeps service-role mutations explicitly blocked for viewer', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/transfer-submission/route.ts'),
      'utf8',
    );
    expect(source).toContain('canWriteBusinessData(identity.effectiveRole)');
  });

  it('keeps team monitoring admin-only for both viewer and editor', () => {
    const page = fs.readFileSync(
      path.join(process.cwd(), 'src/app/lease-submission/page.tsx'),
      'utf8',
    );
    const monitoring = fs.readFileSync(
      path.join(process.cwd(), 'src/app/lease-submission/monitoring/page.tsx'),
      'utf8',
    );
    expect(page).toContain('{admin && <Link href="/lease-submission/monitoring"');
    expect(page).not.toContain('isDemoMode(userEmail)');
    expect(monitoring).toContain('if (!isUserAdmin(role))');
    expect(monitoring).not.toContain('isDemoMode');
  });

  it('keeps the latest-quarterly view explicitly read-only for authenticated users', () => {
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20260927052024_revoke_quarterly_latest_view_write_grants.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('revoke insert, update, delete, truncate, references, trigger');
    expect(migration).toContain('grant select on table public.view_latest_quarterly_submissions');
  });
});
