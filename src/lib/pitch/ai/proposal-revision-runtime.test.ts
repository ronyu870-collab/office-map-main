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
const separateAsset = "10000000-0000-4000-8000-000000000014";
const buildingId = "10000000-0000-4000-8000-000000000015";
const permissionRevision = "b".repeat(64);
const quarterRpc = vi.fn();
const identity = { actorId: projectId, effectiveUserId: projectId, sessionId: sourceId, expiresAt: Date.now() + 600_000 };
const context = { signal: new AbortController().signal, identity, client: { rpc: quarterRpc } } as unknown as PitchContext;
const latestFingerprint = "f".repeat(64);
const content: SlideContent = {
  protocol: "colliers-pitch/1", title: "2026Q2 市场", locale: "zh", disclosure: "internal",
  isTestData: true, dataAsOf: "2026-06-30",
  blocks: [{ kind: "paragraph", text: "覆盖 12 栋楼宇。", sourceIds: [sourceId] }],
  sources: [{ kind: "synthetic", id: sourceId, label: "测试来源", locator: "test", version: "1", dataAsOf: "2026-06-30" }],
};
let scene: Awaited<ReturnType<typeof layoutSlides>>[number];
let firstPageOrigin: "data" | "asset";
let separateSnapshot: boolean;
let comparisons: boolean;
let availableQuarters: { year: number; quarter: number }[];
let revisionDeck: { id: string; content: SlideContent; manual?: true }[] | undefined;

beforeAll(async () => {
  [scene] = await layoutSlides(content, STUDIO_THEME, "two-columns");
}, 45_000);

beforeEach(() => {
  firstPageOrigin = "data";
  separateSnapshot = false;
  comparisons = false;
  revisionDeck = undefined;
  availableQuarters = [{ year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
  quarterRpc.mockReset().mockImplementation((action, args) => {
    if (action === "ai_query_authority") return { abortSignal: async () => ({ error: null, data: {
      allowed: true, access_policy: "admin-only/1", actor_id: identity.actorId, effective_user_id: identity.effectiveUserId,
      session_id: identity.sessionId, policy_version: "query/1", permission_revision: permissionRevision,
      capabilities: ["query:catalog", "query:quarter", "export:internal"], fields: ["netEffectiveRent"],
      all_submarkets: true, submarkets: [], all_buildings: true, building_ids: [],
    } }) };
    if (action === "ai_query_available_periods") return { abortSignal: async () => ({ error: null, data: {
      version: "authorized-periods/1", permission_revision: permissionRevision, read_at: "2026-11-27T01:00:00Z", inventory_time: "current_catalog",
      fields: args.p_fields, truncated: false, periods: availableQuarters,
    } }) };
    throw new Error("Unexpected metadata lookup");
  });
  vi.mocked(pitchRpc).mockReset().mockImplementation(async (_ctx, command) => {
    if (command.action === "catalog") return {};
    if (command.action === "workspace_document_bindings") {
      const period = { year: 2026, quarter: 2 };
      return (separateSnapshot ? [sourceId, separateAsset] : [sourceId]).map((assetId, index) => ({
        asset_id: assetId, asset_version: 1, generation_id: projectId, snapshot_index: index,
        binding: { domain: "quarter", permissionRevision, policyVersion: "query/1" },
        has_research: false, compares_quarters: comparisons, parameters: {
          templateId: "project-comparison", buildingIds: [buildingId], submarkets: ["CBD"], inventory: "all_authorized",
          period, start: period, end: period, fields: ["netEffectiveRent"], direction: "asc", chart: "table",
          from: "2026-01-01", to: "2026-12-31", leaseSource: "combined", measure: "count",
        },
      }));
    }
    if (command.action !== "workspace_get") throw new Error("Unexpected write or query");
    return {
      project: {
        id: projectId, version: 4, title: "北京写字楼季度市场报告", theme_id: STUDIO_THEME.id,
        theme_version: STUDIO_THEME.version, organization_id: "test", region: "华北", city: "北京", business_line: "office",
      },
      slides: (revisionDeck ?? [firstPage, secondPage].map(id => ({ id, content }))).map(({ id, content: slide }) => ({
        id, version: 2, asset_id: separateSnapshot && id === secondPage ? separateAsset : sourceId, asset_version: 1,
        template_id: "fixture", template_version: 1, content: slide, scene,
      })),
      workspace: {
        context: { business: "市场报告" },
        page_settings: { [firstPage]: { origin: firstPageOrigin }, [secondPage]: { origin: "data" },
          ...Object.fromEntries((revisionDeck ?? []).filter(page => page.manual).map(page => [page.id, { manual: true }])) },
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
  it("shortens a whole deck while retaining manual work, evidence pages, and every cited source", async () => {
    const id = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const page = (index: number, title: string, patch: Partial<SlideContent> = {}) => ({
      id: id(index), content: { ...content, title, ...patch },
    });
    revisionDeck = [
      page(21, "封面"),
      page(22, "资料口径", { sources: [{ ...content.sources[0], id: separateAsset }],
        blocks: [{ kind: "paragraph", text: "资料口径", sourceIds: [separateAsset] }] }),
      page(23, "可精简的章节导语"),
      { ...page(24, "手动编辑页"), manual: true },
      page(25, "对比指标", { blocks: [{ kind: "metric", label: "样本数", value: 12, unit: "栋", sourceIds: [sourceId] }] }),
      page(26, "可精简的过渡页"),
      page(27, "结语"),
    ];
    await expect(planProposalRevision(context, request("精简整套提案"))).resolves.toMatchObject({
      status: "ready", shorteningPreview: { originalPageCount: 7, pageCount: 6, removed: [{ pageId: id(26), title: "可精简的过渡页" }] },
    });
    await expect(planProposalRevision(context, request("整套压缩到5页"))).resolves.toMatchObject({
      status: "ready", shorteningPreview: { pageCount: 5, removed: [{ pageId: id(23) }, { pageId: id(26) }] },
      command: { action: "apply_modification", scope: "document", plan: {
        pages: [21, 22, 24, 25, 27].map(index => ({ id: id(index) })),
        basePageVersions: revisionDeck.map(page => ({ id: page.id, version: 2 })),
      } },
    });
    await expect(planProposalRevision(context, request("整套压缩到4页"))).resolves.toMatchObject({ status: "unavailable" });
    expect(vi.mocked(pitchRpc).mock.calls.every(([, command]) => command.action === "workspace_get" || command.action === "catalog")).toBe(true);
  });

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
    expect(vi.mocked(pitchRpc).mock.calls.map(call => call[1].action)).toEqual([
      "workspace_get", "catalog", "workspace_document_bindings", "workspace_get", "catalog", "workspace_document_bindings",
    ]);
  });

  it("pins the latest compatible formal quarter from the saved comparison and preserves its before-after preview", async () => {
    const review = vi.fn<PreviewProposalQuarter>(async (_ctx, command) => ({
      projectVersion: 4, period: command.period, fingerprint: latestFingerprint, changed: true, needsConclusionReview: false,
      changes: [{ slideId: firstPage }, { slideId: secondPage }],
    }));
    const result = await planProposalRevision(context, request("整套更新到最新正式季度"), { previewQuarter: review });
    expect(quarterRpc).toHaveBeenCalledWith("ai_query_available_periods", expect.objectContaining({
      p_building_ids: [buildingId], p_submarkets: ["CBD"], p_inventory: "all_authorized", p_fields: ["netEffectiveRent"],
    }));
    expect(result).toMatchObject({ status: "ready", scope: "document",
      command: { action: "apply_data_refresh", period: { year: 2026, quarter: 3 }, fingerprint: latestFingerprint } });
    await expect(planProposalRevision(context, request("整套更新到2026Q4"), review)).resolves.toMatchObject({ status: "unavailable" });
    expect(review).toHaveBeenCalledOnce();
  });

  it("requires one atomic snapshot and an available historical baseline for quarter comparisons", async () => {
    const review = vi.fn<PreviewProposalQuarter>(async (_ctx, command) => ({
      projectVersion: 4, period: command.period, fingerprint: latestFingerprint, changed: true, needsConclusionReview: false,
      changes: [{ slideId: firstPage }, { slideId: secondPage }],
    }));
    separateSnapshot = true;
    await expect(planProposalRevision(context, request("整套更新到最新正式季度"), review)).resolves.toMatchObject({ status: "unavailable" });
    expect(quarterRpc).not.toHaveBeenCalled();
    separateSnapshot = false;
    comparisons = true;
    availableQuarters.unshift({ year: 2025, quarter: 2 });
    await expect(planProposalRevision(context, request("整套更新到最新正式季度"), review)).resolves.toMatchObject({
      status: "ready", command: { period: { year: 2026, quarter: 2 } },
    });
    expect(review).toHaveBeenCalledOnce();
  });
});
