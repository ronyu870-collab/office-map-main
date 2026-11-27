import { loadBusinessSnapshot, recheckBusinessResults } from "@/src/lib/intelligence/business/research";
import { BUSINESS_DOMAIN } from "@/src/lib/intelligence/business/protocol";
import { z } from "zod";
import { generationSchema } from "../business/protocol";
import { checkGenerationSize, generateBusinessProject, prepareBusinessPages } from "../business/workflow";
import { studioRegistry } from "../data/renderWorkflow";
import { digest, pitchRpc, type PitchContext } from "../data/store";
import { getVisualPageReceipts, resolveReferencedVisualMedia } from "../visual-data/resolve";
import { projectContextSchema } from "../workspace/protocol";
import { getWorkspace } from "../workspace/workflow";
import type { ConfirmedProposal } from "./proposal-brief";
import { authorizedProposalModel } from "./proposal-model";
import { proposalGeneratedProjectId } from "./proposal-generation-lease";
import { createProposalDirectorPorts, proposalEvidenceVersion } from "./proposal-runtime";
import { submitConfirmedProposal, type ProposalGenerationPort, type ReviewedProposal } from "./proposal-workflow";

const receiptBinding = z.object({
  domain: z.enum(['quarter', 'lease', 'business']), dataVersion: z.string(), dataAsOf: z.iso.date().nullable(),
  permissionRevision: z.string(), policyVersion: z.string(), disclosure: z.literal('internal'),
});

async function persistReviewedPages(ctx: PitchContext, command: ConfirmedProposal, reviewed: ReviewedProposal, projectId: string) {
  const { snapshot, plan, queryReceipts } = reviewed;
  if (snapshot.brief.audience !== 'internal' || !queryReceipts?.length || !plan.theme)
    throw new Error('PITCH_PROPOSAL_GENERATION_UNAVAILABLE');
  const { id: themeId, version: themeVersion } = plan.theme;
  const { theme } = await studioRegistry(ctx, themeId, themeVersion);
  const pages = reviewed.pages.map(page => {
    if (!page.layoutId) throw new Error('PITCH_PROPOSAL_RECIPE_BINDING_MISMATCH');
    return { content: page.content, layoutId: page.layoutId, variant: 'standard' as const };
  });
  const { generated, slides, changes } = await prepareBusinessPages(ctx, pages, theme.definition, []);
  const bindings = [...new Map(plan.slides.flatMap(page => page.materialReferences).map(binding => [binding.id, binding])).values()];
  const snapshots = queryReceipts.map(({ id, entityId, binding: unverified, result }) => {
    const binding = receiptBinding.parse(unverified);
    return { id, entityId, binding, dataVersion: binding.dataVersion, dataAsOf: binding.dataAsOf,
      results: [{ resultId: result.resultId, operation: result.operation, parameters: result.parameters, table: result.table,
        scopeFingerprint: result.scopeFingerprint, registryVersion: result.registryVersion,
        sourceFingerprint: digest(Buffer.from(JSON.stringify(result.sources))) }] };
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
    proposalBrief: snapshot.brief, reviewedPlanId: plan.id, requestKey: plan.contextFingerprint,
    proposalContext: projectContextSchema.parse({ buildingIds: snapshot.brief.buildingIds, client: snapshot.brief.targetClient ?? '',
      business: snapshot.brief.scenario, language: snapshot.brief.language, period: snapshot.brief.period ?? '' }),
    generated, slides, changes, snapshots, bindings, recipes: [],
  };
  checkGenerationSize(input);
  await recheckBusinessResults(ctx.client, ctx.identity, ctx.signal, queryReceipts.map(receipt => receipt.result), true);
  await resolveReferencedVisualMedia(ctx, pins, [], 'internal');
  ctx.signal.throwIfAborted();
  await pitchRpc(ctx, input);
}

export async function generateConfirmedProposal(ctx: PitchContext, input: ConfirmedProposal) {
  const current = await getWorkspace(ctx, input.projectId);
  const generatedId = proposalGeneratedProjectId(ctx, input);
  const completed = { taskId: input.taskId, projectId: generatedId, state: "completed" as const };
  // Recovered projects are still private and must pass the original workspace
  // and source authorization on every read. No model runs on a successful retry.
  const workflow: ProposalGenerationPort = {
    find: async (_, signal) => {
      try {
        const existing = await getWorkspace({ ...ctx, signal }, generatedId);
        if (existing.slides.length && existing.project.parent_project_id === input.projectId) {
          await pitchRpc({ ...ctx, signal }, { action: "business_generation", projectId: generatedId });
          return completed;
        }
      } catch (error) {
        if (!(error instanceof Error) || !["PITCH_DENIED", "PITCH_INVALID"].includes(error.message)) throw error;
      }
      return null;
    },
    enqueue: async (_, reviewed, signal) => {
      const context = { ...ctx, signal };
      const { project } = current;
      if (project.version !== input.expectedVersion) throw new Error("PITCH_CONFLICT");
      if (!reviewed.generation?.length) {
        await reviewed.verifySources?.();
        await persistReviewedPages(context, input, reviewed, generatedId);
      } else {
        const command = generationSchema.parse({ action: "generate", projectId: generatedId, parentProjectId: input.projectId,
          title: reviewed.plan.title, scope: reviewed.snapshot.scope, language: reviewed.snapshot.brief.language,
          themeId: project.theme_id, themeVersion: project.theme_version, parts: reviewed.generation.map(entry => entry.part) });
        const expectedEvidence = reviewed.generation.map(item => item.evidenceVersion);
        await generateBusinessProject(context, { ...command, expectedParentVersion: input.expectedVersion }, undefined, undefined, false, async snapshots => {
          signal.throwIfAborted();
          if (JSON.stringify(snapshots.map(item => proposalEvidenceVersion(item.results))) !== JSON.stringify(expectedEvidence)) {
            throw new Error("PITCH_PROPOSAL_REVIEW_REQUIRED");
          }
          await reviewed.verifySources?.();
          signal.throwIfAborted();
        });
      }
      // Read the existing persisted result before reporting completion.
      const projectWithSlides = await getWorkspace(context, generatedId);
      if (!projectWithSlides.slides.length) throw new Error("PITCH_PROPOSAL_GENERATION_UNAVAILABLE");
      return completed;
    },
  };
  // Obtain a model permit only after a completed receipt lookup. Expired plans
  // are replanned under current source permissions before any new generation.
  return submitConfirmedProposal(input, createProposalDirectorPorts(ctx), workflow, ctx.signal, () => authorizedProposalModel(ctx, input.request));
}
