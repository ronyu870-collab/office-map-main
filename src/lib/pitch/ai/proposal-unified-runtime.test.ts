import { describe, expect, it, vi } from "vitest";
import type { PitchContext } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import type { VisualAssetReference } from "../integration-contracts";
import { id, period } from "../proposals/__tests__/fixture";
import type { UnifiedProposalContext } from "../proposals/unified-projection";
import { pinVisual } from "../visual-data/reference";
import { confirmedProposalSchema, proposalRequestSchema } from "./proposal-brief";
import { directProposal, type ProposalDirectorPorts } from "./proposal-director";
import { prepareProposal } from "./proposal-runtime";
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

function contextWithDossier(resultId: string, dataVersion = "brochure/1"): UnifiedProposalContext {
  const context = signedContext();
  const dossier: UnifiedProposalContext["results"][number] = {
    id: "building-dossier", entityId: buildings[0].id, binding: { domain: "business", dataVersion, disclosure: "internal" },
    result: { resultId, dataVersion: "request-specific/1", snapshotId: resultId,
      createdAt: context.capturedAt, scopeFingerprint: "authorized-portfolio", registryVersion: "fixture",
      operation: "list", parameters: {}, analysis: null, sources: [], limitations: [],
      table: { id: "dossier-fixture", columns: [], rows: [] } },
  };
  return { ...context, results: [dossier, { ...dossier, id: "uncited-result", result: { ...dossier.result, resultId: id(59) } }] };
}

describe("authorized proposal recipe sources", () => {
  it('admits a matching historical appendix only for internal agency proposals', async () => {
    const { director, readers, signal } = fixture();
    const reference = pinVisual({ id: id(93), kind: 'stacking-plan', buildingIds: [buildings[0].id], disclosure: 'restricted',
      origin: { type: 'stacking-snapshot', buildingId: buildings[0].id, selection: {} }, contentHash: 'b'.repeat(64),
      dimensions: { width: 1200, height: 800 }, businessDate: date, sourceDateBasis: 'source-data-as-of',
      rights: { scope: 'admin-internal', holder: null, attribution: '隔离来源', licenseName: null, sourceUrl: null, licenseUrl: null,
        cropAllowed: false, clientDistribution: false, externalAi: false },
      source: { kind: 'record', label: '隔离历史来源', locator: '历史核验', dataAsOf: date },
    }, 'isolated');
    const historicalAppendix = vi.fn<NonNullable<UnifiedProposalReaders['historicalAppendix']>>().mockResolvedValue({
      reference, layoutId: 'hero-caption', scenes: [], content: { protocol: 'colliers-pitch/1', title: '隔离历史楼层分布', locale: 'zh',
        dataAsOf: date, disclosure: 'restricted', isTestData: true, sources: [reference.source], blocks: [
          { kind: 'image', mediaAssetId: reference.id, mediaVersion: reference.version, alt: '历史资料', sourceIds: [reference.source.id] },
          { kind: 'paragraph', text: '历史快照', sourceIds: [reference.source.id] },
        ] },
    });
    const question = proposalRequestSchema.parse({ question: '制作霄云路33号招商代理提案', buildingIds: [buildings[0].id] });
    const ports = { ...director, compose: createUnifiedProposalComposer({ signal } as PitchContext, { ...readers, historicalAppendix }, director.compose) };
    const ready = await directProposal(question, ports, signal);
    expect(ready).toMatchObject({ status: 'ready', plan: { slides: expect.arrayContaining([
      expect.objectContaining({ pageKind: 'historical-stacking-appendix', visuals: [reference] }),
    ]) } });
    expect(await directProposal({ ...question, audience: 'client' }, ports, signal)).toMatchObject({ status: 'unavailable', code: 'authorization-denied' });
    historicalAppendix.mockRejectedValueOnce(new Error('QUERY_DENIED'));
    const limited = await directProposal(question, ports, signal);
    expect(limited).toMatchObject({ status: 'ready' });
    expect(limited.status === 'ready' && limited.plan.slides.map(page => page.pageKind)).not.toContain('historical-stacking-appendix');
  });
  it("uses the requested analysis focus to retain the right page under a tight length while preserving the cover and closing", async () => {
    const { director, signal } = fixture();
    const question = proposalRequestSchema.parse({ question: "为霄云路33号制作高端项目推介，控制在3页" });
    const defaultPlan = await directProposal(question, director, signal);
    const focused = await directProposal({ ...question, question: question.question + "，优先核对通勤" }, director, signal);
    if (defaultPlan.status !== "ready" || focused.status !== "ready") throw new Error("Missing property plan");
    expect(defaultPlan.plan.slides.map(slide => slide.pageKind)).toEqual(["cover", "profile", "next-steps"]);
    expect(focused.plan.analysisPriorities).toEqual(["commute"]);
    expect(focused.plan.slides.map(slide => slide.pageKind)).toEqual(["cover", "arrival", "next-steps"]);
    expect(focused.plan.slides[1].visuals).toEqual([expect.objectContaining({ kind: "map", buildingIds: [buildings[0].id] })]);
    expect(focused.modelCalls).toBe(0);
  });

  it("keeps the financial client's stated conditions distinct from verified property facts and from unknown conditions", async () => {
    const { director, signal } = fixture();
    const question = proposalRequestSchema.parse({
      question: "为某金融企业制作燕莎两栋候选楼宇的选址方案，重点核对通勤，办公面积至少3000平方米，月租预算不超过15万元",
    });
    const plan = await directProposal(question, director, signal);
    if (plan.status !== "ready") throw new Error(plan.code);
    expect(plan.snapshot.brief).toMatchObject({ scenario: "site-selection", targetClient: "某金融企业" });
    expect([...plan.snapshot.brief.buildingIds].sort()).toEqual(buildings.map(building => building.id));
    expect(plan.plan.slides[0]).toMatchObject({ pageKind: "cover", title: "某金融企业 · 写字楼选址方案" });
    const requirementId = plan.plan.slides.find(slide => slide.pageKind === "requirements")?.id;
    const page = plan.pages.find(item => item.id === requirementId)?.content;
    expect(page?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "用户输入 · 办公面积至少3000平方米" }),
      expect.objectContaining({ text: "用户输入 · 月租预算不超过15万元" }),
      expect.objectContaining({ text: "待客户确认 · 通勤起点、目标入驻时间、交付条件" }),
    ]));
    expect(page?.sources).toEqual([expect.objectContaining({ label: "本次选址需求输入" })]);
    expect(plan.plan.slides.find(slide => slide.pageKind === "requirements")?.data).toEqual([]);
    const afterCreate = await directProposal({ ...question, projectId: id(20) }, director, signal);
    expect(afterCreate).toMatchObject({ status: "ready", plan: { id: plan.plan.id } });
  });

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

  it("confirms unchanged source versions across new query receipts while keeping original evidence references", async () => {
    const { director, readers, signal } = fixture();
    const question = promotion();
    const receipt = { taskId: id(21), projectId: id(22), state: "completed" } as const;
    readers.load.mockResolvedValueOnce(contextWithDossier(id(40))).mockResolvedValueOnce(contextWithDossier(id(41)))
      .mockResolvedValueOnce(contextWithDossier(id(42), "brochure/2"));
    const preview = await directProposal(question, director, signal);
    if (preview.status !== "ready") throw new Error(preview.code);
    expect(preview.plan.slides.find(slide => slide.pageKind === "profile")?.keyMessages[0].sourceIds).toEqual([id(40)]);
    const confirmation = confirmedProposalSchema.parse({ request: question, projectId: question.projectId, taskId: receipt.taskId,
      expectedVersion: 1, planId: preview.plan.id, contextFingerprint: preview.plan.contextFingerprint });
    const workflow = { find: vi.fn().mockResolvedValue(null), enqueue: vi.fn().mockResolvedValue(receipt) };
    await expect(submitConfirmedProposal(confirmation, director, workflow, signal)).resolves.toEqual(receipt);
    const accepted = workflow.enqueue.mock.calls[0][1];
    const profileId = preview.plan.slides.find(slide => slide.pageKind === "profile")?.id;
    expect(accepted.pages.find((page: { id: string }) => page.id === profileId)?.content.sources)
      .toEqual([expect.objectContaining({ id: id(41), recordId: id(41), locator: `building-dossier · ${id(41)}` })]);
    expect(accepted.queryReceipts).toEqual([expect.objectContaining({
      id: "building-dossier", result: expect.objectContaining({ resultId: id(41) }),
    })]);
    await expect(submitConfirmedProposal(confirmation, director, workflow, signal)).rejects.toThrow("PITCH_PROPOSAL_REVIEW_REQUIRED");
    expect(workflow.enqueue).toHaveBeenCalledOnce();
  });

  it("keeps the raw query receipts out of the client plan", async () => {
    const { director, readers, signal } = fixture();
    readers.load.mockResolvedValueOnce(contextWithDossier(id(40)));
    const result = await prepareProposal({ signal } as PitchContext, promotion(), undefined, director);
    expect(result.status).toBe("ready");
    expect(result).not.toHaveProperty("queryReceipts");
    expect(result).not.toHaveProperty("pages");
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
