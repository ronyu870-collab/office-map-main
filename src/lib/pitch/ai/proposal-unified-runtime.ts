import type { PitchContext } from "../data/store";
import type { ProposalBrief, VisualAssetReference } from "../integration-contracts";
import { stableId } from "../library/extract";
import { proposalMapImage, proposalPhoto, proposalStackingImage, type ProposalOptions } from "../proposals";
import type { ProposalMaterials, UnifiedProposalContext } from "../proposals/unified-projection";
import type { ProposalComposerInput, ProposalDirectorPorts } from "./proposal-director";
import type { ProposalPriority } from "./proposal-brief";
import { readProposalMaterials } from "./proposal-materials";
import { composeUnifiedProposalPages } from "./proposal-recipe";

type VisualRead = { reference: VisualAssetReference; businessDate?: string | null } | null;
type Photo = VisualAssetReference & { category: string };
type LocationSelection = { buildingIds: string[] } | { city: string; submarkets: string[] };

export type UnifiedProposalReaders = {
  load(ctx: PitchContext, brief: ProposalBrief): Promise<UnifiedProposalContext>;
  options(ctx: PitchContext, input: ProposalComposerInput): Promise<Omit<ProposalOptions, "targetBuildingId">>;
  photos(ctx: PitchContext, input: { buildingIds: string[]; use: "profile" | "comparison" }): Promise<readonly {
    buildingId: string; primary: Photo | null; alternatives: readonly Photo[];
  }[]>;
  location(ctx: PitchContext, selection: LocationSelection, targetId?: string): Promise<VisualRead>;
  stacking?(ctx: PitchContext, buildingId: string): Promise<VisualRead>;
};

const photoKinds = { exterior: "exterior", interior: "office", lobby: "lobby", amenity: "amenity" } as const;
const prioritiesZh: Record<ProposalPriority, string> = {
  cost: "租金与成本", availability: "面积与可租条件", commute: "通勤与交通",
  "leasing-strategy": "招商策略", "market-trend": "市场趋势", "building-quality": "楼宇设施与规格",
};

function clientBrief(input: ProposalComposerInput, capturedAt: string): ProposalMaterials["customerBrief"] {
  const { brief, requestedPriorities, clientRequirements = [] } = input;
  if (brief.scenario !== "site-selection" || (!brief.targetClient && !clientRequirements.length)) return;
  const priorities = requestedPriorities?.map(priority => prioritiesZh[priority]) ?? [];
  const requirements = brief.targetClient ? [`目标客户 · ${brief.targetClient}`] : [];
  requirements.push(...clientRequirements.map(({ text }) => `用户输入 · ${text}`));
  if (priorities.length) requirements.push(`本次分析关注 · ${priorities.join("、")}`);
  const gaps = ["通勤起点", "目标入驻时间", "交付条件"];
  for (const [kind, label] of [["area", "面积"], ["budget", "预算"]] as const) {
    const count = clientRequirements.filter(item => item.kind === kind).length;
    if (!count) gaps.unshift(label);
    if (count > 1) gaps.unshift(`${label}条件的适用口径`);
  }
  requirements.push(`待客户确认 · ${gaps.join("、")}`);
  const selectionBasis = brief.submarkets.length ? [`候选范围 · ${brief.submarkets.join("、")}`] : ["候选范围 · 本次已选项目"];
  const id = stableId(JSON.stringify(["pitch-proposal-client-brief/1", requirements, selectionBasis]));
  return { value: { requirements, selectionBasis }, disclosure: "internal", sources: [{
    id, kind: "record", recordId: id, label: "本次选址需求输入", version: "brief/1",
    locator: "提案需求及当前项目范围", dataAsOf: capturedAt.slice(0, 10),
  }] };
}

function allows(reference: VisualAssetReference, kind: VisualAssetReference["kind"], ids?: readonly string[]) {
  return reference.kind === kind && reference.disclosure !== "restricted" && reference.source.kind !== "synthetic"
    && reference.buildingIds.length > 0 && (!ids || reference.buildingIds.every(id => ids.includes(id)));
}

async function optionalVisual<T>(read: Promise<T>, missing: T, signal: AbortSignal): Promise<T> {
  try {
    return await read;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && ["PITCH_PHOTO_CATALOG_UNAVAILABLE", "PITCH_VISUAL_SCOPE_TOO_LARGE",
      "PITCH_VISUAL_SOURCE_UNAVAILABLE"].includes(error.message)) return missing;
    throw error;
  }
}

function authorizedBuildings(brief: ProposalBrief, context: UnifiedProposalContext) {
  const authorized = new Map(context.buildings.filter(building => {
    const name = building.static.name;
    return name?.state === "valid" && name.permission === "authorized" && name.disclosure === "internal" && name.value === building.name;
  }).map(building => [building.buildingId, building.name]));
  if (brief.buildingIds.some(id => !authorized.has(id))) throw new Error("PITCH_PROPOSAL_BUILDING_UNAVAILABLE");
  return authorized;
}

async function readVisuals(ctx: PitchContext, brief: ProposalBrief, authorized: ReadonlyMap<string, string>, readers: UnifiedProposalReaders) {
  const ids = brief.scenario === "leasing-agency"
    ? [...new Set([...brief.buildingIds, ...authorized.keys()])].slice(0, 20) : brief.buildingIds;
  const target = ids[0];
  const promotion = brief.scenario === "building-promotion";
  const focused = promotion || brief.scenario === "leasing-agency";
  const market = brief.scenario === "market-report";
  const comparison = !focused && !market;
  const [photos, targetMap, candidatesMap, marketMap, stacking] = await Promise.all([
    ids.length && !market ? optionalVisual(readers.photos(ctx, { buildingIds: ids, use: promotion ? "profile" : "comparison" }), [], ctx.signal) : [],
    focused && target ? optionalVisual(readers.location(ctx, { buildingIds: [target] }, target), null, ctx.signal) : null,
    (comparison || brief.scenario === "leasing-agency") && ids.length > 1
      ? optionalVisual(readers.location(ctx, { buildingIds: ids }), null, ctx.signal) : null,
    market ? optionalVisual(readers.location(ctx, { city: brief.city, submarkets: brief.submarkets }), null, ctx.signal) : null,
    !market && target && readers.stacking ? optionalVisual(readers.stacking(ctx, target), null, ctx.signal) : null,
  ]);
  ctx.signal.throwIfAborted();
  const visuals: VisualAssetReference[] = [];
  const buildingMedia: Record<string, NonNullable<ProposalMaterials["buildingMedia"]>[string]> = {};
  for (const choice of photos) {
    const id = choice.buildingId;
    if (!ids.includes(id)) continue;
    const candidates = [choice.primary, ...choice.alternatives].filter((photo): photo is Photo => !!photo
      && photo.buildingIds.length === 1 && allows(photo, "photo", [id]));
    const exterior = candidates.find(photo => photo.category === "exterior");
    const interior = promotion ? candidates.filter(photo => Object.hasOwn(photoKinds, photo.category) && photo.category !== "exterior").slice(0, 3) : [];
    buildingMedia[id] = { photos: [...new Map([exterior, ...interior].flatMap(photo => photo ? [[photo.id, photo]] : [])).values()].map(photo => {
      const kind = photoKinds[photo.category as keyof typeof photoKinds];
      visuals.push(photo);
      return proposalPhoto(photo, kind, `${authorized.get(id)} · ${{ exterior: "外立面", office: "室内", lobby: "大堂", amenity: "配套" }[kind]}`);
    }) };
  }
  if (target && stacking && stacking.reference.buildingIds.length === 1 && allows(stacking.reference, "stacking-plan", [target])) {
    visuals.push(stacking.reference);
    buildingMedia[target] = { ...buildingMedia[target], stackingPlan: proposalStackingImage(stacking.reference,
      "楼层分布来源快照", stacking.businessDate ?? null) };
  }
  const map = (read: VisualRead, alt: string, buildingIds?: string[]) => {
    if (!read || !allows(read.reference, "map", buildingIds)) return undefined;
    visuals.push(read.reference);
    return proposalMapImage(read.reference, alt);
  };
  return {
    buildingMedia, visuals, maps: {
      target: map(targetMap, "项目区位", target ? [target] : []),
      candidates: map(candidatesMap, "候选楼宇区位", ids),
      market: map(marketMap, "子市场项目分布"),
    },
  } satisfies ProposalMaterials;
}

export function createUnifiedProposalComposer(ctx: PitchContext, readers: UnifiedProposalReaders,
  standard: ProposalDirectorPorts["compose"]): ProposalDirectorPorts["compose"] {
  return async (input, signal) => {
    const { brief, scope, assetIds } = input;
    if (brief.scenario === "analysis-briefing" || brief.language !== "zh" || !brief.period
      || (brief.scenario === "market-report" && brief.submarkets.length)) {
      return standard(input, signal);
    }
    if (brief.audience !== "internal") throw new Error("PITCH_DENIED");
    const actor = { ...ctx, signal };
    const context = await readers.load(actor, brief);
    signal.throwIfAborted();
    if (!context.period || brief.period !== `${context.period.year}-Q${context.period.quarter}`) throw new Error("PITCH_PROPOSAL_PERIOD_REQUIRED");
    const authorized = authorizedBuildings(brief, context);
    const [visuals, materials, options] = await Promise.all([
      readVisuals(actor, brief, authorized, readers),
      brief.scenario === "leasing-agency" && assetIds.length ? readProposalMaterials(actor, brief, scope, assetIds) : null,
      readers.options(actor, input),
    ]);
    signal.throwIfAborted();
    const result = composeUnifiedProposalPages(context, brief, scope, { ...options, targetBuildingId: brief.buildingIds[0] },
      { ...visuals, ...materials?.evidence, customerBrief: clientBrief(input, context.capturedAt) });
    for (const page of result.pages) {
      const sourceIds = new Set(page.content.sources.map(source => source.id));
      const references = materials?.references.filter(item => sourceIds.has(item.sourceId));
      if (references?.length) page.materials = references.map(({ id, version }) => ({ id, version }));
    }
    return { ...result, theme: { id: options.theme.id, version: options.theme.version } };
  };
}
