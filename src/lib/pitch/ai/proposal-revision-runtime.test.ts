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

beforeAll(async () => {
  [scene] = await layoutSlides(content, STUDIO_THEME, "two-columns");
}, 45_000);

beforeEach(() => {
  firstPageOrigin = "data";
  separateSnapshot = false;
  comparisons = false;
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
      slides: [firstPage, secondPage].map(id => ({
        id, version: 2, asset_id: separateSnapshot && id === secondPage ? separateAsset : sourceId, asset_version: 1,
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
