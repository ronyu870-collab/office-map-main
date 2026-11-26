import { describe, expect, it, vi } from "vitest";
import type { PitchContext } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import type { VisualAssetReference } from "../integration-contracts";
import { id, period } from "../proposals/__tests__/fixture";
import type { UnifiedProposalContext } from "../proposals/unified-projection";
import { confirmedProposalSchema, proposalRequestSchema } from "./proposal-brief";
import { directProposal, type ProposalDirectorPorts } from "./proposal-director";
import { createUnifiedProposalComposer, type UnifiedProposalReaders } from "./proposal-unified-runtime";
import { submitConfirmedProposal } from "./proposal-workflow";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../data/store", async original => ({ ...await original<typeof import("../data/store")>(), pitchRpc: rpc }));

const scope = { organizationId: "test", region: "华北", city: "北京", businessLine: "office" };
const buildings = [
  { id: id(1), name: "霄云路33号", city: "北京", submarket: "燕莎" },
  { id: id(2), name: "隔离验证的竞品", city: "北京", submarket: "燕莎" },
];
const date = "2026-06-30";
const source = (number: number) => ({ id: id(number), kind: "record" as const, label: "隔离接口样本", locator: "test", version: "test/1", dataAsOf: date });
const ref = (number: number, kind: VisualAssetReference["kind"], buildingIds = [buildings[0].id]): VisualAssetReference =>
  ({ id: id(number), kind, buildingIds, source: source(number), version: 1, versionHash: "a".repeat(64), disclosure: "internal" });
const signedContext = () => {
  const field = (value: string | number, unit: string | null = null) => ({ value, unit, state: "valid", permission: "authorized", disclosure: "internal" });
  return {
    protocol: "unified-pitch-context/1", request: { city: "北京", submarkets: [] },
    period, disclosure: "internal", isTestData: false, capturedAt: "2026-07-01T00:00:00Z", fingerprint: "structural-test",
    bindings: [], results: [], buildings: buildings.map(({ id, name, submarket }) => ({ buildingId: id, name,
      static: { name: field(name), submarket: field(submarket), address: field("隔离样本地址"), standardFloorArea: field(1500, "m2") },
      quarter: {} })),
  } satisfies UnifiedProposalContext;
};

function fixture() {
  const signal = new AbortController().signal;
  const ctx = { signal } as PitchContext;
  const context = signedContext();
  const readers = {
    load: vi.fn<UnifiedProposalReaders["load"]>().mockResolvedValue(context),
    options: vi.fn<UnifiedProposalReaders["options"]>().mockResolvedValue({ theme: STUDIO_THEME }),
    photos: vi.fn<UnifiedProposalReaders["photos"]>().mockResolvedValue([{ buildingId: buildings[0].id,
      primary: { ...ref(100, "photo"), category: "exterior" },
      alternatives: [{ ...ref(101, "photo"), category: "lobby" }, { ...ref(102, "photo", [buildings[1].id]), category: "lobby" },
        { ...ref(103, "photo"), category: "rendering" }] }]),
    location: vi.fn<UnifiedProposalReaders["location"]>().mockImplementation(async (_ctx, selection) =>
      ({ reference: ref(110, "map", "buildingIds" in selection ? selection.buildingIds : undefined) })),
    stacking: vi.fn<NonNullable<UnifiedProposalReaders["stacking"]>>().mockResolvedValue({
      reference: { ...ref(111, "stacking-plan"), disclosure: "restricted" }, businessDate: date,
    }),
  } satisfies UnifiedProposalReaders;
  const director: ProposalDirectorPorts = {
    scope: async () => ({ scope }),
    periods: async () => [{ period: "2026-Q2", status: "formal" }],
    buildings: async () => buildings,
    compose: createUnifiedProposalComposer(ctx, readers, vi.fn().mockRejectedValue(new Error("unexpected fallback"))),
  };
  return { director, readers, signal };
}

function promotion() {
  return proposalRequestSchema.parse({ projectId: id(20), question: "为霄云路33号制作高端项目推介" });
}

describe("authorized proposal recipe sources", () => {
  it("hands only pinned, correctly scoped assets into confirmed workflow pages", async () => {
    const { director, readers, signal } = fixture();
    const request = promotion();
    const reviewed = await directProposal(request, director, signal);
    if (reviewed.status !== "ready") throw new Error(reviewed.code);
    expect(reviewed.modelCalls).toBe(0);
    expect(reviewed.plan.theme).toEqual({ id: STUDIO_THEME.id, version: STUDIO_THEME.version });
    expect(reviewed.snapshot.visuals.map(visual => visual.id).sort()).toEqual([id(100), id(101), id(110)]);
    expect(readers.photos).toHaveBeenCalledWith(expect.objectContaining({ signal }), { buildingIds: [buildings[0].id], use: "profile" });
    expect(readers.location).toHaveBeenCalledOnce();
    const receipt = { taskId: id(21), projectId: id(22), state: "completed" } as const;
    const input = confirmedProposalSchema.parse({ taskId: receipt.taskId, projectId: request.projectId, expectedVersion: 1,
      contextFingerprint: reviewed.plan.contextFingerprint, planId: reviewed.plan.id, request });
    const workflow = { find: vi.fn().mockResolvedValue(null), enqueue: vi.fn().mockResolvedValue(receipt) };
    await expect(submitConfirmedProposal(input, director, workflow, signal)).resolves.toEqual(receipt);
    expect(workflow.enqueue.mock.calls[0][1].pages).toEqual(reviewed.pages);
    readers.photos.mockResolvedValue([]);
    await expect(submitConfirmedProposal(input, director, workflow, signal)).rejects.toThrow("PITCH_PROPOSAL_REVIEW_REQUIRED");
    expect(workflow.enqueue).toHaveBeenCalledOnce();
    workflow.find.mockResolvedValue(receipt);
    await expect(submitConfirmedProposal(input, director, workflow, signal)).resolves.toEqual(receipt);
    expect(readers.load).toHaveBeenCalledTimes(3);
  });

  it("skips all asset reads for a stale quarter or a revoked building", async () => {
    const { director, readers, signal } = fixture();
    readers.load.mockResolvedValueOnce({ ...signedContext(), period: { year: 2026, quarter: 1 } });
    await expect(directProposal(promotion(), director, signal)).resolves.toMatchObject({ status: "unavailable", code: "period-unavailable" });
    const context = signedContext();
    context.buildings[0].static.name.permission = "denied";
    readers.load.mockResolvedValueOnce(context);
    await expect(directProposal(promotion(), director, signal)).resolves.toMatchObject({ status: "clarification", code: "missing-building" });
    expect(readers.photos).not.toHaveBeenCalled();
    expect(readers.location).not.toHaveBeenCalled();
  });

  it("leaves the photo gap visible and reports authorization loss during a visual read", async () => {
    const { director, readers, signal } = fixture();
    readers.photos.mockRejectedValueOnce(new Error("PITCH_PHOTO_CATALOG_UNAVAILABLE"));
    const reviewed = await directProposal(promotion(), director, signal);
    if (reviewed.status !== "ready") throw new Error(reviewed.code);
    expect(reviewed.plan.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ pageKind: "spaces" })]));
    expect(reviewed.snapshot.visuals.map(asset => asset.kind)).toEqual(["map"]);
    readers.photos.mockRejectedValueOnce(new Error("QUERY_DENIED"));
    await expect(directProposal(promotion(), director, signal)).resolves.toMatchObject({ status: "unavailable", code: "authorization-denied" });
  });

  it("pins an explicitly approved team version while keeping the other recipes free of library filler", async () => {
    const { director, signal } = fixture();
    const assetId = id(30);
    const text = { zh: "样本团队资料" };
    rpc.mockResolvedValue({
      asset: { id: assetId, organization_id: scope.organizationId, region: scope.region, city: scope.city,
        business_line: scope.businessLine, state: "published" },
      version: { version: 4, state: "published", content: { protocol: "colliers-pitch/1", locale: "zh", title: text.zh,
        dataAsOf: date, disclosure: "internal", isTestData: false, sources: [source(31)],
        blocks: [{ kind: "paragraph", text: text.zh, sourceIds: [id(31)] }] } },
      profile: { kind: "team", employeeAccountId: null, name: text, position: text, team: text.zh, expertise: [], experience: text,
        qualifications: [], representativeProjects: [], projectRole: text, reportsToAssetId: null, caseAssetIds: [], photo: null },
    });
    const input = proposalRequestSchema.parse({ question: "为霄云路33号制作招商代理提案", assetIds: [assetId] });
    const reviewed = await directProposal(input, director, signal);
    if (reviewed.status !== "ready") throw new Error(reviewed.code);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ signal }), { action: "business_generation_asset", assetId });
    expect(reviewed.plan.slides.find(slide => slide.pageKind === "team")?.materialReferences).toEqual([{ id: assetId, version: 4 }]);
    rpc.mockClear();
    await directProposal({ ...promotion(), assetIds: [assetId] }, director, signal);
    expect(rpc).not.toHaveBeenCalled();
  });
});
