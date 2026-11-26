import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { QueryResultView } from "@/src/lib/intelligence/query/presentation";
import { FIELD_REGISTRY_VERSION } from "@/src/lib/intelligence/query/registry";
import { slideSceneSchema } from "../contracts/scene";
import type { PitchContext } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import { renderPitchPptx } from "../render/pptx";
import { confirmedProposalSchema, proposalRequestSchema } from "./proposal-brief";
import { generateConfirmedProposal } from "./proposal-generation-runtime";
import { prepareProposal } from "./proposal-runtime";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), data: vi.fn(), archived: vi.fn(), recheck: vi.fn() }));
vi.mock("../data/store", async original => ({ ...await original<typeof import("../data/store")>(), pitchRpc: mocks.rpc }));
vi.mock("../business/adapter", async original => ({ ...await original<typeof import("../business/adapter")>(), runPitchDataAdapter: mocks.data }));
vi.mock("@/src/lib/intelligence/query/http", () => ({ queryHttpDependencies: () => ({ enabled: true, keys: {} }) }));
vi.mock("@/src/lib/intelligence/query/recovery", () => ({ readOwnResult: vi.fn(), recoverOwnResult: mocks.archived }));
vi.mock("@/src/lib/intelligence/query/serverAuthority", () => ({
  loadDataAuthority: async () => ({ grants: ["export:internal"], permissionRevision: "authorization/1", policyVersion: "policy/1" }),
}));
vi.mock("./proposal-model", () => ({ authorizedProposalModel: async () => undefined }));

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const projectId = id(1), analysisId = id(2), taskId = id(3), buildingId = id(4), actorId = id(5);
const scope = { organizationId: "test", region: "华北", city: "北京", businessLine: "office" };
const quarter = { year: 2026, quarter: 2 };
const asOf = "2026-06-30";
const request = proposalRequestSchema.parse({ projectId, analysisResultId: analysisId, question: "根据已有分析结果生成客户汇报PPT" });

function archived(): QueryResultView {
  return {
    resultId: id(6), createdAt: "2026-07-02T00:00:00Z", snapshotId: "recorded", dataVersion: "fixture",
    scopeFingerprint: "same-authorized-scope", registryVersion: FIELD_REGISTRY_VERSION, operation: "list", analysis: null, limitations: [],
    parameters: { executedPlan: { operation: "list", scope: { inventory: "all_authorized", buildingIds: [buildingId] }, period: quarter, fields: ["height"] } },
    sources: [{ id: id(7), table: "buildings", recordId: buildingId, entityId: buildingId, field: "height", recordVersion: "3", rawValue: "120",
      unit: "m", period: quarter, recordedAt: null, businessAsOf: asOf, verification: "database_only", original: null }],
    table: { id: "buildings", columns: [{ key: "height", label: "楼宇高度", unit: "m" }],
      rows: [{ entityId: buildingId, cells: { height: {
        kind: "number", sourceIds: [id(7)], value: { exact: { numerator: "120", denominator: "1" }, numeric: 120 },
      } } }] },
  };
}

function replay(result = archived()) {
  return { results: [{ ...result, resultId: id(8), snapshotId: "rechecked" }], dataAsOf: asOf,
    binding: { domain: "quarter", permissionRevision: "authorization/1", policyVersion: "policy/1" },
    content: [{ protocol: "colliers-pitch/1", locale: "zh", disclosure: "internal", isTestData: false,
      title: "已确认楼书参数", dataAsOf: asOf,
      sources: [{ kind: "record", id: id(9), label: "源证据", locator: "当前获权查询", recordId: id(8), version: "data/1", dataAsOf: asOf }],
      blocks: [{ kind: "table", columns: ["楼宇高度 (米)"], rows: [["120"]], sourceIds: [id(9)] }] }],
  };
}

const parent = { id: projectId, version: 4, title: "项目", theme_id: STUDIO_THEME.id, theme_version: STUDIO_THEME.version,
  organization_id: scope.organizationId, region: scope.region, city: scope.city, business_line: scope.businessLine };
let committed: { projectId: string; slides: {
  slideId: string; assetId: string; assetVersion: number; content: unknown; scene: unknown;
}[] } | undefined;

beforeEach(() => {
  committed = undefined;
  mocks.data.mockReset().mockImplementation(async () => replay());
  mocks.recheck.mockReset().mockResolvedValue(undefined);
  mocks.archived.mockReset().mockImplementation(async () => ({ result: archived(), recheck: mocks.recheck }));
  mocks.rpc.mockReset().mockImplementation(async (_ctx, command) => {
    const workspace = { workspace: { context: {}, page_settings: {}, active_slide: null }, history: [], tasks: [], exports: [] };
    if (command.action === "catalog") return { scopes: [{ ...scope, canGenerate: true, canClientExport: false, canExternalAi: false }] };
    if (command.action === "workspace_capabilities") return { allowedDynamic: ["building-profile"] };
    if (command.action === "registry") return { theme: { definition: STUDIO_THEME } };
    if (command.action === "business_generation") return {};
    if (command.action === "business_generate_commit") { committed = command; return {}; }
    if (command.action === "workspace_get") {
      if (command.projectId === projectId) return { ...workspace, project: parent, slides: [] };
      if (committed && command.projectId === committed.projectId) return { ...workspace,
        project: { ...parent, id: committed.projectId, parent_project_id: projectId },
        slides: committed.slides.map(page => ({ id: page.slideId, version: 1, asset_id: page.assetId, asset_version: page.assetVersion,
          template_id: "business-content", template_version: 1, content: page.content, scene: page.scene })) };
      throw new Error("PITCH_DENIED");
    }
    throw new Error(`Unexpected operation ${command.action}`);
  });
});

function actor(signal = new AbortController().signal) {
  return { signal, identity: { actorId } } as PitchContext;
}

async function confirm(ctx: PitchContext) {
  const review = await prepareProposal(ctx, request);
  if (review.status !== "ready") throw new Error(review.code);
  expect(review.generationAvailable).toBe(true);
  return confirmedProposalSchema.parse({ request, projectId, taskId, expectedVersion: parent.version,
    planId: review.plan.id, contextFingerprint: review.plan.contextFingerprint });
}

describe("reviewed archive transfer to existing proposal generation", () => {
  it("generates and recovers the reviewed content through the actual standard workflow", async () => {
    const ctx = actor();
    const input = await confirm(ctx);
    const receipt = await generateConfirmedProposal(ctx, input);
    expect(receipt).toMatchObject({ state: "completed", taskId, projectId: committed?.projectId });
    expect(committed?.slides[0]).toMatchObject({ content: { blocks: [{ kind: "table", rows: [["120"]] }] },
      scene: { elements: expect.arrayContaining([expect.objectContaining({ kind: "table" })]) } });
    expect(mocks.data).toHaveBeenCalledWith(expect.objectContaining({ signal: ctx.signal }), expect.objectContaining({
      templateId: "building-profile", period: quarter, buildingIds: [buildingId], fields: ["height"], inventory: "all_authorized",
    }), "zh");
    const pptx = await renderPitchPptx("归档汇报", [{ scene: slideSceneSchema.parse(committed?.slides[0].scene), theme: STUDIO_THEME }], []);
    const slide = await (await JSZip.loadAsync(pptx)).file("ppt/slides/slide1.xml")!.async("string");
    expect(slide).toContain("<a:tbl>");
    expect(slide).toContain(">120</a:t>");
    expect(mocks.data).toHaveBeenCalledTimes(3);
    expect(mocks.recheck).toHaveBeenCalledTimes(3);
    await expect(generateConfirmedProposal(ctx, input)).resolves.toEqual(receipt);
    expect(mocks.data).toHaveBeenCalledTimes(3);
    expect(mocks.rpc.mock.calls.filter(([, command]) => command.action === "business_generate_commit")).toHaveLength(1);
  });

  it("preserves the archived review when source provenance differs with identical displayed numbers", async () => {
    const differentSource = archived();
    differentSource.sources[0].recordVersion = "changed";
    mocks.data.mockResolvedValue(replay(differentSource));
    const review = await prepareProposal(actor(), request);
    expect(review).toMatchObject({ status: "ready", generationAvailable: false, plan: { gaps: [expect.objectContaining({ pageKind: "generation" })] } });
    expect(committed).toBeUndefined();
  });

  it("forces re-review if the source changes between confirmation and the final trusted read", async () => {
    const ctx = actor();
    const input = await confirm(ctx);
    const differentSource = archived();
    differentSource.sources[0].recordVersion = "changed";
    mocks.data.mockResolvedValueOnce(replay()).mockResolvedValueOnce(replay(differentSource));
    await expect(generateConfirmedProposal(ctx, input)).rejects.toThrow("PITCH_PROPOSAL_REVIEW_REQUIRED");
    expect(committed).toBeUndefined();
  });

  it("stops before persisting when current archive access is withdrawn", async () => {
    const ctx = actor();
    const input = await confirm(ctx);
    mocks.recheck.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("QUERY_DENIED"));
    await expect(generateConfirmedProposal(ctx, input)).rejects.toThrow("QUERY_DENIED");
    expect(committed).toBeUndefined();
  });

  it("stops an aborted confirmation before any persistence", async () => {
    const controller = new AbortController();
    const ctx = actor(controller.signal);
    const input = await confirm(ctx);
    mocks.data.mockResolvedValueOnce(replay()).mockImplementationOnce(async () => {
      controller.abort(new Error("fixture cancelled"));
      return replay();
    });
    await expect(generateConfirmedProposal(ctx, input)).rejects.toThrow("fixture cancelled");
    expect(committed).toBeUndefined();
  });
});
