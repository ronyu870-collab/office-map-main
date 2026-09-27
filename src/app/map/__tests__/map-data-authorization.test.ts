import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (file: string) => readFileSync(resolve(root, file), 'utf8');

describe('map data authorization boundary', () => {
  it('routes map, future supply, comparison and trend reads through effective server identity', () => {
    const route = source('src/app/api/map/data/route.ts');
    const client = source('src/services/mapDataClient.ts');
    const controller = source('src/services/MapController.ts');
    const startup = source('src/app/map/runtime/mapStartupOptimization.ts');
    const compare = source('src/app/compare/BuildingCompareWorkspace.tsx');

    expect(route).toContain('resolveEffectiveRequestIdentity(request, admin)');
    expect(route).toContain("mode === 'map'");
    expect(route).toContain("mode === 'future'");
    expect(route).toContain("mode === 'compare'");
    expect(route).toContain("mode === 'trend'");
    expect(route).toContain(".or('project_type.neq.future,project_type.is.null')");
    expect(route).toContain("role === 'viewer' || role === 'editor' || role === 'admin'");

    expect(client).toContain('withImpersonationHeaders');
    expect(controller).toContain('fetchMapBuildingPayload("all")');
    expect(controller).toContain('fetchFutureSupplyPayload()');
    expect(controller).toContain('fetchBuildingTrendPayload(buildingId)');
    expect(startup).toContain("fetchMapBuildingPayload('latest')");
    expect(compare).toContain('fetchComparePayload()');

    expect(compare).not.toContain("from('buildings')");
    expect(compare).not.toContain("from('building_metrics')");
    expect(startup).not.toContain("from('buildings')");
  });

  it('keeps the database RLS contract aligned with the server role boundary', () => {
    const migration = source('supabase/migrations/20260927045505_viewer_readonly_editor_parity.sql');

    expect(migration).toContain('private.map_can_view_extended_inventory()');
    expect(migration).toContain('private.map_building_visible');
    expect(migration).toContain("r.role in ('viewer', 'editor', 'admin')");
    expect(migration).toContain('role scoped read buildings');
    expect(migration).toContain('role scoped read building metrics');
    expect(migration).toContain('role scoped read building brochure data');
    expect(migration).toContain('role scoped read future supplies');
    expect(migration).toContain('private.can_write_business_data()');
    expect(migration).toContain("r.role in ('editor', 'admin')");
  });
});
