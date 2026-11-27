import type { SupabaseClient } from '@supabase/supabase-js';
import type { PitchContext } from '../data/store';
import { describe, expect, it, vi } from 'vitest';
import { loadPitchDemoContext, loadUnifiedPitchContext } from './adapter';
import { profileFieldNames } from '@/src/lib/intelligence/business/protocol';

const id = (n: number) => '10101010-1010-4010-8010-' + String(n).padStart(12, '0');
const v = 'a'.repeat(64);
const q2 = { year: 2026, quarter: 2 };
const q3 = { year: 2026, quarter: 3 };
const source = '2026-07-01T09:00:00.000Z';
const allFields = ['height', 'floors', 'parking', 'totalArea', 'netEffectiveRent', 'vacantArea'];
const catalog = [
  { id: id(1), name: '霄云路33号', submarket: '燕莎', grade: 'A', city: '北京市', former_names: ['合成旧名'], location_lng: 116.45, location_lat: 39.93 },
  { id: id(2), name: '合成燕莎同级', submarket: '燕莎', grade: 'A', city: '北京', former_names: [], location_lng: 116.46, location_lat: 39.93 },
  { id: id(3), name: '合成燕莎乙级', submarket: '燕莎', grade: 'B', city: '北京', former_names: [], location_lng: null, location_lat: null },
  ...Array.from({ length: 6 }, (_, i) => ({ id: id(10 + i), name: '合成CBD' + i, submarket: 'CBD', grade: i > 3 ? 'P' : 'A',
    city: '北京市', former_names: [], location_lng: null, location_lat: null })),
  { id: id(20), name: '合成外市', submarket: 'CBD', grade: 'A', city: '外市', former_names: [], location_lng: null, location_lat: null },
];
const quarterly = (building: string, year: number) => ({
  totalArea: '30000', vacantArea: building === id(1) ? '0' : '3000',
  netEffectiveRent: building === id(10) ? null : year < 2026 ? '200' : '250',
});
type Quarter = { year: number; quarter: number };
type Args = { p_inventory?: string; p_building_ids?: string[]; p_submarkets?: string[]; p_fields?: string[];
  p_periods?: Quarter[]; p_plan?: { tool: string; fields?: string[]; buildingIds?: string[]; submarkets?: string[] } };
type Options = { noExport?: boolean; denyBusiness?: boolean; denyLease?: boolean; restrictedFactual?: boolean; revokeOnDelivery?: boolean; projectAlias?: boolean };

function fixture(options: Options = {}) {
  let authorityReads = 0;
  const business = (args: Args) => {
    const plan = args.p_plan!;
    if (options.denyBusiness) return { allowed: false };
    if (plan.tool === 'capabilities') return { allowed: true, modules: ['profile', 'submarket', 'stacking'], profileFields: profileFieldNames, submissions: false, export: true };
    const evidence = (table: string, record: string, values: Record<string, string | null>) =>
      ({ table, id: record, values, version: v, recordedAt: source, asOf: null, period: null });
    let records;
    if (plan.tool === 'query_submarket_profile') records = plan.submarkets!.map(market => {
      const editorial = { headline: '合成研究定位', overview: '合成研究概况', industries: '合成产业', transport: '合成交通',
        insights: [{ title: '样本说明', body: '合成研究观点', author: '合成研究团队', asOf: '2026Q2' }] };
      return { id: market, name: market, buildingId: null, editorial, data: [evidence('map_submarket_profiles', market,
        { headline: editorial.headline, overview: editorial.overview, industries: editorial.industries, transport: editorial.transport,
          name: market, published: market === '燕莎' ? 'true' : 'false' })] };
    });
    else records = plan.buildingIds!.flatMap(buildingId => {
      const building = catalog.find(row => row.id === buildingId)!;
      if (plan.tool === 'query_building_towers') return ['A', 'B'].map((code, i) => ({
        id: id(500 + i), name: building.name, buildingId, data: [evidence('stacking_plan_towers', id(100 + i), { tower: code + ' 座', towerCode: code })],
      }));
      return [{ id: building.id, name: building.name, buildingId, data: [
        evidence('buildings', building.id, { name: building.name, completionYear: '2022', grade: building.grade }),
        evidence('building_brochure_data', id(300 + Number(buildingId.slice(-2))), {
          nameEn: 'Synthetic Office', brochureGrade: '楼书原等级', parking: '0', gfaOffice: null, gfaTotal: '31000',
        }),
        ...(buildingId === id(1) ? [evidence('building_brochure_data', id(399), { parking: '0', gfaTotal: '32000' })] : []),
      ] }];
    });
    return { allowed: true, version: 'business-research/1', permission_revision: v, export: true, records };
  };
  const rpc = vi.fn((method: string, args: Args) => {
    let data: unknown;
    if (method === 'ai_query_authority') {
      authorityReads++;
      data = { allowed: true, access_policy: 'admin-only/1', actor_id: id(1000), effective_user_id: id(1000), session_id: id(1001),
        policy_version: 'policy/1', permission_revision: options.revokeOnDelivery && authorityReads > 1 ? 'b'.repeat(64) : v,
        capabilities: ['query:catalog', 'query:brochure', 'query:quarter', ...(!options.noExport ? ['export:internal'] : [])],
        fields: options.restrictedFactual ? ['totalArea', 'vacantArea'] : allFields,
        all_submarkets: true, submarkets: [], all_buildings: true, building_ids: [] };
    } else if (method === 'ai_query_available_periods') {
      data = { version: 'authorized-periods/1', permission_revision: v, read_at: source, inventory_time: 'current_catalog',
        fields: args.p_fields, truncated: false, periods: [q2] };
    } else if (method === 'ai_query_snapshot_read') {
      const fields = args.p_fields ?? [], periods = args.p_periods ?? [];
      const rows = catalog.filter(row => (!args.p_building_ids || args.p_building_ids.includes(row.id)) && (!args.p_submarkets || args.p_submarkets.includes(row.submarket)))
        .map(row => ({ id: row.id, name: row.name, submarket: row.submarket, grade: row.grade, is_active: true, tracking_scope: 'tracked', version: v,
          brochures: [], metrics: periods.filter(period => fields.length && (period.year < 2026 || period.quarter <= 2)).map(period => ({
            id: row.id + ':' + period.year + ':' + period.quarter, year: period.year, quarter: period.quarter, recorded_at: source, version: v,
            values: Object.fromEntries(fields.map(field => [field, quarterly(row.id, period.year)[field as keyof ReturnType<typeof quarterly>]])),
          })) }));
      data = { snapshot_id: id(2000), database_snapshot: '1:1:', read_at: source, expected_count: rows.length, complete: true, periods, fields,
        inventory_time: 'current_catalog', brochure_selection: 'all_unresolved_record_candidates', rows };
    } else if (method === 'ai_business_research_snapshot') data = business(args);
    else if (method === 'ai_lease_research_snapshot') {
      data = options.denyLease ? { allowed: false } : {
        allowed: true, version: 'lease-research/1', permission_revision: v, sources: ['live', 'history'], details: true, financials: false, export: true, minGroupSize: 3,
        links: [], rows: ['0', '500', '1000', '3000', null].map((area, index) => ({
          id: 'live:' + id(600 + index), source: 'live', fingerprint: v, buildingId: id(1), building: catalog[0].name, alias: null,
          match: 'exact', submarket: '燕莎', industry: '合成行业', start: '2026-05-01', end: '2026-05-01', precision: 'date', area, quality: null, financials: {},
        })),
      };
    } else throw new Error('Unexpected RPC ' + method);
    return { abortSignal: async () => ({ data, error: null }) };
  });
  const from = vi.fn((table: string) => {
    let values: unknown[] = [];
    const query = {
      select: () => query, eq: () => query, is: () => query, or: () => query, limit: () => query,
      in: (key: string, ids: string[]) => {
        if (table === 'buildings' && key === 'id') values = catalog.filter(row => ids.includes(row.id));
        if (table === 'lease_building_project_map' && options.projectAlias) values = [{ building_id: id(1) }, { building_id: id(2) }];
        return query;
      },
      abortSignal: async () => ({ data: values, error: null }),
    };
    return query;
  });
  const ctx: PitchContext = { client: { rpc, from } as unknown as SupabaseClient,
    identity: { actorId: id(1000), effectiveUserId: id(1000), sessionId: id(1001), expiresAt: Date.now() + 50000 },
    signal: new AbortController().signal };
  return { ctx, rpc, from };
}

describe('Unified Pitch Context from the real query adapters', () => {
  it('resolves the agency project, preserves distinct tower IDs, formal zeros, source conflicts and permitted research', async () => {
    const { ctx, rpc } = fixture();
    const result = await loadPitchDemoContext(ctx, 'xiaoyun-agency');
    const target = result.buildings[0];
    expect(result.period).toEqual(q2);
    expect(target.buildingId).toBe(id(1));
    expect(target.towers.map(tower => [tower.buildingId, tower.code.value])).toEqual([[id(1), 'A'], [id(1), 'B']]);
    expect(target.static.nameEn).toMatchObject({ value: 'Synthetic Office', sources: [{ field: 'name_en' }] });
    expect(target.static.gfaTotal).toMatchObject({ value: null, state: 'conflict' });
    expect(target.static.gfaTotal.sources.map(record => record.rawValue)).toEqual(['31000', '32000']);
    expect(target.static.gfaOffice).toMatchObject({ value: null, state: 'not_reported' });
    expect(target.static.buildingAge.value).toBe(4);
    expect(target.static.parking.value).toBe(0);
    expect(target.static.grade.value).toBe('A');
    expect(target.static.brochureGrade.value).toBe('楼书原等级');
    expect(target.quarter.vacancy).toMatchObject({ value: 0, unit: 'ratio', period: q2, permission: 'authorized' });
    expect(target.quarter.vacancy.sources.map(record => record.table)).toEqual(['building_metrics', 'building_metrics']);
    expect(result.candidates[0]).toMatchObject({ buildingId: id(2), reasons: expect.arrayContaining(['same_grade_family', 'within_2_km']) });
    expect(result.candidates[1].missing).toContain('coordinates');
    expect(result.results.map(row => row.id)).toEqual(expect.arrayContaining(['燕莎:rent', 'lease-target', 'lease-area', 'lease-industry', 'lease-representatives']));
    expect(result.results.find(row => row.id === 'lease-representatives')?.result.sources.some(record => record.id.startsWith('lease-detail:'))).toBe(true);
    expect(result.research).toEqual([expect.objectContaining({ entityId: '燕莎', source: expect.objectContaining({ businessAsOf: '2026Q2', recordId: '燕莎' }) })]);
    expect(rpc.mock.calls.filter(([name]) => name === 'ai_lease_research_snapshot')).toHaveLength(1);
  });

  it('returns five actual catalog IDs with selected-period formal metrics for CBD comparison', async () => {
    const result = await loadPitchDemoContext(fixture().ctx, 'cbd-grade-a');
    expect(result.buildings).toHaveLength(5);
    expect(result.buildings.map(b => b.buildingId).sort()).toEqual([11, 12, 13, 14, 15].map(id));
    expect(result.buildings.every(b => b.quarter.netEffectiveRent.state === 'valid' && b.quarter.vacancy.state === 'valid')).toBe(true);
    expect(result.research).toEqual([]);
  });

  it('keeps latest and explicit scope distinct with no natural-quarter fallback and no material fed to missing cells', async () => {
    const { ctx, rpc } = fixture();
    const result = await loadPitchDemoContext(ctx, 'building-promotion', { buildingIds: [id(1)], period: q3 });
    expect(result.periodBasis).toBe('explicit');
    expect(result.period).toEqual(q3);
    expect(result.buildings[0].quarter.totalArea).toMatchObject({ value: null, period: q3, state: 'not_reported' });
    expect(result.buildings[0].quarter.totalArea.sources).toEqual([]);
    expect(result.buildings[0].history.at(-2)?.totalArea.value).toBe(30000);
    expect(result.gaps).toContainEqual({ section: 'period', reason: 'no_formal_records_for_requested_period' });
    expect(rpc.mock.calls.some(([name]) => name === 'ai_query_available_periods')).toBe(false);
  });

  it('uses tracked Beijing offices, compares market periods with shared arithmetic and returns trusted lease distributions', async () => {
    const result = await loadPitchDemoContext(fixture().ctx, 'beijing-quarterly', { period: q2 });
    expect(result.results.map(item => item.id)).toEqual(expect.arrayContaining(['北京:rent', '北京:submarkets:vacancy', '北京:trend:totalArea',
      '北京:qoq:vacancy', '北京:yoy:rent', '北京:grades:rent', 'lease-industry', 'lease-area']));
    const grades = result.results.find(item => item.id === '北京:grades:rent')!.result;
    expect(grades.parameters).toMatchObject({ groupBy: 'grade', period: q2 });
    expect(grades.table.rows.map(row => row.cells.name)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'text', value: 'A' }), expect.objectContaining({ kind: 'text', value: 'B' }),
    ]));
    expect(grades.sources.some(record => record.entityId === id(20))).toBe(false);
    const yoy = result.results.find(item => item.id === '北京:yoy:rent')!;
    expect(yoy.result.table.rows[0].cells.change).toMatchObject({ value: { numeric: 25 } });
    expect(yoy.result.sources.some(record => record.entityId === id(20))).toBe(false);
  });

  it('filters on authorized size, rent, vacancy ratio and grade without including missing values', async () => {
    const { ctx } = fixture();
    const result = await loadUnifiedPitchContext(ctx, {
      scenario: 'site-selection', submarkets: ['燕莎'], period: q2,
      filters: { grade: 'a', quarterArea: { min: 30000, max: 30000 },
        rent: { min: 250 }, vacancy: { min: 0.1, max: 0.1 } },
    });
    expect(result.candidates.map(row => row.buildingId)).toEqual([id(2)]);
  });

  it('keeps a governed project alias unresolved and returns candidate names to disambiguate', async () => {
    const result = await loadUnifiedPitchContext(fixture({ projectAlias: true }).ctx, {
      scenario: 'building-promotion', buildingQuery: '合成项目别名', period: q2,
    });
    expect(result.buildings).toEqual([]);
    expect(result.gaps).toContainEqual({ section: 'building', reason: 'identity_project' });
    expect(result.candidates.map(row => row.buildingId)).toEqual([id(1), id(2)]);
  });

  it('enforces permission and does not confuse denied fields or lease source with missing or zero', async () => {
    await expect(loadPitchDemoContext(fixture({ noExport: true }).ctx, 'beijing-quarterly')).rejects.toThrow('QUERY_DENIED');
    await expect(loadPitchDemoContext(fixture({ revokeOnDelivery: true }).ctx, 'beijing-quarterly', { period: q2 })).rejects.toThrow('QUERY_DENIED');
    await expect(loadPitchDemoContext(fixture().ctx, 'building-promotion', { buildingIds: [id(404)] })).rejects.toThrow('QUERY_DENIED');
    const result = await loadPitchDemoContext(fixture({ denyBusiness: true, denyLease: true, restrictedFactual: true }).ctx, 'xiaoyun-agency');
    expect(result.buildings[0].static.gfaTotal).toMatchObject({ state: 'unauthorized', disclosure: 'withheld', value: null });
    expect(result.buildings[0].quarter.netEffectiveRent).toMatchObject({ state: 'unauthorized', disclosure: 'withheld', value: null });
    expect(result.buildings[0].quarter.vacancy.value).toBe(0);
    expect(result.gaps).toContainEqual({ section: 'lease', reason: 'lease_source_or_export_not_authorized' });
  });

  it('deduplicates identical concurrent requests only and keeps stable fingerprint across separately authorized reads', async () => {
    const { ctx, rpc } = fixture();
    const request = { scenario: 'building-promotion', buildingIds: [id(1), id(1)], period: q2 };
    const first = loadUnifiedPitchContext(ctx, request), second = loadUnifiedPitchContext(ctx, { ...request, buildingIds: [id(1)] });
    expect(second).toBe(first);
    const a = await first, b = await loadUnifiedPitchContext(ctx, request);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(rpc.mock.calls.filter(([name]) => name === 'ai_query_snapshot_read')).toHaveLength(4);
    expect(rpc.mock.calls.filter(([name]) => name === 'ai_query_authority')).toHaveLength(4);
  });
});
