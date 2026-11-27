import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pitchRpc, type PitchContext } from '../data/store';

const confirmationSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  planId: z.uuid(),
  contextFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).passthrough();
const receiptSchema = z.object({
  id: z.uuid(),
  source_project_id: z.uuid(),
  error_code: z.string().nullable().optional(),
  state: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']),
});
const claimSchema = z.object({
  claimed: z.boolean(),
  task: z.object({
    source_project_id: z.uuid(),
    command: z.object({ confirmation: confirmationSchema }),
  }).optional(),
});

async function proposalReceipt(ctx: PitchContext, input: unknown, sourceProjectId: string,
  action: 'workspace_proposal_start' | 'workspace_proposal_lookup',
) {
  const confirmation = confirmationSchema.parse(input);
  const result = await pitchRpc(ctx, { action, taskId: confirmation.taskId,
    projectId: confirmation.projectId, sourceProjectId, confirmation });
  if (result === null && action === 'workspace_proposal_lookup') return null;
  const receipt = receiptSchema.parse(result);
  return {
    taskId: receipt.id,
    state: receipt.state === 'processing' ? 'running' as const : receipt.state,
    ...(receipt.state === 'completed' ? { projectId: receipt.source_project_id } : {}),
    ...(receipt.state === 'failed' && receipt.error_code === 'PITCH_EDITION_LAYOUT' ? { errorCode: receipt.error_code } : {}),
  };
}

export async function startProposalTask(ctx: PitchContext, input: unknown, sourceProjectId: string) {
  const receipt = await proposalReceipt(ctx, input, sourceProjectId, 'workspace_proposal_start');
  if (!receipt) throw new Error('PITCH_INVALID');
  return receipt;
}

export function lookupProposalTask(ctx: PitchContext, input: unknown, sourceProjectId: string) {
  return proposalReceipt(ctx, input, sourceProjectId, 'workspace_proposal_lookup');
}

type ProposalPreparation = (ctx: PitchContext, confirmation: unknown, sourceProjectId: string,
  assemble: () => Promise<void>) => Promise<Record<string, unknown>>;

/** Persist only a server-prepared generation, while the original worker lease
 * and parent version are held by the same transaction as the new project. */
export async function runProposalTask(ctx: PitchContext, projectId: string, taskId: string, prepare: ProposalPreparation) {
  const job = { projectId, taskId, token: randomUUID() };
  try {
    const claim = claimSchema.parse(await pitchRpc(ctx, { action: 'workspace_proposal_claim', ...job }));
    if (!claim.claimed || !claim.task) return;
    const assemble = async () => {
      await pitchRpc(ctx, { action: 'workspace_proposal_assemble', ...job });
    };
    const generation = await prepare(ctx, claim.task.command.confirmation, claim.task.source_project_id, assemble);
    ctx.signal.throwIfAborted();
    await pitchRpc(ctx, { action: 'workspace_proposal_complete', ...job, generation });
  } catch (error) {
    const candidate = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code
      : error instanceof Error ? error.message : '';
    const errorCode = candidate === 'QUERY_DENIED' ? 'PITCH_DENIED'
      : /^PITCH_[A-Z_]+$/.test(candidate) ? candidate : 'PITCH_GENERATION_FAILED';
    try {
      await pitchRpc({ ...ctx, signal: AbortSignal.timeout(4_000) }, { action: 'workspace_proposal_fail', ...job, errorCode });
    } catch {
      // The status action expires a lost lease. Cancellation or revocation
      // prevents this worker from writing any further state.
    }
  }
}
