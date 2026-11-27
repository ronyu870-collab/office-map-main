import { coordinateIssue } from '@/src/lib/map-coordinates';
import { normalizeMapSubmarket, officeGrade, submarketDatabaseNames } from '@/src/app/map/model/marketIdentity';
import { loadBusinessSnapshot, businessCapabilities, buildBusinessResult } from '@/src/lib/intelligence/business/research';
import { BUSINESS_DOMAIN, businessPlanSchema, profileFields, profileFieldNames, type BusinessPlan, type BusinessSnapshot } from '@/src/lib/intelligence/business/protocol';
import { buildLeaseResult, loadLeaseSnapshot } from '@/src/lib/intelligence/lease/research';
import { LEASE_DOMAIN, leasePlanSchema, type LeasePlan } from '@/src/lib/intelligence/lease/protocol';
import { readAvailablePeriodGroups } from '@/src/lib/intelligence/query/availablePeriods';
import { quarterKey, type BuildingFacts, type FactSnapshot, type Quarter } from '@/src/lib/intelligence/query/contracts';
import type { AggregateMetric } from '@/src/lib/intelligence/query/analytics';
import type { QueryPlan } from '@/src/lib/intelligence/query/plan';
import type { NumericField } from '@/src/lib/intelligence/query/registry';
import { shiftQuarter } from '@/src/lib/intelligence/query/relativeQuarter';
import { buildAggregateResult, buildCompareResult, buildGroupedResult, buildListResult, buildTrendResult, type QueryResult } from '@/src/lib/intelligence/query/result';
import { readQuerySnapshots } from '@/src/lib/intelligence/query/snapshotReader';
import { loadDataAuthority, type DataAuthority } from '@/src/lib/intelligence/query/serverAuthority';
import type { PitchContext } from '../data/store';
import { aliases, comparableGradeA, filterPitchCandidates, readPitchCatalogMetadata, resolvePitchBuilding, shortlistPitchPeers, type Metadata } from './unified-catalog';
import { buildingAge, catalogValue, evidenceHash, missingValue, projectValue, quarterEnd, resultDataVersion } from './unified-evidence';
import { publishedResearch, readPitchTowerIdentities } from './unified-related';
import { unifiedPitchRequestSchema, type PitchBuildingContext, type PitchCandidate, type PitchContextReceipt, type PitchContextResult, type PitchDemo, type PitchGap, type PitchValue, type UnifiedPitchContext, type UnifiedPitchRequest } from './unified-context-protocol';

const periodFields = ['totalArea', 'netEffectiveRent', 'vacantArea'] as const;
const quarterUnits = { totalArea: 'm2', netEffectiveRent: 'CNY/m2/month', vacantArea: 'm2', vacancy: 'ratio' } as const;
const officeMetrics: AggregateMetric[] = ['rent', 'vacancy', 'totalArea'];
const sameQuarter = (a: Quarter | null, b: Quarter) => a && quarterKey(a) === quarterKey(b);
const canonicalCity = (city: string) => city.trim().replace(/市$/, '');
const denied = (error: unknown) => error instanceof Error && error.message === 'QUERY_DENIED';

function marketScope(authority: DataAuthority, markets: readonly string[]): QueryPlan['scope'] {
  const selected = [...new Set(markets.flatMap(name => {
    const aliases = submarketDatabaseNames(name);
    const allowed = authority.allSubmarkets ? aliases : aliases.filter(alias => authority.submarkets.includes(alias));
    if (!allowed.length) throw new Error('QUERY_DENIED');
    return allowed;
  }))].sort();
  return { inventory: 'tracked', ...(selected.length ? { submarkets: selected } : {}) };
}

function projectSnapshot(snapshot: FactSnapshot, buildingIds: ReadonlySet<string>, scope: string): FactSnapshot {
  const rows = snapshot.rows.filter(row => buildingIds.has(row.id));
  return { ...snapshot, rows, expectedCount: rows.length, scopeFingerprint: evidenceHash([snapshot.scopeFingerprint, scope, [...buildingIds].sort()]),
    queryScope: { ...snapshot.queryScope, pitchScope: scope } };
}

const catalogName = (row: BuildingFacts, field: 'submarket' | 'grade') => row.dimensions?.[field]?.value ?? null;
const marketOf = (row: BuildingFacts) => normalizeMapSubmarket(catalogName(row, 'submarket'));

async function resolvePeriod(ctx: PitchContext, auth: DataAuthority, input: UnifiedPitchRequest, scope: QueryPlan['scope'], fields: NumericField[]) {
  if (input.period || !fields.length) return input.period;
  const groups: NumericField[][] = [];
  if (fields.includes('totalArea') && fields.includes('netEffectiveRent')) groups.push(['totalArea', 'netEffectiveRent']);
  if (fields.includes('totalArea') && fields.includes('vacantArea')) groups.push(['totalArea', 'vacantArea']);
  if (!groups.length) groups.push([fields[0]]);
  const available = await readAvailablePeriodGroups(ctx.client, ctx.identity, auth, scope, groups, ctx.signal);
  return available.periods.at(-1) ?? available.fieldGroups?.flatMap(group => group.periods)
    .sort((a, b) => b.year - a.year || b.quarter - a.quarter)[0] ?? null;
}

function quarterValues(result: QueryResult | undefined, id: string, period: Quarter | null, fields: readonly NumericField[]) {
  const cells = result?.table.rows.find(row => row.entityId === id)?.cells;
  const sourceMap = new Map(result?.sources.map(source => [source.id, source]) ?? []);
  return Object.fromEntries(Object.entries(quarterUnits).map(([field, unit]) => {
    const authorized = field === 'vacancy' ? fields.includes('totalArea') && fields.includes('vacantArea') : fields.includes(field as NumericField);
    const value = !authorized ? missingValue(id, field, unit, period, 'unauthorized', 'quarter_field_not_authorized')
      : !period ? missingValue(id, field, unit, null, 'unknown', 'no_applicable_formal_period')
      : projectValue(id, field, cells?.[field], unit, period, sourceMap);
    return [field, value];
  }));
}

type BusinessRead = { result: QueryResult; snapshot: BusinessSnapshot };

async function readBusiness(ctx: PitchContext, plan: BusinessPlan): Promise<BusinessRead | null> {
  try {
    const snapshot = await loadBusinessSnapshot(ctx.client, ctx.identity, ctx.signal, plan);
    if (!snapshot.export) return null;
    return { result: buildBusinessResult(snapshot, plan), snapshot };
  } catch (error) {
    if (denied(error)) return null;
    throw error;
  }
}

function buildingStatic(row: BuildingFacts, metadata: Metadata, profiles: BusinessRead | null, period: Quarter | null) {
  const cells = profiles?.result.table.rows.find(record => record.entityId === row.id)?.cells;
  const sources = new Map(profiles?.result.sources.map(source => [source.id, source]) ?? []);
  const staticFields: Record<string, PitchValue> = Object.fromEntries(profileFieldNames.filter(field => field !== 'availablePeriods').map(field => {
    const cell = cells?.[field];
    return [field, cell ? projectValue(row.id, field, cell, profileFields[field][1], null, sources)
      : missingValue(row.id, field, profileFields[field][1], null, 'unauthorized', 'business_field_not_authorized')];
  }));
  for (const [field, value] of Object.entries(row.dimensions ?? {})) {
    staticFields[field] = projectValue(row.id, field, value.value === null
      ? { kind: 'unknown', state: 'missing', reason: 'catalog_dimension_missing', sourceIds: [value.source.id] }
      : { kind: 'text', value: value.value, sourceIds: [value.source.id] }, null, null, new Map([[value.source.id, value.source]]));
  }
  for (const [field, column, value, unit] of [
    ['city', 'city', metadata.city, null],
    ['formerNames', 'former_names', aliases(metadata), null],
    ['longitude', 'location_lng', metadata.location_lng, 'degree'],
    ['latitude', 'location_lat', metadata.location_lat, 'degree'],
  ] as const) {
    staticFields[field] = catalogValue(row, field, column, value, unit);
  }
  const locationIssue = coordinateIssue(metadata);
  if (locationIssue && locationIssue !== 'missing') for (const field of ['longitude', 'latitude']) {
    staticFields[field] = { ...staticFields[field], value: null, state: 'invalid', reason: locationIssue };
  }
  staticFields.name = projectValue(row.id, 'name', { kind: 'text', value: row.name, sourceIds: [row.nameSource.id] }, null, null,
    new Map([[row.nameSource.id, row.nameSource]]));
  staticFields.buildingAge = buildingAge(staticFields.completionYear, period);
  return staticFields;
}

function leasePlans(input: UnifiedPitchRequest, period: Quarter | null, markets: string[], buildingIds: string[]) {
  const requested = input.lease;
  if (!requested && !period) return [];
  const start = period && { year: Math.max(1900, period.year - 1), quarter: period.quarter };
  const from = requested?.from ?? (start!.year + '-' + String((start!.quarter - 1) * 3 + 1).padStart(2, '0') + '-01');
  const base = { source: requested?.source ?? 'combined', from, to: requested?.to ?? quarterEnd(period!),
    ...(markets.length ? { submarkets: markets } : {}) };
  const grouping = [
    { id: 'lease-trend', groupBy: 'quarter', sort: 'period', direction: 'asc' },
    { id: 'lease-industry', groupBy: 'industry', sort: 'area', direction: 'desc' },
    { id: 'lease-area', groupBy: 'area_band', sort: 'count', direction: 'desc' },
  ];
  return [
    ...grouping.map(({ id, ...plan }) => ({ id, plan: leasePlanSchema.parse({ ...base, ...plan }) })),
    { id: 'lease-representatives', plan: leasePlanSchema.parse({ ...base, mode: 'details',
      fields: ['building', 'submarket', 'industry', 'period', 'precision', 'area', 'identity', 'source'], sort: 'area', topN: 5 }) },
    ...(buildingIds.length ? [{ id: 'lease-target', plan: leasePlanSchema.parse({ ...base, buildingIds,
      groupBy: 'quarter', sort: 'period', direction: 'asc' }) }] : []),
  ];
}

async function readLease(ctx: PitchContext, plans: { id: string; plan: LeasePlan }[], entityId: string, gaps: PitchGap[], sourceExplicit: boolean) {
  if (!plans.length) return [];
  try {
    const snapshot = await loadLeaseSnapshot(ctx.client, ctx.identity, ctx.signal);
    if (!snapshot.export) throw new Error('QUERY_DENIED');
    const fallbackSource = !sourceExplicit && snapshot.sources.length === 1 ? snapshot.sources[0] : null;
    if (fallbackSource) gaps.push({ section: 'lease', reason: 'only_authorized_source:' + fallbackSource });
    return plans.flatMap(({ id, plan: requested }) => {
      const plan = fallbackSource ? { ...requested, source: fallbackSource } : requested;
      try {
        const result = buildLeaseResult(snapshot, plan, { includeDetailSources: true });
        return [boundResult(id, entityId, result, 'lease', snapshot.permission_revision, LEASE_DOMAIN, plan.to)];
      } catch (error) {
        if (!denied(error)) throw error;
        gaps.push({ section: 'lease', reason: id + ':unauthorized' });
        return [];
      }
    });
  } catch (error) {
    if (!denied(error)) throw error;
    gaps.push({ section: 'lease', reason: 'lease_source_or_export_not_authorized' });
    return [];
  }
}

function boundResult(id: string, entityId: string, result: QueryResult, domain: PitchContextReceipt['domain'],
  permissionRevision: string, policyVersion: string, dataAsOf: string | null): PitchContextResult {
  return { id, entityId, result, binding: { domain, permissionRevision, policyVersion, dataAsOf,
    dataVersion: resultDataVersion(result), disclosure: 'internal' } };
}

function marketComparisons(snapshots: FactSnapshot[], ids: ReadonlySet<string>, entity: string, metrics: AggregateMetric[],
  current: Quarter, auth: DataAuthority, includeGroups: boolean) {
  const data = snapshots.map(snapshot => projectSnapshot(snapshot, ids, entity));
  const latest = data.find(snapshot => sameQuarter(snapshot.period, current))!;
  const ordinal = (period: Quarter) => period.year * 4 + period.quarter;
  const baseline = (offset: number) => data.find(snapshot => snapshot.period && ordinal(current) - ordinal(snapshot.period) === offset);
  const previous = baseline(1), priorYear = baseline(4);
  const add = (name: string, result: QueryResult) =>
    boundResult(entity + ':' + name, entity, result, 'quarter', auth.permissionRevision, auth.policyVersion, quarterEnd(current));
  return metrics.flatMap(metric => [
    add(metric, buildAggregateResult(latest, metric)),
    ...(includeGroups ? [
      add('submarkets:' + metric, buildGroupedResult([latest], [latest], 'submarket', metric, 'per_period')),
      add('grades:' + metric, buildGroupedResult([latest], [latest], 'grade', metric, 'per_period')),
    ] : []),
    ...(data.length > 1 ? [add('trend:' + metric, buildTrendResult(data, metric, 'per_period'))] : []),
    ...(previous ? [add('qoq:' + metric, buildCompareResult(previous, latest, metric, 'per_period'))] : []),
    ...(priorYear ? [add('yoy:' + metric, buildCompareResult(priorYear, latest, metric, 'per_period'))] : []),
  ]);
}

async function capture(ctx: PitchContext, input: UnifiedPitchRequest): Promise<UnifiedPitchContext> {
  const authority = await loadDataAuthority(ctx.client, ctx.identity, ctx.signal);
  if (!authority.grants.includes('export:internal')) throw new Error('QUERY_DENIED');

  const gaps: PitchGap[] = [];
  const requestedMarkets = [...new Set(input.submarkets.map(normalizeMapSubmarket))];
  const gradeComparison = input.scenario === 'office-comparison' && !input.buildingIds.length && !input.buildingQuery;
  const agency = input.scenario === 'leasing-agency', marketReport = input.scenario === 'market-report';
  const markets = gradeComparison && !requestedMarkets.length ? ['CBD'] : requestedMarkets;
  const explicitIds = [...new Set(input.buildingIds)];
  const selectedOnly = explicitIds.length > 0 && !agency && !marketReport && !markets.length;
  const catalogScope = selectedOnly ? { inventory: 'tracked' as const, buildingIds: explicitIds }
    : marketScope(authority, explicitIds.length ? [] : markets);
  const [catalog] = await readQuerySnapshots(ctx.client, ctx.identity, authority,
    { operation: 'list', fields: [], scope: catalogScope, period: null }, ctx.signal);
  const metadata = await readPitchCatalogMetadata(ctx, catalog.rows);
  const cityRows = catalog.rows.filter(row => {
    const city = metadata.get(row.id)!.city;
    return city ? canonicalCity(city) === canonicalCity(input.city) : explicitIds.includes(row.id);
  });
  const catalogById = new Map(cityRows.map(row => [row.id, row]));
  if (explicitIds.some(id => !catalogById.has(id))) throw new Error('QUERY_DENIED');
  const query = input.buildingQuery ?? (agency && !explicitIds.length ? '霄云路33号' : null);
  const lookup = query ? await resolvePitchBuilding(ctx, query, cityRows, metadata) : null;
  if (lookup && !lookup.unique) gaps.push({ section: 'building', reason: 'identity_' + lookup.reason });
  if (lookup?.unique) explicitIds.push(lookup.unique.id);

  const target = explicitIds.length ? catalogById.get(explicitIds[0])! : null;
  const peerScope = agency && target ? marketOf(target) : '';
  const selectedMarkets = markets.length ? markets : peerScope ? [peerScope] : [];
  const cityScope = marketReport || gradeComparison || agency || !explicitIds.length;
  const evidenceRows = lookup && !lookup.unique ? [] : cityRows.filter(row => explicitIds.includes(row.id)
    || cityScope && (!selectedMarkets.length || selectedMarkets.includes(marketOf(row)))
      && (!gradeComparison || officeGrade(catalogName(row, 'grade')) === 'a'));
  const ids = new Set(evidenceRows.map(row => row.id));
  const scoped = evidenceRows.length <= 500 && evidenceRows.length
    ? { inventory: 'tracked' as const, buildingIds: [...ids].sort() }
    : marketScope(authority, selectedMarkets.length && evidenceRows.every(row => selectedMarkets.includes(marketOf(row))) ? selectedMarkets : []);
  const fields = authority.grants.includes('query:quarter') ? periodFields.filter(field => authority.fields.includes(field)) : [];
  const periodIds = marketReport ? evidenceRows.filter(row => ['a', 'b'].includes(officeGrade(catalogName(row, 'grade')))).map(row => row.id) : [...ids];
  const useExactScopes = ids.size > 500 && (evidenceRows.length !== catalog.rows.length || periodIds.length !== ids.size);
  const periodScopes = useExactScopes
    ? Array.from({ length: Math.ceil(periodIds.length / 500) }, (_, index) => ({
      inventory: 'tracked' as const, buildingIds: periodIds.slice(index * 500, (index + 1) * 500).sort(),
    }))
    : [scoped];
  const periods = input.period ? [input.period] : periodIds.length
    ? await Promise.all(periodScopes.map(scope => resolvePeriod(ctx, authority, input, scope, fields))) : [];
  const period = periods.filter((value): value is Quarter => value !== null)
    .sort((a, b) => b.year - a.year || b.quarter - a.quarter)[0] ?? null;
  if (!period) gaps.push({ section: 'period', reason: fields.length ? 'no_applicable_formal_period' : 'quarter_fields_not_authorized' });
  if (input.start && period && (input.start.year * 4 + input.start.quarter > period.year * 4 + period.quarter - 1)) {
    throw new Error('PITCH_INVALID_PERIOD_RANGE');
  }
  const start = input.start ?? (period && (period.year > 1900 ? shiftQuarter(period, -4) : { year: 1900, quarter: 1 }));
  const trendFields = periodsCanUseMetrics(fields);
  const snapshots = period && fields.length && ids.size
    ? await readQuerySnapshots(ctx.client, ctx.identity, authority,
      start && !sameQuarter(start, period) && trendFields.length
        ? { operation: 'trend', scope: scoped, start, end: period, mode: 'per_period', metric: trendFields[0],
          ...(trendFields.length > 1 ? { metrics: trendFields } : {}) }
        : { operation: 'list', scope: scoped, fields, period }, ctx.signal) : [];
  const quarterly = snapshots.map(snapshot => projectSnapshot(snapshot, ids, canonicalCity(input.city)));
  // The trend reader only fetches fields the supported metrics consume. Keep any
  // separately authorized orphan field as a current-quarter observation.
  const missing = fields.filter(field => !quarterly[0]?.queryScope?.requestedFields
    || !(quarterly[0].queryScope.requestedFields as readonly string[]).includes(field));
  const supplemental = period && quarterly.length && missing.length
    ? (await readQuerySnapshots(ctx.client, ctx.identity, authority,
      { operation: 'list', scope: scoped, period, fields: missing }, ctx.signal))[0] : null;
  if (supplemental) {
    const latest = quarterly.at(-1)!;
    const rows = new Map(supplemental.rows.map(row => [row.id, row]));
    quarterly[quarterly.length - 1] = { ...latest, rows: latest.rows.map(row => ({
      ...row, facts: { ...row.facts, ...rows.get(row.id)?.facts },
    })) };
  }
  const current = quarterly.at(-1);
  const rowsWithQuarter = current ? buildListResult(current, fields, true) : null;
  const cells = new Map(rowsWithQuarter?.table.rows.map(row => [row.entityId, row.cells]));
  const filtered = filterPitchCandidates(evidenceRows, cells, input.filters);
  let candidates: PitchCandidate[] = lookup && !lookup.unique
    ? lookup.candidates.slice(0, 20).map(row => ({ buildingId: row.id, name: row.name, reasons: [lookup.reason], missing: [], distanceKm: null })) : [];
  if (agency && target) candidates = shortlistPitchPeers(target, filtered, cells, metadata).map(row => row.candidate);
  if (gradeComparison) candidates = comparableGradeA(filtered, cells).map(row => ({
    buildingId: row.id, name: row.name, reasons: ['grade_a_or_premium', 'same_period_rent_area_vacancy'], missing: [], distanceKm: null,
  }));
  if (!agency && !gradeComparison && !lookup && !explicitIds.length && !marketReport) {
    candidates = filtered.slice(0, 20).map(row => ({
      buildingId: row.id, name: row.name, reasons: ['matches_requested_scope'],
      missing: Object.keys(quarterUnits).filter(field => cells.get(row.id)?.[field]?.kind !== 'number'), distanceKm: null,
    }));
  }
  if (gradeComparison && candidates.length < 5) gaps.push({ section: 'candidates', reason: 'fewer_than_five_eligible_buildings' });
  if (agency && target && !candidates.length) gaps.push({ section: 'candidates', reason: 'no_authorized_peer_candidates' });
  const chosen = [...new Set([...explicitIds, ...(!lookup || lookup.unique ? candidates.map(row => row.buildingId) : [])])];
  const profileIds = chosen.slice(0, 20);
  if (chosen.length > profileIds.length) gaps.push({ section: 'candidates', reason: 'dossier_batch_exceeds_twenty' });
  const researchMarkets = [...new Set([...selectedMarkets, ...chosen.map(id => marketOf(catalogById.get(id)!))].filter(Boolean))].slice(0, 8);
  const leaseQueryMarkets = scoped.submarkets ?? (selectedMarkets.length ? selectedMarkets.flatMap(submarketDatabaseNames) : []);
  const wantsLease = agency || marketReport || Boolean(input.lease);
  const beijingLeaseScope = canonicalCity(input.city) === '北京';
  if (wantsLease && !beijingLeaseScope) gaps.push({ section: 'lease', reason: 'lease_market_outside_supported_scope' });
  const leaseJobs = wantsLease && beijingLeaseScope
    ? leasePlans(input, period, leaseQueryMarkets, target && agency ? [target.id] : []) : [];
  const towerIds = agency || input.scenario === 'building-promotion' ? explicitIds : [];
  const businessReads = async () => {
    if (!profileIds.length && !researchMarkets.length) return [null, null, null] as const;
    const caps = await businessCapabilities(ctx.client, ctx.identity, ctx.signal);
    if (!('modules' in caps) || !caps.export) return [null, null, null] as const;
    const profileInput = profileFieldNames.filter(field => field !== 'availablePeriods' && caps.profileFields.includes(field));
    const profilePlan = profileIds.length && caps.modules.includes('profile') && profileInput.length
      ? businessPlanSchema.parse({ tool: 'query_building_dossier', buildingIds: profileIds, fields: profileInput }) : null;
    const researchPlan = researchMarkets.length && caps.modules.includes('submarket')
      ? businessPlanSchema.parse({ tool: 'query_submarket_profile', submarkets: researchMarkets }) : null;
    return Promise.all([
      profilePlan ? readBusiness(ctx, profilePlan) : null,
      researchPlan ? readBusiness(ctx, researchPlan) : null,
      towerIds.length && caps.modules.includes('stacking') ? readPitchTowerIdentities(ctx, towerIds) : null,
    ]);
  };
  const [[profile, research, towerRead], lease] = await Promise.all([businessReads(), readLease(ctx, leaseJobs, canonicalCity(input.city), gaps, Boolean(input.lease?.source))]);
  if (profileIds.length && !profile) gaps.push({ section: 'building', reason: 'dossier_unavailable_or_not_authorized' });
  if (researchMarkets.length && !research) gaps.push({ section: 'research', reason: 'research_unavailable_or_not_authorized' });
  if (research) for (const market of researchMarkets) {
    if (!research.result.table.rows.some(row => row.entityId === market)) {
      gaps.push({ section: 'research', entityId: market, reason: 'no_published_research' });
    }
  }
  const asOf = period ? quarterEnd(period) : null;
  const selectedIds = new Set(profileIds);
  const history = profileIds.length ? quarterly.map(snapshot => ({ period: snapshot.period,
    result: buildListResult(projectSnapshot(snapshot, selectedIds, 'selected-buildings'), fields, true),
  })) : [];
  const buildings: PitchBuildingContext[] = profileIds.map(id => {
    const row = catalogById.get(id)!;
    const towers = towerRead?.towers.filter(tower => tower.buildingId === id) ?? [];
    return { buildingId: id, name: row.name, towers,
      towerStatus: !towerIds.includes(id) ? 'not_requested' : !towerRead ? 'unauthorized' : towers.length ? 'authorized' : 'not_recorded',
      static: buildingStatic(row, metadata.get(id)!, profile, period),
      quarter: quarterValues(history.at(-1)?.result, id, period, fields),
      history: history.map(entry => quarterValues(entry.result, id, entry.period, fields)) };
  });
  const results = [...lease];
  if (profile) results.push(boundResult('building-dossier', canonicalCity(input.city), profile.result, 'business',
    profile.snapshot.permission_revision, BUSINESS_DOMAIN, null));
  if (research) results.push(boundResult('submarket-research', canonicalCity(input.city), research.result, 'business',
    research.snapshot.permission_revision, BUSINESS_DOMAIN, null));
  if (current && period) {
    const selectedQuarter = history.at(-1);
    if (selectedQuarter) {
      results.push(boundResult('selected-buildings', canonicalCity(input.city), selectedQuarter.result,
        'quarter', authority.permissionRevision, authority.policyVersion, asOf));
    }
    if (cityScope) {
      const marketRows = evidenceRows.filter(row => (!selectedMarkets.length || selectedMarkets.includes(marketOf(row)))
        && (!marketReport || ['a', 'b'].includes(officeGrade(catalogName(row, 'grade')))));
      results.push(...marketComparisons(quarterly, new Set(marketRows.map(row => row.id)),
        selectedMarkets.length === 1 ? selectedMarkets[0] : canonicalCity(input.city), trendFields, period, authority, marketReport));
    }
    for (const id of explicitIds) results.push(...marketComparisons(quarterly, new Set([id]), id, trendFields, period, authority, false));
    if (!current.rows.some(row => Object.values(row.facts).some(fact => fact.sources.length))) {
      gaps.push({ section: 'period', reason: 'no_formal_records_for_requested_period' });
    }
  }
  if (period && quarterly.length < 2) gaps.push({ section: 'history', reason: 'formal_history_not_available' });
  const currentAuthority = await loadDataAuthority(ctx.client, ctx.identity, ctx.signal);
  if (currentAuthority.permissionRevision !== authority.permissionRevision || currentAuthority.policyVersion !== authority.policyVersion
    || !currentAuthority.grants.includes('export:internal')) throw new Error('QUERY_DENIED');
  const researchEntries = research ? publishedResearch(research.snapshot, research.result) : [];
  const receipts = results.map(result => result.binding);
  if (towerRead) receipts.push({ domain: 'business', policyVersion: BUSINESS_DOMAIN, permissionRevision: towerRead.permissionRevision,
    dataVersion: evidenceHash(towerRead.towers), dataAsOf: null, disclosure: 'internal' });
  const bindings = receipts.flatMap(({ domain, dataAsOf, permissionRevision, policyVersion, dataVersion }) =>
    domain !== 'business' && dataAsOf ? [{ domain, dataAsOf, permissionRevision, policyVersion, dataVersion }] : []);
  const dataVersion = evidenceHash([buildings, candidates, researchEntries, receipts.map(receipt => receipt.dataVersion)]);
  return { protocol: 'unified-pitch-context/1', request: input, period, periodBasis: input.period ? 'explicit' : period ? 'latest_formal' : 'unavailable',
    capturedAt: new Date().toISOString(), disclosure: 'internal', isTestData: false, dataAsOf: asOf, buildings, candidates, candidateMethod: 'rule_based',
    results, research: researchEntries, receipts, bindings, gaps, dataVersion, fingerprint: evidenceHash([input, authority.permissionRevision, dataVersion, receipts, gaps]) };
}

function periodsCanUseMetrics(fields: readonly NumericField[]) {
  return fields.includes('totalArea') ? officeMetrics.filter(metric => metric === 'totalArea'
    || fields.includes(metric === 'rent' ? 'netEffectiveRent' : 'vacantArea')) : [];
}

const pending = new WeakMap<PitchContext, Map<string, Promise<UnifiedPitchContext>>>();

/** Deduplicate concurrent reads for this verified request only. Every later read reauthorizes. */
export function loadUnifiedPitchContext(ctx: PitchContext, raw: unknown): Promise<UnifiedPitchContext> {
  const parsed = unifiedPitchRequestSchema.parse(raw);
  const input = { ...parsed, buildingIds: [...new Set(parsed.buildingIds.map(id => id.toLowerCase()))], submarkets: [...new Set(parsed.submarkets.map(normalizeMapSubmarket))].sort() };
  const key = JSON.stringify(input);
  const requests = pending.get(ctx) ?? new Map<string, Promise<UnifiedPitchContext>>();
  pending.set(ctx, requests);
  const current = requests.get(key);
  if (current) return current;
  const result = capture(ctx, input).finally(() => requests.delete(key));
  requests.set(key, result);
  return result;
}

const demoScenarios = {
  'xiaoyun-agency': 'leasing-agency',
  'cbd-grade-a': 'office-comparison',
  'beijing-quarterly': 'market-report',
  'building-promotion': 'building-promotion',
} as const;

export function loadPitchDemoContext(ctx: PitchContext, demo: PitchDemo, options: Partial<Omit<UnifiedPitchRequest, 'scenario'>> = {}) {
  if (demo === 'building-promotion' && (options.buildingIds?.length ?? 0) !== 1 && !options.buildingQuery) {
    throw new Error('PITCH_DEMO_REQUIRES_BUILDING');
  }
  return loadUnifiedPitchContext(ctx, { ...options, scenario: demoScenarios[demo] });
}
