import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { PitchContext, PitchDependencies } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import { layoutSlides } from "../layout/engine";
import { renderPitchPptx } from "../render/pptx";
import { proposalFixture } from "../proposals/__tests__/fixture";
import { composeRecipePages } from "./proposal-recipe";
import { directProposal, type ComposedProposalPage, type ProposalDirectorPorts } from "./proposal-director";
import { handleAiRequest } from "./http";
import { proposalRequestSchema, type ConfirmedProposal } from "./proposal-brief";
import { proposalGeneratedProjectId, type ProposalGenerationLease } from "./proposal-generation-lease";
import type { ProposalModel } from "./proposal-interpretation";
import { proposalRevisionRequestSchema } from "./proposal-edit-intent";
import { previewProposalRevision, submitConfirmedProposal, type ProposalRevisionPort, type ReviewedProposal } from "./proposal-workflow";

const modelAuthorization = vi.hoisted(() => vi.fn<() => Promise<ProposalModel | undefined>>());
vi.mock("../data/store", async original => ({ ...await original<typeof import("../data/store")>(),
  authorizePitch: async (incoming: Request) => ({ signal: incoming.signal, identity: {
    actorId: projectId, effectiveUserId: projectId, sessionId: incoming.headers.get("x-test-session") ?? taskId,
    expiresAt: Date.now() + 60 * 60_000,
  } }),
}));
vi.mock("./proposal-model", () => ({ authorizedProposalModel: modelAuthorization }));
vi.mock("@/src/lib/intelligence/query/http", () => ({ queryHttpDependencies: () => ({ keys: { digestKey: Buffer.alloc(32, 7) } }) }));

const projectId = "10000000-0000-4000-8000-000000000123";
const taskId = "10000000-0000-4000-8000-000000000124";
const scope = { organizationId: "colliers-test", region: "华北", city: "北京", businessLine: "office" };
const target = { id: "10000000-0000-4000-8000-000000000101", city: "北京", name: "霄云路33号", submarket: "燕莎", grade: "甲级" };
const competitors = ["办公楼甲", "办公楼乙", "办公楼丙", "办公楼丁", "办公楼戊"].map((name, index) => ({
  id: `10000000-0000-4000-8000-00000000010${index + 2}`, name, city: "北京", grade: "甲级", submarket: "CBD",
}));
const request = (question: string) => proposalRequestSchema.parse({ question, projectId });
const newSignal = () => new AbortController().signal;

function ports(): ProposalDirectorPorts {
  return {
    scope: async () => ({ scope }),
    buildings: async () => [target, ...competitors],
    periods: async () => [{ period: "2026-Q2", status: "formal" }, { period: "2026-Q3", status: "incomplete" }],
    compose: async ({ brief }) => {
      const pageKinds = {
        "leasing-agency": ["profile", "rent-position", "implementation"],
        "office-comparison": ["parameters", "rent-position", "tradeoffs"],
        "market-report": ["key-indicators", "rent-trend", "methodology"],
        "building-promotion": ["profile", "parameters", "occupier-fit"],
        "site-selection": ["requirements", "parameters", "tradeoffs"],
        "analysis-briefing": ["report-result"],
      }[brief.scenario];
      const pages = pageKinds.map((pageKind): ComposedProposalPage => {
        const sourceId = randomUUID();
        return {
          pageKind, layoutId: "data-table", businessIntent: "fact", visuals: [],
          data: [{ dataVersion: "fixture-v1", dataAsOf: "2026-06-30", permissionRevision: "fixture", policyVersion: "policy", domain: "quarter" }],
          content: {
            protocol: "colliers-pitch/1", locale: brief.language, title: pageKind, dataAsOf: "2026-06-30",
            disclosure: "internal", isTestData: true,
            sources: [{ id: sourceId, kind: "synthetic", label: "合成来源", locator: pageKind, version: "1", dataAsOf: "2026-06-30" }],
            blocks: [{ kind: "table", columns: ["口径", "值"], rows: [["合成数据", 123]], sourceIds: [sourceId] }],
          },
        };
      });
      return { pages, gaps: [{ pageKind: "photo", reason: "暂无图片" }], recipeVersion: "fixture-recipe/1" };
    },
  };
}

function recipePorts(scenario: "leasing-agency" | "office-comparison" | "market-report" | "building-promotion" | "site-selection"): ProposalDirectorPorts {
  const fixture = proposalFixture(scenario);
  const compares = scenario === "office-comparison" || scenario === "site-selection";
  const submarket = compares ? "CBD" : "燕莎";
  const fixtureBuildings = fixture.data.buildings.map((building, index) => ({
    ...building, submarket,
    ...(index === 0 && !compares ? {
      name: target.name, identity: { ...building.identity, value: { name: target.name } },
    } : {}),
  }));
  const market = { ...fixture.data.market!, city: "北京", name: "隔离验证市场",
    submarket: scenario === "leasing-agency" ? submarket : undefined };
  return {
    ...ports(),
    buildings: async () => fixtureBuildings.map(building => ({ ...building, city: "北京" })),
    compose: async ({ brief }) => composeRecipePages({
      ...fixture.snapshot, scope, visuals: [],
      brief: scenario === "leasing-agency" ? { ...brief, buildingIds: fixtureBuildings.map(building => building.id) } : brief,
    }, { ...fixture.data, buildings: fixtureBuildings, market }, { theme: STUDIO_THEME }),
  };
}

describe("Proposal Director review and generation", () => {
  it.each([projectId, undefined])("replays a reviewed brief in the leased worker and rechecks formal evidence (initial project %s)", async initialProject => {
    const director = recipePorts("market-report");
    const periods = vi.spyOn(director, "periods");
    const compose = vi.spyOn(director, "compose");
    const invoke = vi.fn<ProposalModel["invoke"]>().mockResolvedValue({ provider: "deepseek", model: "fixture", message: { role: "assistant",
      content: JSON.stringify({ scenario: "market-report", style: "premium", priorities: ["market-trend"] }) }, inputTokens: 10, outputTokens: 10 });
    modelAuthorization.mockResolvedValueOnce({ cacheScope: { actorId: projectId, sessionId: taskId,
      configurationVersion: `review-fixture/${initialProject ?? "landing"}` }, invoke });
    const queue: (() => Promise<void>)[] = [];
    const stored = new Map<string, string>();
    const evidence = vi.fn();
    const lease = {
      lookup: async () => null,
      start: async (_ctx: PitchContext, input: ConfirmedProposal) => {
        stored.set(input.taskId, JSON.stringify(input));
        return { taskId: input.taskId, state: "queued" as const };
      },
      run: async (worker, _parent, task, prepare) => {
        const input = JSON.parse(stored.get(task)!);
        await prepare(worker, input, proposalGeneratedProjectId(worker, input), async () => undefined);
      },
      prepare: async (_ctx, input, reviewed, id) => {
        evidence(reviewed);
        return { action: "business_generate_commit", projectId: id, parentProjectId: input.projectId,
          expectedParentVersion: input.expectedVersion, reviewedPlanId: input.planId };
      },
      verifyCompletion: async () => undefined,
    } satisfies ProposalGenerationLease;
    const call = (payload: object, session = taskId) => handleAiRequest(new Request("https://pitch.test/api/intelligence/pitch/ai", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://pitch.test", "x-test-session": session },
      body: JSON.stringify(payload),
    }), { enabled: true } as PitchDependencies, work => queue.push(work), undefined, () => ({ director, lease }));
    const input = request("请按北京最新正式季度综合权衡市场走势，准备投资委员会决策材料");
    const reviewed = await (await call({ action: "proposal_plan", input: { ...input, projectId: initialProject } })).json();
    expect(reviewed).toMatchObject({ status: "ready", modelCalls: 1, interpretationReceipt: expect.any(String) });
    expect(reviewed).not.toHaveProperty("acceptedSlots");
    const confirmation = { projectId, taskId, expectedVersion: 1, request: input, planId: reviewed.plan.id,
      contextFingerprint: reviewed.plan.contextFingerprint, interpretationReceipt: reviewed.interpretationReceipt };
    const submit = (value = confirmation, session?: string) => call({ action: "proposal_generate", confirmation: value }, session);
    expect((await submit(confirmation, randomUUID())).status).toBe(409);
    expect((await submit({ ...confirmation, request: { ...input, audience: "client" } })).status).toBe(409);
    const [payload, signature] = confirmation.interpretationReceipt.split(".");
    const tampered = (signature.startsWith("A") ? "B" : "A") + signature.slice(1);
    expect((await submit({ ...confirmation, interpretationReceipt: `${payload}.${tampered}` })).status).toBe(409);
    const advanced = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    try {
      expect((await submit()).status).toBe(409);
    } finally {
      advanced.mockRestore();
    }
    expect(stored.size).toBe(0);

    modelAuthorization.mockImplementationOnce(async () => { throw new Error("unexpected planning in worker"); });
    expect((await submit()).status).toBe(200);
    await queue.shift()!();
    expect(evidence).toHaveBeenCalledWith(expect.objectContaining({ plan: reviewed.plan, modelCalls: 0, modelStatus: "reviewed" }));
    expect(periods).toHaveBeenCalledTimes(2);
    expect(compose.mock.calls.map(([input]) => input.requestedStyle)).toEqual(["premium", "premium"]);
    periods.mockResolvedValue([{ period: "2026-Q3", status: "formal" }]);
    expect((await submit({ ...confirmation, taskId: randomUUID() })).status).toBe(200);
    await expect(queue.shift()!()).rejects.toThrow("PITCH_PROPOSAL_REVIEW_REQUIRED");
    expect(evidence).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledOnce();
    modelAuthorization.mockReset();
  });

  it.each([
    ["为霄云路33号制作招商代理提案", "leasing-agency", "rent-position"],
    ["比较CBD五栋甲级写字楼", "office-comparison", "parameters"],
    ["制作北京最新正式季度写字楼市场报告", "market-report", "rent-trend"],
    ["为霄云路33号制作高端项目推介", "building-promotion", "parameters"],
    ["为某金融企业制作CBD五栋甲级写字楼的办公选址方案，优先通勤", "site-selection", "parameters"],
  ] as const)("reviews and confirms %s through the AI API before rendering a native verification slide", async (question, scenario, expectedPage) => {
    const director = recipePorts(scenario);
    const written: ReviewedProposal[] = [];
    const receipt = { state: "completed", taskId, projectId: "10000000-0000-4000-8000-000000000125" } as const;
    const workflow = {
      find: async () => written.length ? receipt : null,
      enqueue: vi.fn(async (_input: ConfirmedProposal, reviewed: ReviewedProposal) => { written.push(reviewed); return receipt; }),
    };
    const call = (payload: object) => handleAiRequest(new Request("https://pitch.test/api/intelligence/pitch/ai", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://pitch.test" }, body: JSON.stringify(payload),
    }), { enabled: true } as PitchDependencies, undefined, undefined, () => ({ director, workflow }));
    const input = request(question);
    const response = await call({ action: "proposal_plan", input });
    const review = await response.json();
    expect(response.status).toBe(200);
    expect(review).toMatchObject({ status: "ready", modelCalls: 0, brief: { scenario } });
    expect(review).not.toHaveProperty("pages");
    const command = { action: "proposal_generate", confirmation: {
      projectId, expectedVersion: 1, taskId, request: input, planId: review.plan.id, contextFingerprint: review.plan.contextFingerprint,
    } };
    const result = await call(command);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(receipt);
    expect(await (await call(command)).json()).toEqual(receipt);
    expect(workflow.enqueue).toHaveBeenCalledOnce();
    const saved = written[0];
    expect(saved.snapshot.isTestData).toBe(true);
    expect(saved.plan.slides).toEqual(review.plan.slides);
    const intent = saved.plan.slides.find(slide => slide.pageKind === expectedPage);
    expect(intent?.chart).toBeTruthy();
    expect(saved.plan.slides[0].precedes).toBe(saved.plan.slides[1].id);
    expect(saved.plan.slides[1].follows).toBe(saved.plan.slides[0].id);
    expect(saved.plan.slides.every(slide => slide.keyMessages.every(message => message.sourceIds.length > 0))).toBe(true);
    const chosen = saved.pages.find(page => page.id === intent?.id)!;
    const pages = (await layoutSlides(chosen.content, STUDIO_THEME, chosen.layoutId ?? "data-table"))
      .map(scene => ({ scene, theme: STUDIO_THEME }));
    const pptx = await renderPitchPptx(saved.plan.title, pages, []);
    const xml = await (await JSZip.loadAsync(pptx)).file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toMatch(/<a:tbl>|<c:chart\b/);
  }, 45_000);

  it("keeps a visual evidence gap visible while returning usable pages", async () => {
    expect(await directProposal(request("为霄云路33号制作项目推介"), ports(), newSignal())).toMatchObject({
      status: "ready", plan: { gaps: [{ pageKind: "photo", reason: "暂无图片" }] },
    });
  });

  it("uses the latest verified period and refuses to substitute for an explicitly requested incomplete quarter", async () => {
    expect(await directProposal(request("制作北京最新正式季度写字楼市场报告"), ports(), newSignal())).toMatchObject({
      status: "ready", snapshot: { brief: { period: "2026-Q2" } },
    });
    const sources = ports();
    const compose = vi.spyOn(sources, "compose");
    expect(await directProposal(request("制作北京2026Q3写字楼市场报告"), sources, newSignal())).toMatchObject({
      status: "clarification", code: "period-incomplete",
    });
    expect(compose).not.toHaveBeenCalled();
  });

  it("asks about missing and ambiguous buildings and leaves unauthorized data undisclosed", async () => {
    const sources = ports();
    sources.buildings = async () => [target, { ...target, id: competitors[0].id }];
    expect(await directProposal(request("为星光楼制作高端项目推介"), sources, newSignal())).toMatchObject({ status: "clarification", code: "missing-building" });
    expect(await directProposal(request("为霄云路33号制作高端项目推介"), sources, newSignal())).toMatchObject({ status: "clarification", code: "ambiguous-building" });
    sources.buildings = async () => { throw new Error("QUERY_DENIED"); };
    expect(await directProposal(request("为霄云路33号制作高端项目推介"), sources, newSignal())).toMatchObject({ status: "unavailable", code: "authorization-denied" });
    const client = proposalRequestSchema.parse({ question: "制作北京最新正式季度写字楼市场报告", audience: "client" });
    expect(await directProposal(client, ports(), newSignal())).toMatchObject({ status: "unavailable", code: "authorization-denied" });
  });

  it("stops work when a user cancels while sources are loading", async () => {
    const controller = new AbortController();
    const sources = ports();
    sources.buildings = async () => { controller.abort(); return [target]; };
    const compose = vi.spyOn(sources, "compose");
    await expect(directProposal(request("为霄云路33号制作高端项目推介"), sources, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(compose).not.toHaveBeenCalled();
  });

  it("revalidates reviewed facts before enqueue and returns the existing receipt when resuming", async () => {
    const original = request("制作北京最新正式季度写字楼市场报告");
    const sources = ports();
    const reviewed = await directProposal(original, sources, newSignal());
    if (reviewed.status !== "ready") throw new Error(reviewed.code);
    const submission = { projectId, expectedVersion: 2, taskId, planId: reviewed.plan.id, contextFingerprint: reviewed.plan.contextFingerprint, request: { ...original, projectId } };
    const received = { taskId, state: "queued" as const };
    const workflow = { find: vi.fn().mockResolvedValue(null), enqueue: vi.fn().mockResolvedValue(received) };
    expect(await submitConfirmedProposal(submission, sources, workflow, newSignal())).toEqual(received);
    expect(workflow.enqueue).toHaveBeenCalledTimes(1);
    const compose = sources.compose;
    sources.compose = async (...args) => {
      const output = await compose(...args);
      output.pages[0].content.blocks[0] = { kind: "metric", label: "更新", unit: "m²", value: 500, sourceIds: [output.pages[0].content.sources[0].id] };
      return output;
    };
    await expect(submitConfirmedProposal(submission, sources, workflow, newSignal())).rejects.toThrow("PITCH_PROPOSAL_REVIEW_REQUIRED");
    expect(workflow.enqueue).toHaveBeenCalledTimes(1);
    workflow.find.mockResolvedValue({ taskId, state: "running" });
    expect(await submitConfirmedProposal(submission, sources, workflow, newSignal())).toEqual({ taskId, state: "running" });
  });
});

describe("Proposal Director revision handoff", () => {
  it("pins each turn to current project/page versions and revalidates a quarter edit", async () => {
    const manualId = randomUUID();
    const reviewed = competitors[0].id;
    const refresh = { id: randomUUID(), version: 1, contextFingerprint: "a".repeat(64) };
    const compile = vi.fn<ProposalRevisionPort["compile"]>().mockResolvedValue({ id: randomUUID(), pages: [{ id: reviewed }, { id: manualId }], refresh });
    const port: ProposalRevisionPort = {
      read: async () => ({ version: 2, pages: [{ id: reviewed, version: 3, objectIds: ["text:1"], manual: false }, { id: manualId, version: 4, objectIds: [], manual: true }] }),
      compile,
    };
    const input = proposalRevisionRequestSchema.parse({ projectId, expectedVersion: 2, question: "整套提案更新至2026Q2" });
    expect(await previewProposalRevision(input, port, newSignal())).toMatchObject({
      status: "ready", plan: { expectedVersion: 2, refresh, basePageVersions: [{ id: reviewed, version: 3 }, { id: manualId, version: 4 }] },
    });
    expect(compile.mock.calls[0][0].target).toMatchObject({ verifyFacts: true, operations: [{ kind: "set-period", period: "2026-Q2" }] });
    await expect(previewProposalRevision({ ...input, expectedVersion: 1 }, port, newSignal())).rejects.toThrow("PITCH_CONFLICT");
    compile.mockResolvedValue({ id: randomUUID(), pages: [{ id: reviewed }] });
    expect(await previewProposalRevision(input, port, newSignal())).toMatchObject({ status: "unavailable", requiresVerification: true });
    compile.mockResolvedValue({ id: randomUUID(), pages: [{ id: reviewed }], refresh });
    await expect(previewProposalRevision(input, port, newSignal())).rejects.toThrow("PITCH_PROPOSAL_UNSAFE_EDIT");
  });
});
