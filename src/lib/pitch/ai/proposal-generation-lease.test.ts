import { beforeEach, expect, it, vi } from "vitest";
import type { PitchContext, PitchDependencies } from "../data/store";
import { stableId } from "../library/extract";
import { confirmedProposalSchema } from "./proposal-brief";
import type { ProposalDirectorPorts } from "./proposal-director";
import { proposalGeneratedProjectId, type ProposalGenerationLease } from "./proposal-generation-lease";
import type { ProposalGenerationReceipt } from "./proposal-workflow";
import { handleAiRequest } from "./http";

const fixtures = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn(), direct: vi.fn(), model: vi.fn() }));
vi.mock("../data/store", async original => ({ ...await original<typeof import("../data/store")>(),
  authorizePitch: fixtures.identity, pitchRpc: fixtures.rpc }));
vi.mock("./proposal-director", async original => ({ ...await original<typeof import("./proposal-director")>(), directProposal: fixtures.direct }));
vi.mock("./proposal-model", () => ({ authorizedProposalModel: fixtures.model }));

const projectId = "cdb16d01-e756-4d5d-a904-a15e7acf4840", taskId = "e6cfc62a-0183-49e1-9f43-2b0475ca8a57";
const contextFingerprint = "f".repeat(64);
const confirmation = confirmedProposalSchema.parse({
  projectId, taskId, expectedVersion: 8, planId: stableId("pitch-proposal/1:" + contextFingerprint),
  contextFingerprint, request: { projectId, question: "为霄云路33号制作招商代理提案" },
});
const plan = { id: confirmation.planId, contextFingerprint };
const director = {} as ProposalDirectorPorts;
const dependencies = { enabled: true } as PitchDependencies;

function taskSetup() {
  const request = new AbortController();
  const ctx = { identity: { actorId: projectId }, signal: request.signal } as PitchContext;
  const generatedId = proposalGeneratedProjectId(ctx, confirmation);
  let state: ProposalGenerationReceipt | null = null;
  let callbacks: (() => Promise<void>)[] = [];
  const lease = {
    lookup: vi.fn<ProposalGenerationLease["lookup"]>(async () => state),
    start: vi.fn<ProposalGenerationLease["start"]>(async () => state = { taskId, state: "queued" }),
    run: vi.fn<ProposalGenerationLease["run"]>(async (worker, _projectId, _taskId, prepare) => {
      if (state?.state !== "queued") return;
      state = { taskId, state: "running" };
      try {
        await prepare(worker, confirmation, generatedId, assemble);
        state = { taskId, state: "completed", projectId: generatedId };
      } catch (error) {
        state = { taskId, state: "failed" };
        throw error;
      }
    }),
    prepare: vi.fn<ProposalGenerationLease["prepare"]>(async (_ctx, input, _, targetId) => ({
      action: "business_generate_commit", projectId: targetId, parentProjectId: input.projectId,
      expectedParentVersion: input.expectedVersion, reviewedPlanId: input.planId,
    })),
    verifyCompletion: vi.fn<ProposalGenerationLease["verifyCompletion"]>(async () => undefined),
  } satisfies ProposalGenerationLease;
  const assemble = vi.fn(async () => undefined);
  fixtures.identity.mockResolvedValue(ctx);
  const command = (value = confirmation, schedule = true) => handleAiRequest(
    new Request("https://pitch.test/api/intelligence/pitch/ai", { method: "POST",
      headers: { "content-type": "application/json", origin: "https://pitch.test" },
      body: JSON.stringify({ action: "proposal_generate", confirmation: value }) }),
    dependencies, schedule ? work => callbacks.push(work) : undefined, undefined, () => ({ director, lease }),
  );
  return { request, generatedId, lease, assemble, command, setState: (receipt: ProposalGenerationReceipt) => { state = receipt; },
    drain: async () => { const queue = callbacks; callbacks = []; await Promise.all(queue.map(work => work())); } };
}

beforeEach(() => {
  fixtures.identity.mockReset();
  fixtures.rpc.mockReset().mockResolvedValue({});
  fixtures.direct.mockReset();
  fixtures.model.mockReset().mockResolvedValue(undefined);
});

it("uses the registered lease through the normal AI route and prepares the exact reviewed plan once", async () => {
  const verifySources = vi.fn(async () => undefined);
  fixtures.direct.mockResolvedValue({ status: "ready", plan, verifySources });
  const { request, command, lease, assemble, drain, generatedId } = taskSetup();
  const first = await command();
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ taskId, state: "queued" });
  await command();
  expect(lease.start).toHaveBeenCalledOnce();
  expect(fixtures.model).not.toHaveBeenCalled();
  request.abort();
  await drain();
  expect(fixtures.model).toHaveBeenCalledOnce();
  expect(fixtures.direct).toHaveBeenCalledWith(confirmation.request, director, expect.any(AbortSignal), undefined, undefined);
  expect(assemble).toHaveBeenCalledOnce();
  expect(lease.prepare).toHaveBeenCalledWith(expect.anything(), confirmation, expect.objectContaining({ plan }), generatedId);
  expect(verifySources).toHaveBeenCalledOnce();
  expect(assemble.mock.invocationCallOrder[0]).toBeLessThan(lease.prepare.mock.invocationCallOrder[0]);
  expect(lease.prepare.mock.invocationCallOrder[0]).toBeLessThan(verifySources.mock.invocationCallOrder[0]);
});

it("reopens the original completed receipt after an authorization check without a model or scheduler", async () => {
  const { command, drain, lease, setState, generatedId } = taskSetup();
  const completion = { taskId, state: "completed", projectId: generatedId } as const;
  setState(completion);
  expect(await (await command(confirmation, false)).json()).toEqual(completion);
  expect(lease.verifyCompletion).toHaveBeenCalledWith(expect.anything(), projectId, generatedId);
  lease.verifyCompletion.mockRejectedValueOnce(new Error("PITCH_DENIED"));
  expect((await command(confirmation, false)).status).toBe(403);
  await drain();
  expect(fixtures.model).not.toHaveBeenCalled();
  expect(lease.run).not.toHaveBeenCalled();
});

it("does not assemble a cancelled generation and refuses a changed review on recovery", async () => {
  const { command, drain, lease, assemble, setState } = taskSetup();
  await command();
  setState({ taskId, state: "cancelled" });
  await drain();
  expect(await (await command()).json()).toEqual({ taskId, state: "cancelled" });
  expect(fixtures.model).not.toHaveBeenCalled();
  setState({ taskId, state: "queued" });
  fixtures.direct.mockResolvedValue({ status: "ready", plan: { ...plan, contextFingerprint: "0".repeat(64) } });
  await command();
  await expect(drain()).rejects.toThrow("PITCH_PROPOSAL_REVIEW_REQUIRED");
  expect(assemble).not.toHaveBeenCalled();
  expect(lease.prepare).not.toHaveBeenCalled();
});

it("refuses a prepared write that uses a different parent revision or reviewed plan", async () => {
  fixtures.direct.mockResolvedValue({ status: "ready", plan });
  const { command, drain, lease, generatedId } = taskSetup();
  lease.prepare.mockResolvedValueOnce({
    action: "business_generate_commit", projectId: generatedId, parentProjectId: projectId,
    expectedParentVersion: confirmation.expectedVersion - 1, reviewedPlanId: confirmation.planId,
  });
  await command();
  await expect(drain()).rejects.toThrow("PITCH_INVALID");
  expect(await (await command()).json()).toEqual({ taskId, state: "failed" });
});

it("requires a valid review receipt before touching the lease and skips scheduling without an available worker", async () => {
  const { command, lease } = taskSetup();
  expect((await command({ ...confirmation, planId: taskId })).status).toBe(409);
  expect(lease.lookup).not.toHaveBeenCalled();
  expect((await command(confirmation, false)).status).toBe(503);
  expect(lease.start).not.toHaveBeenCalled();
  expect(lease.run).not.toHaveBeenCalled();
});
