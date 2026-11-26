import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pitchRpc, type PitchContext } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import { layoutSlides } from "../layout/engine";
import type { SlideContent } from "../contracts/content";
import { proposalRevisionRequestSchema } from "./proposal-edit-intent";
import { planProposalRevision, type PreviewProposalQuarter } from "./proposal-revision-runtime";

vi.mock("../data/store", async importOriginal => {
  const actual = await importOriginal<typeof import("../data/store")>();
  return { ...actual, pitchRpc: vi.fn() };
});

const projectId = "10000000-0000-4000-8000-000000000010";
const firstPage = "10000000-0000-4000-8000-000000000011";
const secondPage = "10000000-0000-4000-8000-000000000012";
const sourceId = "10000000-0000-4000-8000-000000000013";
const context = { signal: new AbortController().signal } as PitchContext;
const latestFingerprint = "f".repeat(64);
const content: SlideContent = {
  protocol: "colliers-pitch/1", title: "2026Q2 市场", locale: "zh", disclosure: "internal",
  isTestData: true, dataAsOf: "2026-06-30",
  blocks: [{ kind: "paragraph", text: "覆盖 12 栋楼宇。", sourceIds: [sourceId] }],
  sources: [{ kind: "synthetic", id: sourceId, label: "测试来源", locator: "test", version: "1", dataAsOf: "2026-06-30" }],
};
let scene: Awaited<ReturnType<typeof layoutSlides>>[number];
let firstPageOrigin: "data" | "asset";

beforeAll(async () => {
  [scene] = await layoutSlides(content, STUDIO_THEME, "two-columns");
}, 45_000);

beforeEach(() => {
  firstPageOrigin = "data";
  vi.mocked(pitchRpc).mockReset().mockImplementation(async (_ctx, command) => {
    if (command.action === "catalog") return {};
    if (command.action !== "workspace_get") throw new Error("Unexpected write or query");
    return {
      project: {
        id: projectId, version: 4, title: "北京写字楼季度市场报告", theme_id: STUDIO_THEME.id,
        theme_version: STUDIO_THEME.version, organization_id: "test", region: "华北", city: "北京", business_line: "office",
      },
      slides: [firstPage, secondPage].map(id => ({
        id, version: 2, asset_id: sourceId, asset_version: 1,
        template_id: "fixture", template_version: 1, content, scene,
      })),
      workspace: {
        context: { business: "市场报告" },
        page_settings: { [firstPage]: { origin: firstPageOrigin }, [secondPage]: { origin: "data" } },
        active_slide: firstPage,
      },
      history: [], tasks: [], exports: [],
    };
  });
});

function request(question: string, pageIds: string[] = []) {
  return proposalRevisionRequestSchema.parse({ projectId, expectedVersion: 4, currentPageId: firstPage, question, pageIds });
}

describe("proposal revision transaction previews", () => {
  it("carries the exact literal, target and page versions into a document modification", async () => {
    const title = await planProposalRevision(context, request("把标题改成《2026Q2 北京。并调整图表》"));
    expect(title).toMatchObject({
      status: "ready",
      command: {
        action: "apply_modification", scope: "selected",
        plan: { expectedVersion: 4, basePageVersions: [{ id: firstPage, version: 2 }, { id: secondPage, version: 2 }],
          pages: [{ id: firstPage, title: "2026Q2 北京。并调整图表" }, { id: secondPage }] },
      },
    });
    const paragraphRequest = request("把正文改成「样本覆盖 12 栋楼宇。」");
    expect(await planProposalRevision(context, paragraphRequest)).toMatchObject({ status: "unavailable" });
    firstPageOrigin = "asset";
    const paragraph = await planProposalRevision(context, paragraphRequest);
    expect(paragraph).toMatchObject({ status: "ready", plan: { pages: [{ id: firstPage, paragraphs: ["样本覆盖 12 栋楼宇。"] }, { id: secondPage }] } });
    expect(await planProposalRevision(context, request("把正文改成「样本覆盖 20 栋楼宇。」"))).toMatchObject({ status: "unavailable" });
  });

  it("binds the existing refresh review and returns its fingerprint as the apply command", async () => {
    const review: PreviewProposalQuarter = vi.fn(async () => ({
      projectVersion: 4, period: { year: 2026, quarter: 1 }, fingerprint: latestFingerprint,
      changed: true, needsConclusionReview: true, changes: [{ slideId: firstPage }, { slideId: secondPage }],
    }));
    const result = await planProposalRevision(context, request("更新到2026Q1", [firstPage, secondPage]), review);
    expect(review).toHaveBeenCalledWith(context, {
      action: "preview_data_refresh", projectId, slideId: firstPage, expectedVersion: 4, period: { year: 2026, quarter: 1 },
    });
    expect(result).toMatchObject({
      status: "ready", review: { needsConclusionReview: true },
      command: { action: "apply_data_refresh", projectId, slideId: firstPage, expectedVersion: 4,
        period: { year: 2026, quarter: 1 }, fingerprint: latestFingerprint },
    });
    expect(await planProposalRevision(context, request("更新到2026Q1"), review)).toMatchObject({ status: "unavailable" });
    expect(vi.mocked(pitchRpc).mock.calls.map(call => call[1].action)).toEqual(["workspace_get", "catalog", "workspace_get", "catalog"]);
  });
});
