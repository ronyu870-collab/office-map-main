import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pitchRpc, type PitchContext } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import { layoutFixture } from "../fixtures/layouts";
import { layoutSlides } from "../layout/engine";
import { workspaceCommandSchema } from "../workspace/protocol";
import type { ProposalCompetitorData, ReviewProposalHandoff } from "./proposal-competitor-revision";
import { proposalRevisionRequestSchema } from "./proposal-edit-intent";
import { planProposalRevision } from "./proposal-revision-runtime";

vi.mock("../data/store", async original => ({ ...await original<typeof import("../data/store")>(), pitchRpc: vi.fn() }));

const id = (suffix: number) => `d491688f-6f1c-4113-8bf1-${String(suffix).padStart(12, "0")}`;
const projectId = id(1), firstPage = id(2), earlierComparison = id(3);
const subject = { id: id(11), name: "自有办公楼", city: "北京", submarket: "CBD" };
const earlier = { id: id(12), name: "早前确认写字楼", city: "北京", submarket: "CBD" };
const rival = { id: id(13), name: "待加写字楼", city: "北京", submarket: "燕莎" };
const period = "2026-Q2", fingerprint = "e".repeat(64);
const content = layoutFixture("data-table");
let scene: Awaited<ReturnType<typeof layoutSlides>>[number];

const ctx = { identity: { actorId: id(15) }, signal: new AbortController().signal } as PitchContext;
const catalog = vi.fn<ProposalCompetitorData["buildings"]>();
const periods = vi.fn<ProposalCompetitorData["periods"]>();
const review = vi.fn<ReviewProposalHandoff>();
const services = { competitorData: { buildings: catalog, periods }, reviewHandoff: review };

beforeAll(async () => {
  [scene] = await layoutSlides(content, STUDIO_THEME, "data-table");
});
beforeEach(() => {
  catalog.mockReset().mockResolvedValue([subject, earlier, rival]);
  periods.mockReset().mockResolvedValue([{ period, status: "formal" }]);
  review.mockReset().mockImplementation(async (_ctx, { handoff }) => ({
    status: "ready", fingerprint, period: handoff.period, language: handoff.language, buildingIds: handoff.source.buildingIds,
    pages: [{ title: content.title, blocks: content.blocks, sources: content.sources }],
  }));
  vi.mocked(pitchRpc).mockReset().mockImplementation(async (_ctx, command) => {
    if (command.action === "catalog") return {};
    if (command.action !== "workspace_get") throw new Error("Unexpected write while reviewing");
    return {
      project: { id: projectId, title: "原来提案", version: 7, organization_id: "test", city: "北京", region: "华北",
        business_line: "office", theme_id: STUDIO_THEME.id, theme_version: STUDIO_THEME.version },
      slides: [earlierComparison, firstPage].map(pageId => ({ id: pageId, version: 7, scene, content,
        asset_id: id(20), asset_version: 1, template_id: "studio-content", template_version: 1 })),
      workspace: { context: { buildingIds: [subject.id], period }, active_slide: firstPage, page_settings: {
        [firstPage]: { manual: true, origin: "user" }, [earlierComparison]: { origin: "data", part: {
          mode: "handoff", parameters: { templateId: "project-comparison", period: { year: 2026, quarter: 2 }, buildingIds: [subject.id, earlier.id] },
        } },
      } },
      history: [], exports: [], tasks: [],
    };
  });
});

function request(question = "整套提案新增：加入「待加写字楼」作为竞品", competitorBuildingId?: string) {
  return proposalRevisionRequestSchema.parse({ projectId, expectedVersion: 7, currentPageId: firstPage, question, competitorBuildingId });
}

describe("competitor handoff preview", () => {
  it("reviews an append of the enlarged shortlist in the same formal period at the installed workspace boundary", async () => {
    const result = await planProposalRevision(ctx, request(), services);
    const buildingIds = [subject.id, earlier.id, rival.id];
    expect(review).toHaveBeenCalledWith(ctx, { action: "review_handoff", handoff: {
      source: { kind: "buildings", buildingIds }, projectId, period, language: "zh",
    } });
    expect(periods).toHaveBeenCalledWith({ buildingIds, city: "北京", submarkets: [], scenario: "office-comparison" }, ctx.signal);
    expect(vi.mocked(pitchRpc).mock.calls.map(([, command]) => command.action)).toEqual(["workspace_get", "catalog"]);
    const installed = workspaceCommandSchema.safeParse({ action: "add_to_pitch", handoff: {
      source: { kind: "buildings", buildingIds }, projectId, period, language: "zh",
    }, target: { mode: "append", expectedVersion: 7 }, fingerprint, taskId: id(30) }).success;
    if (!installed) {
      expect(result).toMatchObject({ status: "unavailable", code: "comparison-handoff-unavailable" });
      return;
    }
    expect(result).toMatchObject({ status: "ready", mode: "append-comparison", review: { buildingIds, competitor: rival },
      command: { action: "add_to_pitch", target: { mode: "append", expectedVersion: 7 }, fingerprint } });
    const reread = await planProposalRevision(ctx, request(), services);
    expect(reread).toEqual(result);
  });

  it("requires the caller to select one authorized building when the name matches multiple buildings", async () => {
    const twin = { ...rival, id: id(16), submarket: "CBD" };
    catalog.mockResolvedValue([subject, earlier, rival, twin]);
    expect(await planProposalRevision(ctx, request(), services)).toMatchObject({
      status: "clarification", code: "ambiguous-building", candidates: [rival, twin],
    });
    expect(review).not.toHaveBeenCalled();
    await planProposalRevision(ctx, request(undefined, twin.id), services);
    expect(review.mock.calls[0][1].handoff.source.buildingIds).toEqual([subject.id, earlier.id, twin.id]);
    expect(await planProposalRevision(ctx, request(undefined, id(99)), services)).toMatchObject({ status: "clarification", code: "missing-building" });
    expect(review).toHaveBeenCalledOnce();
  });

  it("does not query a draft quarter, missing property or duplicate", async () => {
    await expect(planProposalRevision(ctx, request("整套加入 并不存在的楼宇 为竞品"), services)).resolves.toMatchObject({
      status: "clarification", code: "missing-building",
    });
    await expect(planProposalRevision(ctx, request("整套加入「早前确认写字楼」为竞品"), services)).resolves.toMatchObject({
      status: "clarification", code: "competitor-already-included",
    });
    periods.mockResolvedValue([{ period, status: "incomplete" }]);
    await expect(planProposalRevision(ctx, request(), services)).resolves.toMatchObject({
      status: "unavailable", code: "comparison-period-unavailable",
    });
    expect(review).not.toHaveBeenCalled();
  });

  it("does not silently substitute an appended page for a requested change inside an existing page", async () => {
    await expect(planProposalRevision(ctx, request("在当前页加入「待加写字楼」为竞品"), services)).resolves.toMatchObject({
      status: "clarification", code: "comparison-append-scope",
    });
    expect(catalog).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it("refuses a handoff whose rechecked scope omits one of the matched properties", async () => {
    review.mockResolvedValue({ status: "ready", fingerprint, period, language: "zh", buildingIds: [subject.id, rival.id],
      pages: [{ title: content.title, blocks: content.blocks, sources: content.sources }] });
    await expect(planProposalRevision(ctx, request(), services)).rejects.toThrow("PITCH_PROPOSAL_REVIEW_REQUIRED");
  });
});
