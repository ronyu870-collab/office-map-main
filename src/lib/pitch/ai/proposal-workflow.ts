import { stableId } from "../library/extract";
import type { DocumentModificationPlan } from "../integration-contracts";
import type { WorkspaceSave } from "../workspace/protocol";
import type { ConfirmedProposal } from "./proposal-brief";
import { directProposal, type ProposalDirectorPorts, type ProposalPlanningResult } from "./proposal-director";
import { readProposalEdit, type ProposalEditIntent, type ProposalRevisionRequest } from "./proposal-edit-intent";
import type { ProposalModel } from "./proposal-interpretation";


export type ReviewedProposal = Extract<ProposalPlanningResult, { status: "ready" }>;
type Receipt = { taskId: string; projectId?: string; state: "queued" | "running" | "completed" | "failed" | "cancelled" };

export type ProposalGenerationPort = {
  // The existing workflow owns idempotency, version checks, lease, revalidation
  // at execution and completion, and cancellation/resumption of persisted tasks.
  // A reviewed source can supply a final authorization check before commit.
  find(input: ConfirmedProposal, signal: AbortSignal): Promise<Receipt | null>;
  enqueue(input: ConfirmedProposal, reviewed: ReviewedProposal, signal: AbortSignal): Promise<Receipt>;
};

/** Plan and confirmation use the same composer. Register these together with
 * the workspace transaction capable of saving its reviewed pages and sources. */
export type ProposalExecution = { director: ProposalDirectorPorts; workflow: ProposalGenerationPort };

export async function submitConfirmedProposal(
  input: ConfirmedProposal, director: ProposalDirectorPorts, workflow: ProposalGenerationPort,
  signal: AbortSignal, model?: ProposalModel | (() => Promise<ProposalModel | undefined>),
) {
  signal.throwIfAborted();
  if (stableId("pitch-proposal/1:" + input.contextFingerprint) !== input.planId) throw new Error("PITCH_PROPOSAL_REVIEW_REQUIRED");
  const existing = await workflow.find(input, signal);
  signal.throwIfAborted();
  if (existing) return existing;
  const proposal = await directProposal(input.request, director, signal, typeof model === "function" ? await model() : model);
  signal.throwIfAborted();
  if (proposal.status !== "ready" || proposal.plan.id !== input.planId || proposal.plan.contextFingerprint !== input.contextFingerprint) {
    throw new Error("PITCH_PROPOSAL_REVIEW_REQUIRED");
  }
  return workflow.enqueue(input, proposal, signal);
}

type RevisionPage = {
  id: string;
  version: number;
  objectIds: readonly string[];
  manual: boolean;
};

type RevisionInput = {
  projectId: string;
  expectedVersion: number;
  target: ReturnType<typeof readProposalEdit> & { kind: "intent" };
  selected: RevisionPage[];
  current: RevisionPage[];
};

export type ProposalRevisionPort = {
  read(projectId: string, signal: AbortSignal): Promise<{ version: number; pages: RevisionPage[] }>;
  compile(input: RevisionInput, signal: AbortSignal): Promise<{
    id: string;
    pages: WorkspaceSave["pages"];
    refresh?: DocumentModificationPlan["refresh"];
    gaps?: string[];
  } | null>;
};

export async function previewProposalRevision(
  input: ProposalRevisionRequest, port: ProposalRevisionPort, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const current = await port.read(input.projectId, signal);
  signal.throwIfAborted();
  if (current.version !== input.expectedVersion) throw new Error("PITCH_CONFLICT");
  const intent = readProposalEdit(input);
  if (intent.kind === "clarification") return { status: "clarification" as const, message: intent.message };
  const { target } = intent;
  const chosen = target.kind === "pages" ? target.pageIds : target.kind === "objects" ? [target.pageId] : current.pages.map(page => page.id);
  const selected = current.pages.filter(page => chosen.includes(page.id));
  if (selected.length === 0 || selected.length !== chosen.length
    || target.kind === "objects" && target.objectIds.some(id => !selected[0].objectIds.includes(id))) throw new Error("PITCH_INVALID");

  const prepared = await port.compile({ projectId: input.projectId, expectedVersion: current.version, target: intent, selected, current: current.pages }, signal);
  signal.throwIfAborted();
  const unchanged = { status: "unavailable" as const, operations: intent.operations, requiresVerification: intent.verifyFacts };
  if (!prepared || intent.verifyFacts && !prepared.refresh) return unchanged;
  const { pages, refresh, id } = prepared;
  const outOfBounds = pages.some(page => !chosen.includes(page.id) && Object.keys(page).some(key => key !== "id"));
  const removesManual = current.pages.some(page => page.manual && !pages.some(edit => edit.id === page.id));
  const resetsManual = pages.some(edit => edit.resetObjectLayout && current.pages.some(page => page.manual && page.id === edit.id));
  if (outOfBounds || removesManual || resetsManual) throw new Error("PITCH_PROPOSAL_UNSAFE_EDIT");
  return {
    status: "ready" as const,
    plan: {
      projectId: input.projectId, expectedVersion: current.version, id, pages,
      basePageVersions: current.pages.map(page => ({ id: page.id, version: page.version })),
      ...(refresh ? { refresh } : {}),
    } satisfies DocumentModificationPlan,
    operations: intent.operations as ProposalEditIntent[],
    gaps: prepared.gaps ?? [],
  };
}
