import { generationSchema } from "../business/protocol";
import { generateBusinessProject } from "../business/workflow";
import { pitchRpc, type PitchContext } from "../data/store";
import { getWorkspace } from "../workspace/workflow";
import type { ConfirmedProposal } from "./proposal-brief";
import { authorizedProposalModel } from "./proposal-model";
import { proposalGeneratedProjectId } from "./proposal-generation-lease";
import { createProposalDirectorPorts, proposalEvidenceVersion } from "./proposal-runtime";
import { submitConfirmedProposal, type ProposalGenerationPort } from "./proposal-workflow";

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
      if (!reviewed.generation?.length) throw new Error("PITCH_PROPOSAL_GENERATION_UNAVAILABLE");
      const command = generationSchema.parse({ action: "generate", projectId: generatedId, parentProjectId: input.projectId,
        title: reviewed.plan.title, scope: reviewed.snapshot.scope, language: reviewed.snapshot.brief.language,
        themeId: reviewed.plan.theme?.id ?? project.theme_id, themeVersion: reviewed.plan.theme?.version ?? project.theme_version,
        parts: reviewed.generation.map(entry => entry.part) });
      const expectedEvidence = reviewed.generation.map(item => item.evidenceVersion);
      await generateBusinessProject(context, command, undefined, undefined, false, async snapshots => {
        signal.throwIfAborted();
        if (JSON.stringify(snapshots.map(item => proposalEvidenceVersion(item.results))) !== JSON.stringify(expectedEvidence)) {
          throw new Error("PITCH_PROPOSAL_REVIEW_REQUIRED");
        }
        await reviewed.verifySources?.();
        signal.throwIfAborted();
        const latest = await getWorkspace(context, input.projectId);
        signal.throwIfAborted();
        if (latest.project.version !== input.expectedVersion) throw new Error("PITCH_CONFLICT");
      });
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
