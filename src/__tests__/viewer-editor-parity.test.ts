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

  it('keeps the service-role team API symmetric for viewer/editor reads', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/lease-submission/team-submissions/route.ts'),
      'utf8',
    );
    expect(source).toContain(
      "(callerRole === 'editor' || callerRole === 'viewer') && accessSetting?.boolean_value === true",
    );
  });

  it('keeps service-role mutations explicitly blocked for viewer', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/transfer-submission/route.ts'),
      'utf8',
    );
    expect(source).toContain('canWriteBusinessData(identity.effectiveRole)');
  });
});
