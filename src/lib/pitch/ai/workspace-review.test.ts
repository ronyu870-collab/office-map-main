import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PitchContext, PitchDependencies } from "../data/store";
import { handleAiRequest } from "./http";
import type { ProposalRevisionRequest } from "./proposal-edit-intent";
import type { ProposalRevisionServices } from "./proposal-revision-runtime";
import { installedWorkspaceReviewServices } from "./workspace-review";

const fixture = vi.hoisted(() => ({ enabled: true, authorize: vi.fn(), planner: vi.fn(), workspace: vi.fn(), rpc: vi.fn() }));
vi.mock("../data/store", async original => ({ ...await original<typeof import("../data/store")>(),
  authorizePitch: fixture.authorize, pitchRpc: fixture.rpc }));
vi.mock("./proposal-revision-runtime", () => ({ planProposalRevision: fixture.planner }));
vi.mock("../workspace/http", () => ({ handleWorkspaceRequest: fixture.workspace }));
vi.mock("../workspace/protocol", async original => {
  const protocol = await original<typeof import("../workspace/protocol")>();
  const base = protocol.workspaceCommandSchema;
  const installed = z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("preview_data_refresh"), projectId: z.uuid(), slideId: z.uuid(), expectedVersion: z.number().int().positive(),
      period: z.strictObject({ year: z.number(), quarter: z.number() }),
    }),
    z.strictObject({
      action: z.literal("review_handoff"), handoff: z.strictObject({ projectId: z.uuid(), period: z.string(), language: z.literal("zh"),
        source: z.strictObject({ kind: z.literal("buildings"), buildingIds: z.array(z.uuid()) }) }),
    }),
  ]);
  return { ...protocol, workspaceCommandSchema: {
    get options() { return fixture.enabled ? installed.options : base.options.filter(option =>
      !["preview_data_refresh", "review_handoff"].some(action => option.shape.action.safeParse(action).success)); },
    parse(input: unknown) { return (fixture.enabled ? installed : base).parse(input); },
  } };
});

const projectId = "cac1f6de-f238-4415-a4f2-000000000001", slideId = "cac1f6de-f238-4415-a4f2-000000000002";
const controller = new AbortController();
const ctx = { signal: controller.signal } as PitchContext;
const deps = { enabled: true } as PitchDependencies;
const quarterCommand = { action: "preview_data_refresh" as const, projectId, slideId, expectedVersion: 3, period: { year: 2026, quarter: 2 } };
const handoffCommand = { action: "review_handoff" as const, handoff: {
  projectId, period: "2026-Q2", language: "zh" as const, source: { kind: "buildings" as const, buildingIds: [slideId] },
} };

function input(question: string) {
  return new Request("https://internal-listener/api/intelligence/pitch/ai", {
    method: "POST",
    headers: { authorization: "Bearer integration-fixture", host: "studio.example.test", origin: "https://studio.example.test",
      "content-type": "application/json", "x-forwarded-host": "ignored.example.test", "content-length": "1000" },
    body: JSON.stringify({ action: "proposal_revision", input: { projectId, expectedVersion: 3, currentPageId: slideId, question } }),
  });
}

beforeEach(() => {
  fixture.enabled = true;
  fixture.authorize.mockReset().mockResolvedValue(ctx);
  fixture.rpc.mockReset().mockResolvedValue({});
  fixture.workspace.mockReset().mockImplementation(async (request: Request) => Response.json({ reviewed: await request.json() }));
  fixture.planner.mockReset().mockImplementation(async (actor: PitchContext, request: ProposalRevisionRequest, services: ProposalRevisionServices) => {
    if (request.question.includes("季度")) return services.previewQuarter?.(actor, quarterCommand) ?? { status: "unavailable" };
    return services.reviewHandoff?.(actor, handoffCommand) ?? { status: "unavailable" };
  });
});

it.each([
  ["更新季度", quarterCommand],
  ["增加某办公楼为竞品", handoffCommand],
])("uses the installed workspace review through the normal AI request for %s", async (question, command) => {
  const response = await handleAiRequest(input(question), deps);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ reviewed: command });
  const [forwarded, dependencies, schedule] = fixture.workspace.mock.calls[0] as [Request, PitchDependencies, unknown];
  expect(forwarded.url).toBe("https://internal-listener/api/intelligence/pitch/workspace");
  expect([...forwarded.headers]).toEqual([
    ["authorization", "Bearer integration-fixture"], ["content-type", "application/json"],
    ["host", "studio.example.test"], ["origin", "https://studio.example.test"],
  ]);
  expect(dependencies).toBe(deps);
  expect(schedule).toBeUndefined();
});

it("leaves older workspaces on the existing AI path when the review commands are absent", async () => {
  fixture.enabled = false;
  const response = await handleAiRequest(input("更新季度"), deps);
  expect(await response.json()).toEqual({ status: "unavailable" });
  expect(fixture.workspace).not.toHaveBeenCalled();
});

it("preserves the reauthorization and version failure boundaries without forwarding workspace body details", async () => {
  fixture.workspace.mockResolvedValueOnce(Response.json({ error: "private fixture details" }, { status: 403 }));
  const denied = await handleAiRequest(input("更新季度"), deps);
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "PITCH_DENIED" });
  expect(fixture.rpc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ai_feedback", event: "permission_block" }));
  fixture.workspace.mockResolvedValueOnce(Response.json({ error: "private fixture details" }, { status: 409 }));
  const conflict = await handleAiRequest(input("增加竞品"), deps);
  expect(conflict.status).toBe(409);
  expect(await conflict.text()).not.toContain("fixture details");
});

it("keeps a cancelled revision from reaching the installed workspace handler", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const service = installedWorkspaceReviewServices(input("更新季度"), deps);
  await expect(service.previewQuarter!({ ...ctx, signal: controller.signal }, quarterCommand)).rejects.toThrow("cancelled");
  expect(fixture.workspace).not.toHaveBeenCalled();
});

it("rejects a mutation even if a misconfigured planner passes it to the read-only service", async () => {
  const service = installedWorkspaceReviewServices(input("更新季度"), deps);
  const write = { ...quarterCommand, action: "apply_data_refresh" } as unknown as typeof quarterCommand;
  await expect(service.previewQuarter!(ctx, write)).rejects.toThrow("PITCH_INVALID");
  expect(fixture.workspace).not.toHaveBeenCalled();
});
