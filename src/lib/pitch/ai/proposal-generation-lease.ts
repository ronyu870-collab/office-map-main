import type { PitchContext } from "../data/store";
import { stableId } from "../library/extract";
import { confirmedProposalSchema, type ConfirmedProposal, type ProposalRequest } from "./proposal-brief";
import type { ProposalDirectorPorts } from "./proposal-director";
import type { ProposalModel } from "./proposal-interpretation";
import { assertProposalConfirmation, reviewConfirmedProposal, type ProposalGenerationReceipt, type ReviewedProposal } from "./proposal-workflow";

type PrepareClaim = (ctx: PitchContext, confirmation: unknown, generatedId: string, assemble: () => Promise<void>) =>
  Promise<Record<string, unknown>>;
export type ProposalGenerationLease = {
  lookup(ctx: PitchContext, input: ConfirmedProposal, generatedId: string): Promise<ProposalGenerationReceipt | null>;
  start(ctx: PitchContext, input: ConfirmedProposal, generatedId: string): Promise<ProposalGenerationReceipt>;
  run(ctx: PitchContext, projectId: string, taskId: string, prepare: PrepareClaim): Promise<void>;
  prepare(ctx: PitchContext, input: ConfirmedProposal, reviewed: ReviewedProposal, generatedId: string): Promise<Record<string, unknown>>;
  verifyCompletion(ctx: PitchContext, projectId: string, generatedId: string): Promise<void>;
};

export function proposalGeneratedProjectId(ctx: PitchContext, input: ConfirmedProposal) {
  return stableId(`pitch-proposal-generation/1:${ctx.identity.actorId}:${input.projectId}:${input.expectedVersion}:${input.taskId}:${input.planId}`);
}

export async function scheduleConfirmedProposal(ctx: PitchContext, input: ConfirmedProposal, director: (ctx: PitchContext) => ProposalDirectorPorts,
  lease: ProposalGenerationLease, schedule: ((worker: () => Promise<void>) => void) | undefined,
  model: (ctx: PitchContext, request: ProposalRequest) => Promise<ProposalModel | undefined>,
) {
  assertProposalConfirmation(input, ctx.signal);
  const generatedId = proposalGeneratedProjectId(ctx, input);
  const existing = await lease.lookup(ctx, input, generatedId);
  ctx.signal.throwIfAborted();
  if (!schedule && (!existing || existing.state === "queued")) throw new Error("PITCH_WORKER_UNAVAILABLE");
  const receipt = existing ?? await lease.start(ctx, input, generatedId);
  ctx.signal.throwIfAborted();
  if (receipt.taskId !== input.taskId || (receipt.state === "completed" && receipt.projectId !== generatedId)) {
    throw new Error("PITCH_INVALID");
  }
  if (receipt.state === "completed") await lease.verifyCompletion(ctx, input.projectId, generatedId);
  if (receipt.state === "queued" && schedule) {
    schedule(() => lease.run({ ...ctx, signal: AbortSignal.timeout(45000) }, input.projectId, input.taskId,
      async (worker, storedConfirmation, targetId, assemble) => {
        const claimed = confirmedProposalSchema.parse(storedConfirmation);
        if (claimed.projectId !== input.projectId || claimed.taskId !== input.taskId ||
          targetId !== generatedId || proposalGeneratedProjectId(worker, claimed) !== targetId) throw new Error("PITCH_INVALID");
        const reviewed = await reviewConfirmedProposal(claimed, director(worker), worker.signal, () => model(worker, claimed.request));
        await assemble();
        worker.signal.throwIfAborted();
        const generation = await lease.prepare(worker, claimed, reviewed, targetId);
        if (generation.action !== "business_generate_commit" || generation.projectId !== targetId ||
          generation.parentProjectId !== claimed.projectId || generation.expectedParentVersion !== claimed.expectedVersion ||
          generation.reviewedPlanId !== claimed.planId) throw new Error("PITCH_INVALID");
        await reviewed.verifySources?.();
        worker.signal.throwIfAborted();
        return generation;
      }));
  }
  ctx.signal.throwIfAborted();
  return receipt;
}
