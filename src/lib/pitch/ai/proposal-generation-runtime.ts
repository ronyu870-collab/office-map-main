import { loadBusinessSnapshot, recheckBusinessResults } from "@/src/lib/intelligence/business/research";
import { BUSINESS_DOMAIN } from "@/src/lib/intelligence/business/protocol";
import { recheckLeaseResults } from "@/src/lib/intelligence/lease/research";
import { z } from "zod";
import { generationSchema } from "../business/protocol";
import { captureReviewedQuery } from "../business/document-version";
import { checkGenerationSize, prepareBusinessPages, prepareBusinessProject } from "../business/workflow";
import { studioRegistry } from "../data/renderWorkflow";
import { pitchRpc, type PitchContext } from "../data/store";
import { fitResolvedVisualImages, getVisualPageReceipts, resolveReferencedVisualMedia, resolveVisualPageMedia } from "../visual-data/resolve";
import { projectContextSchema } from "../workspace/protocol";
import { commitPayload, getWorkspace } from "../workspace/workflow";
import { carryPageGeometry, prepareProposalEdition, readEditionBaseline } from "../workspace/proposal-edition";
import { layoutSlides } from "../layout/engine";
import { LayoutError } from "../layout/metrics";
import { assertSceneQuality } from "../layout/quality";
import { readProposalPageMedia } from "./proposal-canvas-services";
import { lookupProposalTask, runProposalTask, startProposalTask } from "../workspace/proposal-tasks";
import type { ConfirmedProposal } from "./proposal-brief";
import { authorizedProposalModel } from "./proposal-model";
import { scheduleConfirmedProposal, type ProposalGenerationLease } from "./proposal-generation-lease";
import { createProposalDirectorPorts, proposalEvidenceVersion } from "./proposal-runtime";
import type { ReviewedProposal } from "./proposal-workflow";

const receiptBinding = z.object({
  domain: z.enum(['quarter', 'lease', 'business']), dataVersion: z.string(), dataAsOf: z.iso.date().nullable(),
  permissionRevision: z.string(), policyVersion: z.string(), disclosure: z.literal('internal'),
});

async function prepareReviewedPages(ctx: PitchContext, command: ConfirmedProposal, reviewed: ReviewedProposal, projectId: string) {
  const { snapshot, plan, queryReceipts } = reviewed;
  if (snapshot.brief.audience !== 'internal' || !queryReceipts?.length || !plan.theme)
    throw new Error('PITCH_PROPOSAL_GENERATION_UNAVAILABLE');
  const { id: themeId, version: themeVersion } = plan.theme;
  const { theme } = await studioRegistry(ctx, themeId, themeVersion);
  const pages = reviewed.pages.map(page => {
    if (!page.layoutId) throw new Error('PITCH_PROPOSAL_RECIPE_BINDING_MISMATCH');
    return { content: page.content, layoutId: page.layoutId, variant: 'standard' as const };
  });
  const { generated, slides, changes, slideGroups } = await prepareBusinessPages(ctx, pages, theme.definition, []);
  const kinds = new Map(plan.slides.map(page => [page.id, page.pageKind]));
  const occurrences = new Map<string, number>();
  const groups = reviewed.pages.map(page => {
    const kind = kinds.get(page.id);
    if (!kind) throw new Error("PITCH_PROPOSAL_RECIPE_BINDING_MISMATCH");
    const occurrence = occurrences.get(kind) ?? 0;
    occurrences.set(kind, occurrence + 1);
    return `${kind}:${occurrence}`;
  });
  const pageCounts = new Map<number, number>();
  const reviewedSlideKeys = Object.fromEntries(slides.map(({ slideId }, index) => {
    const group = slideGroups[index];
    const pageIndex = pageCounts.get(group) ?? 0;
    pageCounts.set(group, pageIndex + 1);
    return [slideId, `${groups[group]}:${pageIndex}`];
  }));
  const bindings = [...new Map(plan.slides.flatMap(page => page.materialReferences).map(binding => [binding.id, binding])).values()];
  const snapshots = queryReceipts.map(({ id, entityId, binding: unverified, result }) => {
    const binding = receiptBinding.parse(unverified);
    return { id, entityId, binding, dataVersion: binding.dataVersion, dataAsOf: binding.dataAsOf,
      results: [captureReviewedQuery(result)] };
  });
  const pins = getVisualPageReceipts(slides.map(page => page.content));
  for (const pin of new Map(pins.map(pin => [pin.id, pin])).values()) {
    if (pin.origin.type !== 'stacking-snapshot') continue;
    const buildingId = pin.origin.buildingId;
    const approved = await loadBusinessSnapshot(ctx.client, ctx.identity, ctx.signal, { tool: 'query_stacking_plan', buildingIds: [buildingId] });
    if (!approved.export) throw new Error('QUERY_DENIED');
    const binding = receiptBinding.parse({ domain: 'business', dataVersion: pin.versionHash, dataAsOf: null,
      permissionRevision: approved.permission_revision, policyVersion: BUSINESS_DOMAIN, disclosure: 'internal' });
    snapshots.push({ id: 'historical-stacking-appendix', entityId: buildingId, binding,
      dataVersion: binding.dataVersion, dataAsOf: null, results: [] });
  }
  const input = {
    action: 'business_generate_commit', projectId, parentProjectId: command.projectId, expectedParentVersion: command.expectedVersion,
    title: plan.title, scope: snapshot.scope, language: snapshot.brief.language, themeId, themeVersion,
    proposalBrief: snapshot.brief, reviewedPlanId: plan.id, reviewedSlideKeys, requestKey: plan.contextFingerprint,
    proposalContext: proposalContext(snapshot.brief),
    generated, slides, changes, snapshots, bindings, recipes: [],
  };
  checkGenerationSize(input);
  await Promise.all([
    recheckBusinessResults(ctx.client, ctx.identity, ctx.signal, queryReceipts.map(receipt => receipt.result), true),
    recheckLeaseResults(ctx.client, ctx.identity, ctx.signal, queryReceipts.filter(receipt => receipt.binding.domain === "lease").map(receipt => receipt.result), true),
  ]);
  await resolveReferencedVisualMedia(ctx, pins, [], 'internal');
  ctx.signal.throwIfAborted();
  return input;
}

function proposalContext(brief: ReviewedProposal["snapshot"]["brief"]) {
  return projectContextSchema.parse({ buildingIds: brief.buildingIds, client: brief.targetClient ?? "",
    business: brief.scenario, language: brief.language, period: brief.period ?? "" });
}

async function prepareFreshGeneration(ctx: PitchContext, command: ConfirmedProposal, reviewed: ReviewedProposal, projectId: string,
  project: Awaited<ReturnType<typeof getWorkspace>>["project"],
) {
  if (!reviewed.generation?.length) return prepareReviewedPages(ctx, command, reviewed, projectId);
  const generation = generationSchema.parse({ action: "generate", projectId, parentProjectId: command.projectId,
    title: reviewed.plan.title, scope: reviewed.snapshot.scope, language: reviewed.snapshot.brief.language,
    themeId: reviewed.plan.theme?.id ?? project.theme_id, themeVersion: reviewed.plan.theme?.version ?? project.theme_version,
    parts: reviewed.generation.map(entry => entry.part) });
  const { input, snapshotsByPart } = await prepareBusinessProject(ctx, { ...generation, expectedParentVersion: command.expectedVersion });
  const expectedEvidence = reviewed.generation.map(item => item.evidenceVersion);
  if (JSON.stringify(snapshotsByPart.map(item => proposalEvidenceVersion(item.results))) !== JSON.stringify(expectedEvidence)) {
    throw new Error("PITCH_PROPOSAL_REVIEW_REQUIRED");
  }
  await resolveReferencedVisualMedia(ctx, getVisualPageReceipts(input.slides.map(page => page.content)), [], "internal");
  return { ...input, reviewedPlanId: reviewed.plan.id, reviewedSlideKeys: undefined, proposalBrief: reviewed.snapshot.brief,
    proposalContext: proposalContext(reviewed.snapshot.brief) };
}

async function prepareGeneration(ctx: PitchContext, command: ConfirmedProposal, reviewed: ReviewedProposal, projectId: string) {
  const current = await getWorkspace(ctx, command.projectId);
  if (current.project.version !== command.expectedVersion) throw new Error("PITCH_CONFLICT");
  const input = await prepareFreshGeneration(ctx, command, reviewed, projectId, current.project);
  const prior = current.workspace.context;
  const next = input.proposalContext;
  if (prior.business !== "market-report" || next.business !== prior.business || !prior.period || !next.period ||
    prior.period === next.period || prior.client !== next.client || prior.language !== next.language ||
    prior.buildingIds.join() !== next.buildingIds.join() || !current.slides.length) return input;

  const baseline = await readEditionBaseline(ctx, current);
  const submarkets = (items: string[]) => [...items].sort().join("|");
  if (baseline.submarkets && submarkets(baseline.submarkets) !== submarkets(reviewed.snapshot.brief.submarkets)) return input;
  const overlay = await prepareProposalEdition({
    current, baseline, nextPeriod: next.period, recipeKeys: input.reviewedSlideKeys ?? {},
    fresh: input.slides.map(({ slideId, assetId, assetVersion, content, scene }) => ({
      id: slideId, asset_id: assetId, asset_version: assetVersion, template_id: "business-content", template_version: 1, content, scene,
    })),
    async render(content, previous, fresh) {
      const { theme } = await studioRegistry(ctx, fresh.themeId, fresh.themeVersion);
      try {
        const candidates = await layoutSlides(content, theme.definition, previous.layoutId, previous.variant);
        if (candidates.length !== (previous.pagination?.count ?? 1)) throw new Error("PITCH_EDITION_LAYOUT");
        const candidate = candidates[previous.pagination?.index ?? 0];
        if (!candidate) throw new Error("PITCH_EDITION_LAYOUT");
        const arranged = carryPageGeometry(previous, candidate);
        const resolved = await resolveVisualPageMedia(ctx, [{ content, scene: arranged }], "internal");
        const scene = fitResolvedVisualImages(arranged, resolved);
        await assertSceneQuality(scene, theme.definition, await readProposalPageMedia(ctx, current.project.id, { scene, content }, resolved));
        return scene;
      } catch (error) {
        if (error instanceof LayoutError) throw new Error("PITCH_EDITION_LAYOUT");
        throw error;
      }
    },
  });
  const editionSave = await commitPayload(ctx, {
    ...current, project: { ...current.project, id: projectId, version: 1 },
  }, overlay.pages, overlay.settings, {
    title: baseline.title && current.project.title !== baseline.title ? current.project.title : input.title,
    themeId: input.themeId,
    themeVersion: input.themeVersion,
    context: next,
    activeSlide: overlay.activeSlide,
  });
  const result = { ...input, editionSave };
  checkGenerationSize(result);
  ctx.signal.throwIfAborted();
  return result;
}

async function verifyCompletion(ctx: PitchContext, parentId: string, projectId: string) {
  const existing = await getWorkspace(ctx, projectId);
  if (!existing.slides.length || existing.project.parent_project_id !== parentId) throw new Error("PITCH_INVALID");
  await pitchRpc(ctx, { action: "business_generation", projectId });
}

const workspaceLease: ProposalGenerationLease = {
  lookup: async (ctx, input, projectId) => {
    const receipt = await lookupProposalTask(ctx, input, projectId);
    if (receipt) return receipt;
    // Recover the same completed project from before generation leases were installed.
    try {
      await verifyCompletion(ctx, input.projectId, projectId);
      return { taskId: input.taskId, projectId, state: "completed" };
    } catch (error) {
      if (!(error instanceof Error) || !["PITCH_DENIED", "PITCH_INVALID"].includes(error.message)) throw error;
      return null;
    }
  },
  start: startProposalTask,
  run: runProposalTask,
  prepare: prepareGeneration,
  verifyCompletion,
};

export function generateConfirmedProposal(ctx: PitchContext, input: ConfirmedProposal, schedule?: (worker: () => Promise<void>) => void) {
  return scheduleConfirmedProposal(ctx, input, createProposalDirectorPorts, workspaceLease, schedule, authorizedProposalModel);
}
