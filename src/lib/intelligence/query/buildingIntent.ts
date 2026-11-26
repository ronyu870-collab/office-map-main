import type { SupabaseClient } from '@supabase/supabase-js';
import { buildingIntentQuestions, type BuildingSelection } from './buildingNavigation';
import { readAvailablePeriods, type AvailablePeriods } from './availablePeriods';
import type { BuildingFacts, Quarter } from './contracts';
import { parseQueryPlan, type QueryPlan } from './plan';
import type { NumericField } from './registry';
import type { SemanticContext, SemanticResolution } from './semanticPlanner';
import type { DataAuthority, VerifiedQueryIdentity } from './serverAuthority';
import { loadDataAuthority } from './serverAuthority';
import { readQuerySnapshots } from './snapshotReader';
import { shiftQuarter } from './relativeQuarter';

const normalized = (value: string) => value.normalize('NFKC').replace(/[\s·•._,，。()（）\-—/\\]+/g, '').toLowerCase();
export type BuildingIdentity = { id: string; name: string; submarket: string | null; aliases?: string[] };
/** Similarity may offer candidates; only canonical or governed exact identities select automatically. */
export function resolveBuildingCandidates(name: string, rows: BuildingIdentity[], exactAliases: { building_id: string }[] = [], projectAliases: { building_id: string }[] = []) {
  const target = normalized(name), byId = new Map(rows.map(row => [row.id, row]));
  const projects = [...new Set(projectAliases.map(row => row.building_id))].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  if (projectAliases.length) return { unique: null, candidates: projects, reason: 'project' as const };
  const exactIds = new Set(exactAliases.map(row => row.building_id));
  const exact = rows.filter(row => normalized(row.name) === target || row.aliases?.some(alias => normalized(alias) === target) || exactIds.has(row.id));
  if (exact.length === 1) return { unique: exact[0], candidates: exact, reason: 'exact' as const };
  if (exact.length > 1) return { unique: null, candidates: exact, reason: 'ambiguous' as const };
  return { unique: null, candidates: rows.filter(row => normalized(row.name).includes(target) || row.aliases?.some(alias => normalized(alias).includes(target))), reason: 'candidate' as const };
}
export function buildingLocationTarget(question: string): string | null {
  const match = /^(?:请问)?(.{2,80}?)(?:(?:位于|属于)(?:哪个|哪一)子市场|在哪(?:个|一)?子市场)[。？?]?$/.exec(question.trim());
  const target = match?.[1].trim();
  return target && !/[，,；;<>]|忽略|绕过|执行SQL/i.test(target) ? target : null;
}
function introductionTarget(question: string): string | null {
  const text = question.trim().replace(/[。？?]$/, '');
  const match = /^(?:请)?(?:介绍(?:一下)?|了解一下)(.{2,80}?)$/.exec(text) ?? /^(.{2,80})的(?:楼宇|项目)(?:概况|信息)$/.exec(text);
  if (!match || /[\u0000-\u001f<>]|忽略|绕过|SQL|建成|楼龄|建筑面积|报价|业主|联系方式|最近|季度|大于|小于|只要|不含/i.test(match[1])) return null;
  return match[1].replace(/的(?:楼宇|项目)?(?:概况|信息|资料)$/, '').trim();
}
const emptyContext = (): SemanticContext => ({ version: 'colliers-semantic-context/1', comparisonSubmarkets: [] });
function clarify(question: string, context: SemanticContext, message: string, rows: BuildingIdentity[] = []): SemanticResolution {
  const options = rows.slice(0, 5).map((row, index) => ({ id: `building:${row.id}`, label: `${row.name} · ${row.submarket ?? '子市场未知'}`.slice(0, 100),
    question: `介绍${row.name}（${row.submarket ?? '子市场未知'}，候选${index + 1}）` }));
  const clarification = { code: 'conditions_required' as const, reason: 'ambiguous_reference' as const, message, options };
  return { kind: 'clarification', clarification, context: { ...context, pending: { question, clarification } } };
}
function identity(row: BuildingFacts): BuildingIdentity { return { id: row.id, name: row.name, submarket: row.dimensions?.submarket?.value ?? null }; }

export async function prepareBuildingIntent(input: { client: SupabaseClient; identity: VerifiedQueryIdentity; authority: DataAuthority; question: string;
  context?: SemanticContext; buildingSelection?: BuildingSelection; signal: AbortSignal }): Promise<{ resolution: SemanticResolution; availability?: AvailablePeriods } | null> {
  const { client, authority, signal } = input;
  const context = input.context ?? emptyContext();
  const option = context.pending?.clarification.options.find(item => item.question === input.question && item.id.startsWith('building:'));
  const selection = input.buildingSelection ?? (option ? { ids: [option.id.slice(9)], intent: 'profile' as const } : undefined);
  const locationTarget = selection ? null : buildingLocationTarget(input.question);
  const target = selection ? null : locationTarget ?? introductionTarget(input.question);
  if (!selection && !target) return null;
  if (input.buildingSelection && input.question !== buildingIntentQuestions[input.buildingSelection.intent]) {
    return { resolution: clarify(input.question, context, '所选楼宇动作与问题已变化，请重新选择分析动作，或取消楼宇选择后重新提问。') };
  }
  // This RPC enforces current active/tracked/map-visible rows and independent AI grants.
  // Alias tables are consulted only after this authorized catalog, never to discover inaccessible entities.
  const snapshots = await readQuerySnapshots(client, input.identity, authority, { operation: 'list', fields: [], period: null,
    scope: { inventory: 'tracked', ...(selection ? { buildingIds: selection.ids } : {}) } }, signal);
  const rows = snapshots[0].rows.map(identity);
  let chosen = rows;
  let buildingLocation: { subject: string; submarket: string } | undefined;
  if (selection && (rows.length !== selection.ids.length || rows.some(row => !selection.ids.includes(row.id)))) throw new Error('QUERY_DENIED');
  if (target) {
    const aliases: { id: string; former_names: string[] | null }[] = [];
    for (let start = 0; start < rows.length; start += 500) {
      const result = await client.from('buildings').select('id,former_names').in('id', rows.slice(start, start + 500).map(row => row.id)).abortSignal(signal);
      if (result.error) throw new Error('QUERY_READ_UNAVAILABLE');
      aliases.push(...(result.data ?? []));
    }
    const [exact, project] = await Promise.all([
      client.from('lease_building_name_map').select('building_id').eq('market_code', 'BJ').eq('alias_name', target)
        .in('verification_status', ['AUTO_VERIFIED', 'MANUAL_VERIFIED']).limit(20).abortSignal(signal),
      client.from('lease_building_project_map').select('building_id').eq('market_code', 'BJ').eq('alias_name', target)
        .in('verification_status', ['AUTO_VERIFIED_PROJECT', 'MANUAL_VERIFIED_PROJECT']).limit(100).abortSignal(signal),
    ]);
    if (exact.error || project.error) throw new Error('QUERY_READ_UNAVAILABLE');
    const aliasesById = new Map(aliases.map(row => [row.id, Array.isArray(row.former_names) ? row.former_names.filter(value => typeof value === 'string') : []]));
    const resolved = resolveBuildingCandidates(target, rows.map(row => ({ ...row, aliases: aliasesById.get(row.id) })), exact.data ?? [], project.data ?? []);
    const market = resolved.candidates[0]?.submarket;
    if (locationTarget && resolved.reason !== 'candidate' && market
      && resolved.candidates.every(candidate => candidate.submarket === market)) {
      buildingLocation = { subject: locationTarget, submarket: market };
      chosen = resolved.candidates;
    } else if (!resolved.unique || locationTarget) {
      if ((await loadDataAuthority(client, input.identity, signal)).permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
      return { resolution: clarify(input.question, context, resolved.candidates.length
        ? `${resolved.reason === 'project' ? '该名称对应项目或多栋楼座，不能自动选定其中一栋。' : '尚不能唯一确定楼宇。'}请选择具体项目${resolved.candidates.length > 5 ? '；这里只列出前5个候选，也可输入更完整名称' : ''}。`
        : '当前获权目录中没有唯一匹配的楼宇。请提供系统中的完整楼名；不会按相似名称自动关联。', resolved.candidates) };
    } else chosen = [resolved.unique];
  }
  const intent = selection?.intent ?? 'profile';
  if (intent === 'rent_trend' && chosen.length !== 1) return { resolution: clarify(input.question, context, '请一次选择一栋楼宇查看独立租金趋势。') };
  const scope: QueryPlan['scope'] = { inventory: 'tracked', buildingIds: chosen.map(row => row.id) };
  const brochure: NumericField[] = authority.grants.includes('query:brochure') ? (['height', 'floors', 'parking'] as NumericField[]).filter(field => authority.fields.includes(field)) : [];
  const quarterFields: NumericField[] = authority.grants.includes('query:quarter') ? (['totalArea', 'vacantArea', 'netEffectiveRent'] as NumericField[]).filter(field => authority.fields.includes(field)) : [];
  let availability: AvailablePeriods | undefined;
  // Locate an actually recorded period using one authorized primary input. Missing companion fields remain unknown.
  if (!buildingLocation && intent !== 'peers' && quarterFields.length) {
    const preferred = quarterFields.includes('netEffectiveRent') ? 'netEffectiveRent' : quarterFields[0];
    availability = await readAvailablePeriods(client, input.identity, authority, scope, [preferred], signal);
    // A project with no valid rent may still have real area/vacancy records.
    // Keep those visible at their recorded quarter, leaving rent unknown.
    if (intent !== 'rent_trend' && !availability.periods.length) {
      for (const field of quarterFields.filter(value => value !== preferred)) {
        availability = await readAvailablePeriods(client, input.identity, authority, scope, [field], signal);
        if (availability.periods.length) break;
      }
    }
  }
  const period = availability?.periods.at(-1) ?? null;
  let plan: QueryPlan;
  if (buildingLocation) {
    plan = { operation: 'list', scope, fields: [], period: null };
  } else if (intent === 'peers') {
    const markets = [...new Set(chosen.flatMap(row => row.submarket ? [row.submarket] : []))];
    if (!markets.length) return { resolution: clarify(input.question, context, '所选楼宇没有已记录的子市场，无法确定同子市场范围。') };
    plan = { operation: 'list', scope: { inventory: 'tracked', submarkets: markets }, fields: [], period: null };
  } else if (intent === 'rent_trend') {
    if (!period || !quarterFields.includes('totalArea') || !quarterFields.includes('netEffectiveRent')) return { resolution: clarify(input.question, context, '当前授权和记录不足以查询该楼宇的净有效租金趋势。') };
    plan = { operation: 'trend', scope, metric: 'rent', start: shiftQuarter(period, -3), end: period, mode: 'per_period' };
  } else plan = { operation: 'list', scope, fields: [...brochure, ...(period ? quarterFields : [])], period };
  plan = parseQueryPlan(plan);
  const periods: Quarter[] = plan.operation === 'trend' ? [plan.start, plan.end] : period ? [period] : [];
  return { availability, resolution: { kind: 'plan', plan, context: { version: 'colliers-semantic-context/1', lastPlan: plan, comparisonSubmarkets: [] },
    interpretation: { version: 'colliers-semantic-planner/1', method: 'bounded_semantic_rules', resolvedQuestion: intent === 'peers' ? '查询所选项目所属子市场的获权楼宇目录（包含所选项目）' : `${chosen.map(row => row.name).join('、')}：${intent === 'rent_trend' ? '近四个季度净有效租金趋势' : '楼宇信息与已有获权指标'}`,
      periodBasis: period ? `按所选楼宇获权有效记录定位 ${period.year}Q${period.quarter}，不是实时数据` : '没有可用季度时只展示目录与获权楼书参数',
      periods, availableThrough: period, unavailablePeriods: [], inherited: [], ...(buildingLocation ? { buildingLocation } : {}), notices: ['楼宇按明确主键匹配；项目级和同名候选必须确认。'] },
    limitations: ['建成年份、建筑面积和地下层数尚未纳入 AI 可信字段授权，本结果不补造；楼层数按原来源口径。', ...(intent === 'peers' ? ['同子市场目录包含当前项目，不以名称排除或合并楼座。'] : [])] } };
}
