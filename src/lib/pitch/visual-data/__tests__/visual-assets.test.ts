import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { STUDIO_THEME } from '../../design/theme';
import { layoutSlides } from '../../layout/engine';
import { renderPitchPptx } from '../../render/pptx';
import { renderSceneSvg } from '../../render/svg';
import { contentHash, inspectPhotoBytes } from '../photo-file';
import { getBuildingPhotoChoices, loadBuildingPhotoMedia } from '../photos';
import { classifyBuildingPhoto, reusablePhotoLicense, selectBuildingPhotos, type PhotoCandidate } from '../photo-selection';
import { readPitchLocation, readPitchStackingPlan } from '../derived-assets';
import { createLocationSchematic, locationSchematicSvg } from '../location';
import { createStackingVisual } from '../stacking';
import { resolvePitchVisualAsset, resolveReferencedVisualMedia } from '../resolve';
import type { PitchContext } from '../../data/store';
import type { SlideContent } from '../../contracts/content';

const id = (i: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`;
const buildingId = id(1), secondId = id(2), photoId = id(3), actor = id(4), session = id(5);
const rights = { source_url: 'https://commons.wikimedia.org/wiki/File:Sample.jpg', source_name: 'Wikimedia Commons',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution_text: 'Test Photographer' };
const main = { id: buildingId, name: '测试楼宇', submarket: 'CBD', location_lat: 39.9111, location_lng: 116.456, city: '北京市' };
const competitor = { ...main, id: secondId, name: '测试竞品' };
const source = { id: 'source-1', building_id: buildingId, title: '合成资料', source_as_of: '2026-11-18',
  as_of_kind: 'source_data_as_of', review_state: 'date_confirmed' };
const towers = [{ id: id(10), building_id: buildingId, code: 'A', display_name: 'A 座' },
  { id: id(11), building_id: buildingId, code: 'B', display_name: 'B 座' }];
const floors = towers.map((tower, i) => ({ id: id(12 + i), tower_id: tower.id, floor_code: '18', level_order: 18,
  floor_area_sqm: '1800', zone: null, use_type: 'office', source_id: source.id }));
const spaces = [{ id: id(16), floor_id: floors[1].id, unit_code: '1801', occupancy_status: 'vacant', tenant_name: null,
  area_sqm: '691.57', verification_status: 'source_unverified', source_id: source.id, revision: 1 },
{ id: id(17), floor_id: floors[1].id, unit_code: '1802', occupancy_status: 'occupied', tenant_name: '测试租户',
  area_sqm: '941.84', verification_status: 'source_unverified', source_id: source.id, revision: 1 }];

let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#759395' } }).jpeg().toBuffer();
});
const rowFor = (bytes: Uint8Array, photo = photoId, building = buildingId) => ({
  id: photo, building_id: building, storage_path: `building-photos/v1/${building}/${photo}/original.jpg`,
  sha256: contentHash(bytes), file_size: bytes.byteLength, width: 1280, height: 720,
  photo_kind: 'exterior', caption: '测试外观', sort_order: 0, collected_at: '2026-11-18T00:00:00+00:00', ...rights,
});
type PhotoRow = ReturnType<typeof rowFor>;

function fixture(options: { rows?: PhotoRow[]; files?: Record<string, Uint8Array>; allowed?: boolean; stackingAdmin?: boolean;
  stackingExport?: boolean; revoke?: boolean; incompatiblePhoto?: boolean;
  buildings?: typeof main[]; ignoreCityFilter?: boolean } = {}) {
  const calls: string[] = [];
  let authReads = 0;
  const rows = options.rows ?? [rowFor(jpeg)];
  const catalog = options.buildings ?? [main, competitor];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.split('/').at(-1)!;
    calls.push(url.pathname);
    const revision = (options.revoke && authReads > 0 ? 'b' : 'a').repeat(64);
    if (path === 'ai_query_authority') {
      authReads++;
      return Response.json(options.allowed === false ? { allowed: false } : {
        allowed: true, access_policy: 'admin-only/1', actor_id: actor, effective_user_id: actor, session_id: session,
        policy_version: 'pilot/1', permission_revision: revision, capabilities: ['query:catalog', 'export:internal'], fields: [],
        all_submarkets: true, submarkets: [], all_buildings: true, building_ids: [],
      });
    }
    if (path === 'ai_query_snapshot_read') {
      const input = JSON.parse(String(init?.body));
      const selected = catalog.filter(item => (!input.p_building_ids || input.p_building_ids.includes(item.id))
        && (!input.p_submarkets || input.p_submarkets.includes(item.submarket)));
      return Response.json({ snapshot_id: id(7), database_snapshot: 'test', read_at: '2026-11-18T00:00:00Z', expected_count: selected.length,
        complete: true, periods: [], fields: [], inventory_time: 'current_catalog', brochure_selection: 'all_unresolved_record_candidates',
        rows: selected.map(item => ({ id: item.id, name: item.name, submarket: item.submarket, grade: 'A', is_active: true,
          tracking_scope: 'tracked', version: 'c'.repeat(64), metrics: [], brochures: [] })) });
    }
    if (path === 'buildings') {
      const cities = url.searchParams.get('city');
      return Response.json(catalog.filter(item => url.searchParams.get('id')?.includes(item.id)
        && (!cities || options.ignoreCityFilter || cities.slice(4, -1).split(',').includes(item.city))));
    }
    if (path === 'building_photos') {
      const scoped = rows.filter(row => url.searchParams.get('building_id')?.includes(row.building_id));
      const singleId = url.searchParams.get('id');
      if (singleId) return Response.json(options.incompatiblePhoto ? scoped : scoped.filter(row => singleId === `eq.${row.id}`));
      return Response.json(scoped);
    }
    if (path === 'ai_admin_session_authority') return Response.json(options.stackingAdmin !== false);
    if (path === 'ai_business_research_snapshot') return Response.json({ allowed: true, version: 'business-research/1',
      permission_revision: 'd'.repeat(64), export: options.stackingExport !== false, records: [] });
    if (path === 'stacking_plan_towers') return Response.json(towers);
    if (path === 'stacking_plan_floors') return Response.json(floors);
    if (path === 'stacking_plan_spaces') return Response.json(spaces);
    if (path === 'stacking_plan_sources') return Response.json([source]);
    if (path === 'audit_logs') return new Response(null, { status: 201 });
    if (url.pathname.startsWith('/storage/v1/object/building-sales-materials/')) {
      const photo = url.pathname.split('/').at(-2)!;
      const bytes = options.files ? options.files[photo] : jpeg;
      return bytes ? new Response(Uint8Array.from(bytes), { headers: { 'Content-Type': 'image/jpeg' } }) : new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  });
  const ctx: PitchContext = { client: createClient('https://isolated.invalid', 'test-only', { global: { fetch: fetcher },
    auth: { autoRefreshToken: false, persistSession: false } }), identity: { actorId: actor, effectiveUserId: actor, sessionId: session,
    expiresAt: Date.now() + 60_000 }, signal: new AbortController().signal };
  return { ctx, calls };
}

describe('building photo admission and actual scene bytes', () => {
  it('checks reuse permission and separates real, lobby, amenity and rendering classifications', () => {
    expect(reusablePhotoLicense({ ...rights, license_url: null })).toMatchObject({
      status: 'gallery-approved', attribution: rights.attribution_text, licenseUrl: null, cropAllowed: false,
    });
    expect(reusablePhotoLicense({ ...rights, attribution_text: '' })).toMatchObject({ status: 'gallery-approved', attribution: rights.source_name });
    expect(reusablePhotoLicense({ ...rights, source_url: 'file:///not-a-source' })).toBeNull();
    expect(reusablePhotoLicense({ ...rights, license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' })).toMatchObject({
      status: 'gallery-approved', licenseUrl: null,
    });
    expect(reusablePhotoLicense(rights)).toMatchObject({ cropAllowed: false });
    expect(classifyBuildingPhoto('interior', '首层大堂')).toBe('lobby');
    expect(classifyBuildingPhoto('other', '项目配套健身房')).toBe('amenity');
    expect(classifyBuildingPhoto('rendering', '大堂')).toBe('rendering');
  });

  it('picks a broad real exterior for covers and retains a shared comparison frame', () => {
    const license = reusablePhotoLicense(rights)!;
    const candidate = (photoId: string, buildingId: string, category: PhotoCandidate['category'], width: number, height: number): PhotoCandidate => ({
      id: photoId, buildingId, category, license, sortOrder: 0, imageTitle: '样本', collectedOn: '2026-11-18',
      file: { width, height, mime: 'image/jpeg', needsOrientation: false, sharpness: 20, sha256: contentHash(photoId) },
    });
    const wide = candidate(id(21), buildingId, 'exterior', 1920, 1080);
    const alternate = candidate(id(22), buildingId, 'exterior', 1800, 1200);
    const portrait = candidate(id(23), buildingId, 'exterior', 1200, 1600);
    const rendering = candidate(id(24), buildingId, 'rendering', 2560, 1440);
    const secondExterior = candidate(id(25), secondId, 'exterior', 1800, 1200);
    const files = [rendering, portrait, alternate, secondExterior, wide];
    expect(selectBuildingPhotos([buildingId], files, 'cover')[0].primary?.id).toBe(wide.id);
    expect(selectBuildingPhotos([buildingId], files, 'cover', [wide.file.sha256])[0].primary?.id).toBe(alternate.id);
    expect(selectBuildingPhotos([buildingId], [portrait], 'cover')[0]).toMatchObject({
      primary: { id: portrait.id }, placement: { fit: 'contain' },
    });
    const compare = selectBuildingPhotos([buildingId, secondId], files, 'comparison');
    expect(compare.map(item => item.primary?.category)).toEqual(['exterior', 'exterior']);
    expect(compare.map(item => item.placement)).toEqual([compare[0].placement, compare[0].placement]);
  });

  it('does not reach storage for denied, other-building, or duplicate content', async () => {
    const denied = fixture({ allowed: false });
    await expect(getBuildingPhotoChoices(denied.ctx, { buildingIds: [buildingId], use: 'cover' })).rejects.toThrow('QUERY_DENIED');
    expect(denied.calls).toHaveLength(1);
    const blocked = fixture({ rows: [rowFor(jpeg), rowFor(jpeg, id(8), secondId)] });
    expect(await getBuildingPhotoChoices(blocked.ctx, { buildingIds: [buildingId, secondId], use: 'comparison' }))
      .toEqual([buildingId, secondId].map(buildingId => ({ buildingId, primary: null, alternatives: [], placement: null })));
    expect(blocked.calls.some(call => call.startsWith('/storage/'))).toBe(false);
    const badPath = fixture({ rows: [{ ...rowFor(jpeg), storage_path: rowFor(jpeg, photoId, secondId).storage_path }] });
    expect((await getBuildingPhotoChoices(badPath.ctx, { buildingIds: [buildingId], use: 'cover' }))[0].primary).toBeNull();
    expect(badPath.calls.some(call => call.startsWith('/storage/'))).toBe(false);
  });

  it('pins an internally approved gallery photo while retaining attribution and the original file checks', async () => {
    const { ctx, calls } = fixture({ rows: [{ ...rowFor(jpeg), license_url: null }] });
    const [item] = await getBuildingPhotoChoices(ctx, { buildingIds: [buildingId], use: 'cover' });
    expect(item.primary).toMatchObject({ disclosure: 'internal', contentHash: contentHash(jpeg), rights: {
      attribution: rights.attribution_text, licenseName: null, licenseUrl: null, cropAllowed: false,
      clientDistribution: false, externalAi: false,
    } });
    expect(calls.some(call => call.startsWith('/storage/'))).toBe(true);
  });

  it('omits missing and corrupt files, including a corrupt original whose recorded hash matches', async () => {
    const corrupt = jpeg.subarray(0, Math.floor(jpeg.length / 2));
    await expect(inspectPhotoBytes(rowFor(corrupt), corrupt)).rejects.toThrow();
    const { ctx } = fixture({ rows: [rowFor(corrupt), rowFor(jpeg, id(8))], files: { [photoId]: corrupt } });
    expect((await getBuildingPhotoChoices(ctx, { buildingIds: [buildingId], use: 'cover' }))[0].primary).toBeNull();
  });

  it('repeats deterministically, pins file version and embeds actual bytes in both preview and Office', async () => {
    const { ctx } = fixture();
    const input = { buildingIds: [buildingId], use: 'cover' as const };
    const [item] = await getBuildingPhotoChoices(ctx, input);
    expect(await getBuildingPhotoChoices(ctx, input)).toEqual([item]);
    expect(item.placement).toMatchObject({ fit: 'contain', aspectRatio: 16 / 9 });
    expect(item.primary).toMatchObject({ kind: 'photo', buildingIds: [buildingId], origin: { photoId },
      contentHash: contentHash(jpeg), businessDate: null, sourceDateBasis: 'catalog-recorded' });
    const resolved = await loadBuildingPhotoMedia(ctx, item.primary!);
    const image = resolved.media;
    await expect(resolvePitchVisualAsset(ctx, item.primary!, 'client')).rejects.toThrow('QUERY_DENIED');
    const revoked = fixture({ revoke: true });
    await expect(resolvePitchVisualAsset(revoked.ctx, item.primary!, 'internal')).rejects.toThrow('QUERY_DENIED');
    const changed = await sharp(jpeg).modulate({ brightness: .8 }).jpeg().toBuffer();
    const revised = fixture({ rows: [rowFor(changed)], files: { [photoId]: changed } });
    await expect(loadBuildingPhotoMedia(revised.ctx, item.primary!)).rejects.toThrow('PITCH_SOURCE_CHANGED');
    const wrong = fixture({ rows: [rowFor(jpeg, id(9))], incompatiblePhoto: true });
    await expect(loadBuildingPhotoMedia(wrong.ctx, item.primary!)).rejects.toThrow('PITCH_MEDIA_UNAVAILABLE');
    const content: SlideContent = { protocol: 'colliers-pitch/1', locale: 'zh', title: '测试项目', dataAsOf: '2026-11-18',
      disclosure: 'internal', isTestData: true, sources: [{ id: id(7), kind: 'synthetic', label: rights.attribution_text,
        locator: '隔离导出回归', version: 'test', dataAsOf: '2026-11-18' }],
      blocks: [{ kind: 'image', mediaAssetId: image.id, mediaVersion: image.version, alt: '测试外观', sourceIds: [id(7)] }] };
    const [scene] = await layoutSlides(content, STUDIO_THEME, 'cover');
    expect(await renderSceneSvg(scene, STUDIO_THEME, [image])).toContain(Buffer.from(jpeg).toString('base64'));
    const archive = await JSZip.loadAsync(await renderPitchPptx('测试项目', [{ scene, theme: STUDIO_THEME }], [image]));
    const media = Object.values(archive.files).filter(entry => /^ppt\/media\/.*\.jpeg$/i.test(entry.name));
    expect(await Promise.all(media.map(async entry => contentHash(await entry.async('uint8array'))))).toContain(contentHash(jpeg));
    const relationships = await archive.file('ppt/slides/_rels/slide1.xml.rels')?.async('text');
    expect(relationships).not.toContain('TargetMode="External"');
  });
});

describe('location and stacking service boundaries', () => {
  it('resolves a whole-city quarterly map through the allowed catalog and excludes same-name submarkets in other cities', async () => {
    const otherCity = { ...competitor, city: '上海' };
    const { ctx } = fixture({ buildings: [main, otherCity] });
    const map = await readPitchLocation(ctx, { city: 'Beijing', submarkets: [] });
    expect(map?.scene.title).toBe('北京子市场项目分布');
    expect(map?.reference.origin).toMatchObject({ type: 'market-locations', city: '北京' });
    expect(map?.reference.buildingIds).toEqual([buildingId]);
    expect((await resolvePitchVisualAsset(ctx, map?.reference, 'internal')).reference).toEqual(map?.reference);
    await expect(readPitchLocation(ctx, { submarkets: [] })).rejects.toThrow();
    expect(await readPitchLocation(ctx, { city: '北京', submarkets: ['缺少该子市场'] })).toBeNull();
    const invalidBackend = fixture({ buildings: [main, otherCity], ignoreCityFilter: true });
    await expect(readPitchLocation(invalidBackend.ctx, { city: '北京' })).rejects.toThrow('QUERY_DENIED');
  });

  it('resolves only referenced scene media, deduplicates repeated images, and rejects conflicting pins', async () => {
    const { ctx, calls } = fixture();
    const [choice] = await getBuildingPhotoChoices(ctx, { buildingIds: [buildingId], use: 'cover' });
    const photo = choice.primary!;
    const unused = (await readPitchLocation(ctx, { buildingIds: [buildingId] }))!.reference;
    const storageCalls = () => calls.filter(path => path.startsWith('/storage/')).length;
    const before = storageCalls();
    const media = await resolveReferencedVisualMedia(ctx, [photo, unused, photo], [photo, photo], 'internal');
    expect(media).toHaveLength(1);
    expect(contentHash(media[0].bytes)).toBe(photo.contentHash);
    expect(storageCalls()).toBe(before + 1);
    await expect(resolveReferencedVisualMedia(ctx, [photo, { ...photo, versionHash: 'b'.repeat(64) }], [photo], 'internal'))
      .rejects.toThrow('PITCH_SOURCE_CHANGED');
    await expect(resolveReferencedVisualMedia(ctx, [photo], [photo], 'client')).rejects.toThrow('QUERY_DENIED');
    expect(storageCalls()).toBe(before + 1);
  });

  it('preserves matching coordinates, visually separates co-located numbers and accounts for missing points', async () => {
    const unlocated = { ...main, id: id(20), name: '缺坐标项目', location_lat: null };
    const scene = createLocationSchematic([main, competitor, unlocated], competitor.id)!;
    expect(scene.markers[0]).toMatchObject({ target: false, number: 1 });
    expect(scene.markers[1]).toMatchObject({ target: true, number: 2 });
    expect(scene.markers[0].point).toEqual(scene.markers[1].point);
    expect(scene.markers[0].callout).not.toEqual(scene.markers[1].callout);
    expect(scene.markers[2].point).toBeNull();
    expect(scene.scale.meters).toBeGreaterThan(0);
    const svg = await locationSchematicSvg(scene);
    expect(svg).toContain('坐标示意图');
    expect(svg).toContain('无底图');
    expect(svg).toContain('缺坐标项目');
    const { ctx } = fixture();
    const map = await readPitchLocation(ctx, { submarkets: ['CBD'] });
    expect(map?.scene.marketCoverage).toEqual([{ name: 'CBD', located: 2, selected: 2 }]);
    expect(map?.media).toMatchObject({ mime: 'image/png', width: 2560, height: 1440 });
    expect((await resolvePitchVisualAsset(ctx, map?.reference, 'internal')).reference).toEqual(map?.reference);
  });

  it('rejects denied stacking before reading tenant records, and never labels an undated vacant unit as usable inventory', async () => {
    for (const options of [{ stackingAdmin: false }, { stackingExport: false }]) {
      const { ctx, calls } = fixture(options);
      await expect(readPitchStackingPlan(ctx, buildingId, {}, false)).rejects.toThrow('QUERY_DENIED');
      expect(calls.some(call => call.includes('/stacking_plan_spaces'))).toBe(false);
    }
    const unconfirmed = createStackingVisual(main, { towers, floors, spaces, sources: [{ ...source, source_as_of: null }] }, {})!;
    expect(unconfirmed.structured.towers[1].floors[0].units[0]).toMatchObject({ status: 'unknown', sourceStatus: 'vacant' });
    expect(unconfirmed.structured.businessDate).toBeNull();
    const { ctx } = fixture();
    const plan = await readPitchStackingPlan(ctx, buildingId, { towerIds: [towers[1].id], levelRange: [18, 18] }, true);
    expect(plan?.document.businessDate).toBe('2026-11-18');
    expect(plan?.document.towers).toHaveLength(1);
    expect(plan?.document.towers[0].floors[0].units[0]).toMatchObject({ areaSqm: 691.57, verification: 'source_unverified', industry: null });
    expect(plan?.document.towers[0].floors[0].units[1]).toMatchObject({ tenantName: '测试租户', areaSqm: 941.84 });
    expect(plan?.reference.rights).toMatchObject({ externalAi: false, clientDistribution: false });
    expect(plan?.media).toMatchObject({ width: 2048, mime: 'image/png' });
    expect((await resolvePitchVisualAsset(ctx, plan?.reference, 'internal', { stackingImage: true })).reference).toEqual(plan?.reference);
    const deniedNative = fixture({ stackingAdmin: false });
    await expect(resolveReferencedVisualMedia(deniedNative.ctx, [plan?.reference], [], 'internal')).rejects.toThrow('QUERY_DENIED');
    expect(deniedNative.calls.some(call => call.includes('/stacking_plan_spaces'))).toBe(false);
  });
});
