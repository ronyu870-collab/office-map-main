import { createHash } from "node:crypto";
import { slideContentSchema, type PitchScope, type SlideContent } from "../contracts/content";
import type { Generation } from "../business/protocol";
import { stableId } from "../library/extract";
import type {
  BusinessDataBinding, PitchContextSnapshot, ProposalBrief, ProposalPlan, SlideIntent, VisualAssetReference,
} from "../integration-contracts";
import type { UnifiedProposalContext } from "../proposals/unified-projection";
import type { ClientRequirement, ProposalPriority, ProposalRequest } from "./proposal-brief";
import { interpretProposal, type ProposalModel } from "./proposal-interpretation";
import {
  resolveProposalBuildings, resolveProposalPeriod, type FormalProposalPeriod, type ProposalBuildingCandidate,
} from "./proposal-scope";

type AssetReference = { id: string; version: number };
type Chart = Extract<SlideContent["blocks"][number], { kind: "chart" }>["chartType"] | "table";
type QueryReceipt = UnifiedProposalContext["results"][number];

export type ComposedProposalPage = {
  pageKind: string;
  content: SlideContent;
  layoutId: SlideIntent["layoutId"];
  businessIntent: "fact" | "analysis" | "recommendation" | "forecast";
  materials?: AssetReference[];
  data: BusinessDataBinding[];
  visuals: VisualAssetReference[];
  uncertainties?: string[];
  essential?: boolean;
  topics?: readonly ProposalPriority[];
  dependencyKinds?: readonly string[];
  generation?: { part: Generation["parts"][number]; evidenceVersion: string };
};

export type ProposalComposerInput = {
  brief: ProposalBrief;
  scope: PitchScope;
  projectId?: string;
  buildings: readonly ProposalBuildingCandidate[];
  priorities: Awaited<ReturnType<typeof interpretProposal>>["brief"]["priorities"];
  requestedPriorities?: readonly ProposalPriority[];
  clientRequirements?: readonly ClientRequirement[];
  assetIds: readonly string[];
  analysisResultId?: string;
};

export type ProposalDirectorPorts = {
  scope(input: ProposalRequest, signal: AbortSignal): Promise<{
    scope: PitchScope;
    defaults?: { buildingIds?: string[]; targetClient?: string; language?: "zh" | "en" };
  }>;
  buildings(input: Pick<ProposalComposerInput["brief"], "city" | "submarkets">, signal: AbortSignal): Promise<ProposalBuildingCandidate[]>;
  periods(input: Pick<ProposalComposerInput["brief"], "city" | "submarkets" | "buildingIds" | "scenario">, signal: AbortSignal): Promise<FormalProposalPeriod[]>;
  compose(input: ProposalComposerInput, signal: AbortSignal): Promise<{
    pages: ComposedProposalPage[];
    gaps: ProposalPlan["gaps"];
    recipeVersion: string;
    theme?: { id: string; version: number };
    queryReceipts?: readonly QueryReceipt[];
    verifySources?: () => Promise<void>;
  }>;
};

export type DirectedSlide = SlideIntent & {
  businessIntent: ComposedProposalPage["businessIntent"];
  titleCandidates: string[];
  keyMessages: { kind: SlideContent["blocks"][number]["kind"]; label: string; sourceIds: string[] }[];
  materialReferences: AssetReference[];
  chart: Chart | null;
  follows: string | null;
  precedes: string | null;
  dependsOn: string[];
  uncertainties: string[];
};

export type DirectedProposalPlan = Omit<ProposalPlan, "slides"> & {
  slides: DirectedSlide[];
  analysisPriorities?: readonly ProposalPriority[];
  theme?: { id: string; version: number };
};

type ModelRoute = Pick<Awaited<ReturnType<typeof interpretProposal>>, "modelCalls" | "modelStatus">;
type PlanState = { status: "clarification" | "unavailable"; code: string; message: string; candidates?: ProposalBuildingCandidate[] }
  | {
    status: "ready";
    plan: DirectedProposalPlan;
    snapshot: PitchContextSnapshot;
    selection: "explicit" | "scoped-sample" | "none";
    // For the server-side workflow. The prepare HTTP response omits full page content.
    pages: { id: string; content: SlideContent; layoutId: SlideIntent["layoutId"] }[];
    generation: NonNullable<ComposedProposalPage["generation"]>[] | null;
    queryReceipts?: readonly QueryReceipt[];
    verifySources?: () => Promise<void>;
  };
export type ProposalPlanningResult = PlanState & ModelRoute;

const titles = {
  "leasing-agency": ["招商代理提案", "Leasing Agency Proposal"],
  "office-comparison": ["写字楼对比", "Office Comparison"],
  "market-report": ["写字楼季度市场报告", "Quarterly Office Market Report"],
  "building-promotion": ["写字楼项目推介", "Office Property Presentation"],
  "site-selection": ["写字楼选址方案", "Office Site Selection"],
  "analysis-briefing": ["业务分析汇报", "Business Analysis Briefing"],
} as const;

const failureMessages = {
  "scenario": ["请说明提案的用途，例如招商代理、选址、市场季报或项目推介。", "Specify whether you need a leasing proposal, site selection, a market report or a property presentation."],
  "missing-building": ["本次范围内未匹配到所需楼宇，请核对名称或选择项目。", "Choose the property or check its name against the authorized catalogue."],
  "ambiguous-building": ["匹配到同名或相近楼宇，请选择明确的项目。", "Select the intended property from the matching records."],
  "previous-selection-unavailable": ["所选楼宇在当前范围不可用，请重新选择。", "Select properties available in your current scope."],
  "multiple-targets": ["请明确一个目标项目。", "Select one target property."],
  "comparison-scope": ["请说明子市场，或明确选择要比较的楼宇。", "Specify a submarket or select the properties to compare."],
  "insufficient-buildings": ["当前范围符合条件的楼宇不足，请调整范围或数量。", "Adjust the scope or count to fit the available properties."],
  "analysis-result": ["请选择现有的分析结果。", "Select an existing analysis result."],
  "project-scope": ["请在对应业务范围内打开项目后继续。", "Open a project in the relevant business scope."],
  "city-scope": ["此项目和所需城市的范围不同，请切换到对应项目。", "Switch to a project in the requested city."],
  "period-conflict": ["请确认报告季度，或提供一个明确的起止期间。", "Specify the reporting quarter or an unambiguous period range."],
  "period-unavailable": ["当前范围没有匹配的正式季度数据。", "No matching formal quarter is available in the current scope."],
  "period-incomplete": ["所指定季度尚未完成正式发布，请选择已发布季度。", "The requested quarter has not been finalized. Select a published quarter."],
  "authorization-denied": ["当前范围或来源未获授权。", "The requested scope or sources are unavailable under your current permissions."],
  "no-evidence": ["当前范围与用途缺少可生成页面的获权来源。", "There is no usable evidence for this proposal in the current scope."],
} as const;

function describeBlock(block: SlideContent["blocks"][number], locale: "zh" | "en") {
  switch (block.kind) {
    case "paragraph": return block.text.slice(0, 160);
    case "metric": return block.label;
    case "chart": return block.series.map(series => series.name).join(" / ");
    case "table": return block.columns.join(" / ");
    case "image": return block.alt;
    case "case": return block.title;
    case "insight": return block.claim;
    case "map": return locale === "en" ? "Verified locations" : "已核验位置";
    case "timeline": return locale === "en" ? "Timeline" : "执行节点";
    case "team": return locale === "en" ? "Project team" : "项目团队";
  }
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function uniqueSorted<T>(items: readonly T[], key: (item: T) => string) {
  return [...new Map(items.map(item => [key(item), item])).entries()]
    .sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
}

function chooseProposalPages(pages: readonly ComposedProposalPage[], limit: number, priorities: readonly ProposalPriority[]) {
  const chosen = new Set(pages.filter(page => page.essential));
  const add = (page: ComposedProposalPage) => {
    if (chosen.size < limit) chosen.add(page);
  };
  const focused = new Set<ComposedProposalPage>();
  for (const priority of priorities) {
    if ([...focused].some(page => page.topics?.includes(priority))) continue;
    const page = pages.find(entry => entry.topics?.includes(priority));
    if (!page) continue;
    add(page);
    if (chosen.has(page)) focused.add(page);
  }
  // Retain the recipe's story order. When space remains, keep the preceding
  // context for the chosen analysis pages before filling from the full recipe.
  const supporting = new Set([...focused].flatMap(page => page.dependencyKinds ?? []));
  for (const page of pages) if (supporting.has(page.pageKind)) add(page);
  for (const page of pages) add(page);
  return chosen;
}

function buildPlan(
  brief: ProposalBrief,
  scope: PitchScope,
  composition: Awaited<ReturnType<ProposalDirectorPorts["compose"]>>,
  priorities: readonly ProposalPriority[],
) {
  const chosen = chooseProposalPages(composition.pages, brief.pages, priorities);
  const omitted: ProposalPlan["gaps"] = [];
  const usedPages = composition.pages.filter(page => {
    if (chosen.has(page)) return true;
    omitted.push({ pageKind: page.pageKind, reason: brief.language === "en" ? "Omitted within the requested length." : "按提案篇幅省略。" });
    return false;
  });
  if (!usedPages.length) return null;
  const validated = usedPages.map(page => ({ ...page, content: slideContentSchema.parse(page.content) }));
  const isTestData = validated.some(page => page.content.isTestData);
  if (validated.some(({ content, visuals }) =>
    content.locale !== brief.language || content.disclosure === "restricted"
    || visuals.some(visual => visual.disclosure === "restricted")
    || (brief.audience === "client" && (content.disclosure !== "client_approved"
      || content.isTestData
      || visuals.some(visual => visual.disclosure !== "client_approved" || visual.source.kind === "synthetic"))))) {
    throw new Error("PITCH_DENIED");
  }
  const data = uniqueSorted(validated.flatMap(page => page.data), item => digest(item));
  const visuals = uniqueSorted(validated.flatMap(page => page.visuals), item => `${item.id}:${item.version}:${item.versionHash}`);
  const gaps = [...composition.gaps, ...omitted];
  const receipts = new Map<string, { receipt: QueryReceipt; key: string }>();
  for (const receipt of composition.queryReceipts ?? []) {
    const { id, entityId, binding, result } = receipt;
    if (binding.disclosure !== "internal") continue;
    const key = digest([id, entityId, binding, result.operation, result.registryVersion, result.scopeFingerprint]);
    const existing = receipts.get(result.resultId);
    if (existing && existing.key !== key) throw new Error("PITCH_PROPOSAL_RECIPE_BINDING_MISMATCH");
    receipts.set(result.resultId, { receipt, key });
  }
  const citedReceipts = new Set<QueryReceipt>();
  // Source IDs can be request-local. Hash actual source locators, versions and
  // content after replacing their per-request identifiers with stable positions.
  const narrative = validated.map(({ content, ...page }) => {
    const indices = new Map(content.sources.map((source, index) => [source.id, index]));
    const sources = content.sources.map(({ id, ...source }) => {
      const match = receipts.get(id);
      // Keep the original receipt on the page. Only the comparison uses the
      // stable receipt key supplied by the authorized query adapter.
      if (match && source.kind === "record" && source.recordId === id && source.locator === `${match.receipt.id} · ${id}`
        && source.version === match.receipt.binding.dataVersion) {
        citedReceipts.add(match.receipt);
        return { ...source, recordId: match.key, locator: match.key };
      }
      if (source.locator.startsWith('map_submarket_profiles/')) {
        const editorial = [...receipts.values()].find(({ receipt }) => receipt.id === 'submarket-research'
          && receipt.result.sources.some(item => item.table === 'map_submarket_profiles' && item.recordId === source.recordId
            && item.recordVersion === source.version && source.locator === `map_submarket_profiles/${item.recordId}/${item.field}`));
        if (!editorial) throw new Error('PITCH_PROPOSAL_RECIPE_BINDING_MISMATCH');
        citedReceipts.add(editorial.receipt);
      }
      return source;
    });
    return {
      ...page,
      topics: undefined,
      content: {
        ...content,
        sources,
        blocks: content.blocks.map(({ sourceIds, ...block }) => ({ ...block, sourceRefs: sourceIds.map(id => indices.get(id)) })),
      },
    };
  });
  const analysisPriorities = priorities.length ? priorities : undefined;
  const fingerprint = digest({ scope, brief, recipe: composition.recipeVersion, theme: composition.theme, analysisPriorities, data, visuals, narrative, gaps });
  const snapshot: PitchContextSnapshot = { scope, brief, data, visuals, fingerprint, isTestData };
  const ids = validated.map((page, index) => stableId(`pitch-proposal-page/1:${fingerprint}:${page.pageKind}:${index}`));
  const slides: DirectedSlide[] = validated.map((page, index) => {
    const { content } = page;
    const chart = content.blocks.find(block => block.kind === "chart");
    return {
      id: ids[index],
      pageKind: page.pageKind,
      title: content.title,
      layoutId: page.layoutId,
      businessIntent: page.businessIntent,
      titleCandidates: [content.title],
      keyMessages: content.blocks.slice(0, 12).map(block => ({
        kind: block.kind, label: describeBlock(block, brief.language).slice(0, 240), sourceIds: block.sourceIds,
      })),
      materialReferences: page.materials ?? [],
      chart: chart?.kind === "chart" ? chart.chartType : content.blocks.some(block => block.kind === "table") ? "table" : null,
      data: page.data,
      visuals: page.visuals,
      follows: ids[index - 1] ?? null,
      precedes: ids[index + 1] ?? null,
      dependsOn: validated.slice(0, index).flatMap((prior, position) => page.dependencyKinds?.includes(prior.pageKind) ? [ids[position]] : []),
      uncertainties: page.uncertainties ?? [],
    };
  });
  const plan: DirectedProposalPlan = { id: stableId("pitch-proposal/1:" + fingerprint), version: 1, title: brief.title, contextFingerprint: fingerprint,
    slides, gaps, ...(analysisPriorities ? { analysisPriorities } : {}), ...(composition.theme ? { theme: composition.theme } : {}) };
  const generation = validated.every(page => !!page.generation)
    ? [...new Map(validated.map(page => [digest(page.generation!.part), page.generation!])).values()] : null;
  return { plan, snapshot, generation, verifySources: composition.verifySources,
    ...(citedReceipts.size ? { queryReceipts: [...citedReceipts] } : {}),
    pages: validated.map((page, index) => ({ id: ids[index], content: page.content, layoutId: page.layoutId })) };
}

export async function directProposal(
  input: ProposalRequest,
  ports: ProposalDirectorPorts,
  signal: AbortSignal,
  model?: ProposalModel,
): Promise<ProposalPlanningResult> {
  signal.throwIfAborted();
  const { brief: understood, ...route } = await interpretProposal(input, signal, model);
  const fail = (code: keyof typeof failureMessages, unavailable = false, candidates?: ProposalBuildingCandidate[]): ProposalPlanningResult => ({
    status: unavailable ? "unavailable" : "clarification", code,
    message: failureMessages[code][understood.language === "en" ? 1 : 0],
    ...(candidates ? { candidates } : {}),
    ...route,
  });
  const scenario = understood.scenario;
  if (!scenario) return fail("scenario");
  if (understood.periodConflict) return fail("period-conflict");
  if (scenario === "analysis-briefing" && !input.analysisResultId) return fail("analysis-result");
  try {
    signal.throwIfAborted();
    const { scope, defaults } = await ports.scope({ ...input, city: understood.city ?? input.city }, signal);
    const city = understood.city ?? scope.city;
    if (city.normalize("NFKC") !== scope.city.normalize("NFKC")) return fail("city-scope");
    const submarkets = understood.submarkets;
    const needsBuildings = scenario !== "market-report" && scenario !== "analysis-briefing";
    const target = resolveProposalBuildings({
      ...understood, city,
      buildingIds: understood.buildingIds.length || understood.buildingQueries.length || submarkets.length
        ? understood.buildingIds : defaults?.buildingIds ?? [],
    }, needsBuildings ? await ports.buildings({ city, submarkets }, signal) : []);
    signal.throwIfAborted();
    if (target.status !== "resolved") {
      return fail(target.code, false, target.code === "ambiguous-building" ? target.candidates : undefined);
    }
    const buildingIds = target.buildings.map(item => item.id);
    const formalNeeded = scenario === "market-report" || scenario === "site-selection" || scenario === "office-comparison" || !!understood.period;
    let period: string | null = null;
    let start: string | null = null;
    if (formalNeeded || needsBuildings) {
      const formal = resolveProposalPeriod(understood, await ports.periods({ city, submarkets, buildingIds, scenario }, signal));
      if (formal.status === "incomplete") return fail("period-incomplete");
      if (formal.status === "conflict") return fail("period-conflict");
      if (formal.status === "unavailable" && formalNeeded) return fail("period-unavailable", true);
      if (formal.status === "resolved") ({ period, start } = formal);
    }
    const client = understood.targetClient ?? defaults?.targetClient ?? null;
    const subject = target.buildings.length === 1 ? target.buildings[0].name
      : scenario === "market-report" ? [city, period].filter(Boolean).join(" ")
        : scenario === "site-selection" ? client : null;
    const title = [subject, titles[scenario][understood.language === "en" ? 1 : 0]].filter(Boolean).join(" · ").slice(0, 160);
    const brief: ProposalBrief = { scenario, buildingIds, city, submarkets, language: understood.language,
      style: understood.style, audience: input.audience, title, targetClient: client, period, start, pages: understood.pages };
    signal.throwIfAborted();
    const composed = await ports.compose({ brief, scope, projectId: input.projectId, buildings: target.buildings, priorities: understood.priorities,
      requestedPriorities: understood.requestedPriorities, clientRequirements: understood.clientRequirements,
      assetIds: input.assetIds, analysisResultId: input.analysisResultId }, signal);
    signal.throwIfAborted();
    const ready = buildPlan(brief, scope, composed, understood.requestedPriorities);
    if (!ready) return fail("no-evidence", true);
    return { status: "ready", selection: target.selection, ...ready, ...route };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && ["PITCH_DENIED", "QUERY_DENIED"].includes(error.message)) {
      return fail("authorization-denied", true);
    }
    if (error instanceof Error) {
      if (error.message === "PITCH_PROPOSAL_SCOPE_REQUIRED") return fail("project-scope");
      if (error.message === "PITCH_PROPOSAL_PERIOD_REQUIRED") return fail("period-unavailable", true);
      if (error.message === "PITCH_PROPOSAL_BUILDING_UNAVAILABLE") return fail("missing-building");
      if (error.message === "PITCH_PROPOSAL_REQUIRED_EVIDENCE") return fail("no-evidence", true);
    }
    throw error;
  }
}
