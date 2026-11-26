import { designThemeSchema, type DesignTheme } from '../design/theme';
import { quarterSchema } from '@/src/lib/intelligence/query/contracts';
import type { LayoutId } from '../contracts/scene';
import type { BusinessDataBinding, PitchContextSnapshot, ProposalPlan, VisualAssetReference } from '../integration-contracts';
import { LAYOUTS } from '../layout/definitions';
import { PATTERN_BY_ID } from '../layout/patterns/catalog';
import { PROPOSAL_RECIPES, type ClaimKind, type ProposalRecipeId, type RecipeDefinition } from './catalog';
import type { PageDraft } from './drafts';
import { marketDrafts } from './market-pages';
import { composeContent, matchesPattern, periodEnd, periodLabel, periodOrder, usableEvidence } from './page-content';
import { brochureDrafts, leasingDrafts, shortlistDrafts } from './property-pages';
import type { BoundBuilding, Evidence, Period, ProposalData, PublishedEvidence } from './projection';

export { PROPOSAL_RECIPES } from './catalog';
export { projectQuarterBuildings, proposalDataBinding, proposalMapImage, proposalPhoto, proposalStackingImage } from './authorized-data';
export type { ProposalData } from './projection';
export type { ScoreWeights } from './scorecard';
export { projectUnifiedProposalContext } from './unified-projection';

export interface ProposalPageOptions {
  include?: boolean;
  layoutId?: LayoutId;
}

export interface ProposalOptions {
  theme: DesignTheme;
  targetBuildingId?: string;
  pages?: Readonly<Record<string, ProposalPageOptions>>;
}

function resolvedPeriod(value: string | null): Period {
  const match = value?.match(/^(\d{4})-Q([1-4])$/);
  const result = match && quarterSchema.safeParse({ year: Number(match[1]), quarter: Number(match[2]) });
  if (!result || !result.success) throw new Error('PITCH_PROPOSAL_PERIOD_REQUIRED');
  return result.data;
}

function bindingKey(binding: BusinessDataBinding) {
  return JSON.stringify([binding.domain, binding.policyVersion, binding.permissionRevision, binding.dataVersion, binding.dataAsOf]);
}

function visualKey(visual: VisualAssetReference) {
  return JSON.stringify([visual.kind, visual.id, visual.version, visual.versionHash, [...visual.buildingIds].sort(),
    visual.disclosure, visual.source.id, visual.source.version, visual.source.dataAsOf]);
}

function chooseAuthorized(snapshot: PitchContextSnapshot, data: ProposalData, period: Period, targetId?: string): ProposalData {
  const earliest = snapshot.brief.start ? periodOrder(resolvedPeriod(snapshot.brief.start)) : 0;
  if (periodOrder(period) < earliest) throw new Error('PITCH_PROPOSAL_INTERVAL_INVALID');
  const dataKeys = new Set(snapshot.data.map(bindingKey));
  const visualKeys = new Set(snapshot.visuals.map(visualKey));
  const allowed = <T>(item?: Evidence<T>): Evidence<T> | undefined => {
    if (!usableEvidence(item, snapshot.brief.audience)) return undefined;
    if (!snapshot.isTestData && (item.isTestData || item.sources.some(source => source.kind === 'synthetic'))) return undefined;
    if (!item.data?.every(binding => dataKeys.has(bindingKey(binding))) && item.data?.length) return undefined;
    if (item.visual && (!visualKeys.has(visualKey(item.visual)) || !item.sources.some(source => source.id === item.visual?.source.id)
      || item.visual.disclosure === 'restricted'
      || (snapshot.brief.audience === 'client' && item.visual.disclosure !== 'client_approved'))) return undefined;
    return item;
  };
  const published = <T>(item: PublishedEvidence<T> | undefined) => item?.publication === 'published' ? allowed(item) as PublishedEvidence<T> | undefined : undefined;
  const domain = <T>(item: Evidence<T> | undefined, domain: BusinessDataBinding['domain']) => item?.data?.some(binding => binding.domain === domain) ? allowed(item) : undefined;
  const current = <T extends { period: Period }>(item?: Evidence<T>) => item && periodOrder(item.value.period) === periodOrder(period)
    && item.data?.some(binding => binding.domain === 'quarter' && binding.dataAsOf === periodEnd(period)) ? domain(item, 'quarter') : undefined;
  const perBuildingVisual = <T>(item: Evidence<T> | undefined, id: string, kind: VisualAssetReference['kind']) => {
    return item?.visual?.kind === kind && item.visual.buildingIds.length === 1 && item.visual.buildingIds[0] === id ? allowed(item) : undefined;
  };
  const lease = <T>(item?: Evidence<T>) => item?.data?.some(binding => binding.domain === 'lease' && binding.dataAsOf === periodEnd(period)) ? allowed(item) : undefined;
  const byId = new Map<string, BoundBuilding>();
  for (const building of data.buildings) {
    if (byId.has(building.id)) throw new Error('PITCH_PROPOSAL_DUPLICATE_BUILDING');
    byId.set(building.id, building);
  }
  const buildings = snapshot.brief.buildingIds.map(id => {
    const building = byId.get(id);
    const identity = allowed(building?.identity);
    if (!building || !identity || identity.value.name !== building.name) throw new Error('PITCH_PROPOSAL_BUILDING_UNAVAILABLE');
    return {
      id, name: building.name, identity, submarket: building.submarket, grade: building.grade,
      profile: allowed(building.profile), technical: allowed(building.technical), transport: allowed(building.transport),
      quarter: current(building.quarter),
      photos: building.photos?.flatMap(item => item.value.block.mediaAssetId === item.visual?.id && item.value.block.mediaVersion === item.visual?.version ? perBuildingVisual(item, id, 'photo') ?? [] : []),
      stackingPlan: perBuildingVisual(building.stackingPlan, id, 'stacking-plan'),
    };
  });
  const market = data.market;
  const marketQuarter = market?.city === snapshot.brief.city ? current(market.quarter) : undefined;
  const pinnedMap = (item: NonNullable<ProposalData['maps']>['target'], allowedIds?: readonly string[]) => {
    if (item?.visual?.kind !== 'map' || !item.visual.buildingIds.length || (allowedIds && !item.visual.buildingIds.every(id => allowedIds.includes(id)))) return undefined;
    const { value } = item;
    if (value.kind === 'image' ? value.mediaAssetId !== item.visual.id || value.mediaVersion !== item.visual.version
      : !value.bounds || !value.points?.length || value.points.length > 12 || value.buildingIds.length !== item.visual.buildingIds.length
        || value.buildingIds.some(id => !item.visual?.buildingIds.includes(id))) return undefined;
    return allowed(item);
  };
  return {
    buildings,
    market: market && marketQuarter ? {
      ...market,
      quarter: marketQuarter,
      history: market.history?.flatMap(item => periodOrder(item.value.period) <= periodOrder(period) && periodOrder(item.value.period) >= earliest ? domain(item, 'quarter') ?? [] : []),
      submarkets: market.submarkets?.flatMap(item => current(item) ?? []),
      grades: market.grades?.flatMap(item => current(item) ?? []),
      spotlight: market.spotlight && (!snapshot.brief.submarkets.length || snapshot.brief.submarkets.includes(market.spotlight.value.name)) ? published(market.spotlight) : undefined, methodology: allowed(market.methodology), outlook: published(market.outlook),
    } : undefined,
    customerBrief: allowed(data.customerBrief), scoreWeights: allowed(data.scoreWeights),
    maps: { target: targetId ? pinnedMap(data.maps?.target, [targetId]) : undefined, candidates: pinnedMap(data.maps?.candidates, snapshot.brief.buildingIds), market: pinnedMap(data.maps?.market) },
    leases: { trend: lease(data.leases?.trend), industries: lease(data.leases?.industries), sizes: lease(data.leases?.sizes), deals: lease(data.leases?.deals) },
    team: published(data.team), case: published(data.case), contact: published(data.contact),
  };
}

function layoutFor(draft: PageDraft, override?: LayoutId): LayoutId {
  if (!override || override === draft.composition) return draft.composition;
  if (PATTERN_BY_ID.has(override) && matchesPattern(override, draft.blocks)) return override;
  const layout = LAYOUTS.find(item => item.id === override);
  if (layout && !PATTERN_BY_ID.has(override)) {
    const kinds = draft.blocks.map(item => item.block.kind);
    const imageCount = kinds.filter(kind => kind === 'image').length;
    const canUse = kinds.every(kind => layout.kinds.includes(kind))
      && (override === 'cover' || kinds.includes(layout.kinds[0]));
    if (canUse && (override !== 'image-text' || imageCount === 1)
      && (!['cover', 'case-study'].includes(override) || imageCount <= 1)) return override;
  }
  throw new Error('PITCH_PROPOSAL_LAYOUT_INCOMPATIBLE');
}

/**
 * Compose freshly authorized facts and materials without I/O. The authorized caller
 * renders and persists each BusinessPage via the existing workspace pipeline.
 */
export function buildProposal(snapshot: PitchContextSnapshot, data: ProposalData, options: ProposalOptions) {
  const { brief } = snapshot;
  if (!snapshot.fingerprint || new Set(brief.buildingIds).size !== brief.buildingIds.length || brief.buildingIds.length > 20)
    throw new Error('PITCH_PROPOSAL_INVALID_CONTEXT');
  if (snapshot.isTestData && brief.audience === 'client') throw new Error('PITCH_PROPOSAL_CLIENT_FIXTURE');
  if (brief.language !== 'zh') throw new Error('PITCH_PROPOSAL_LANGUAGE_UNAVAILABLE');
  if (!Object.hasOwn(PROPOSAL_RECIPES, brief.scenario)) throw new Error('PITCH_PROPOSAL_UNSUPPORTED_SCENARIO');
  const recipe: RecipeDefinition = PROPOSAL_RECIPES[brief.scenario as ProposalRecipeId];
  const period = resolvedPeriod(brief.period);
  const theme = designThemeSchema.parse(options.theme);
  if (Object.keys(options.pages ?? {}).some(id => !recipe.pages.some(page => page.id === id))) throw new Error('PITCH_PROPOSAL_UNKNOWN_PAGE');
  const targetId = options.targetBuildingId ?? brief.buildingIds[0];
  const input = chooseAuthorized(snapshot, data, period, targetId);
  const target = input.buildings.find(building => building.id === targetId);
  const plan: ProposalPlan = { id: recipe.id, version: recipe.revision, title: brief.title, contextFingerprint: snapshot.fingerprint, slides: [], gaps: [] };
  const quarterly = input.market;
  const comparison = recipe.id === 'office-comparison';
  if ((comparison && input.buildings.length < 2) || (recipe.id === 'building-promotion' && input.buildings.length !== 1)) throw new Error('PITCH_PROPOSAL_INVALID_BUILDING_COUNT');
  if (recipe.id === 'market-report' ? !quarterly || quarterly.submarket : !target) throw new Error('PITCH_PROPOSAL_REQUIRED_EVIDENCE');
  // A project-level market analysis cannot borrow city totals or another submarket’s figures.
  if (recipe.id === 'leasing-agency' && (!target!.submarket || quarterly?.submarket !== target!.submarket)) input.market = undefined;
  const drafts: Record<string, PageDraft | readonly PageDraft[] | null> = recipe.id === 'market-report' ? marketDrafts(input, quarterly!, period)
    : comparison ? shortlistDrafts(input, period) : recipe.id === 'leasing-agency' ? leasingDrafts(input, target!, period) : brochureDrafts(input, target!, period);
  const pages = recipe.pages.flatMap(definition => {
    const config = options.pages?.[definition.id];
    const draft = drafts[definition.id];
    if (config?.include === false && definition.fallback === 'retain') throw new Error('PITCH_PROPOSAL_REQUIRED_PAGE');
    if (config?.include === false || !draft || (Array.isArray(draft) && !draft.length)) {
      plan.gaps.push({ pageKind: definition.id, reason: config?.include === false ? '已按提案配置省略' : '该页缺少适用且已获权的证据' });
      return [];
    }
    return ([draft].flat() as PageDraft[]).map((page, index) => {
      const layoutId = layoutFor(page, config?.layoutId);
      const content = composeContent(page.title, page.subtitle ?? periodLabel(period), page.blocks, period, brief.audience, snapshot.isTestData);
      const evidence = page.blocks.flatMap(block => block.evidence);
      const usedData = new Set(evidence.flatMap(item => item.data ?? []).map(bindingKey));
      const usedVisuals = new Set(evidence.flatMap(item => item.visual ? [item.visual] : []).map(visualKey));
      const id = `${recipe.id}:${definition.id}:${index + 1}`;
      plan.slides.push({ id, pageKind: definition.id, title: content.title, layoutId,
        data: snapshot.data.filter(binding => usedData.has(bindingKey(binding))),
        visuals: snapshot.visuals.filter(visual => usedVisuals.has(visualKey(visual))) });
      return { id, pageKind: definition.id, claimKind: definition.kind as ClaimKind, follows: definition.follows, layoutId, variant: 'standard' as const, content };
    });
  });
  if (!pages.length || pages.length > 50) throw new Error('PITCH_PROPOSAL_PAGE_LIMIT');
  return { plan, pages, theme, recommendedStyle: recipe.recommendedStyle };
}
