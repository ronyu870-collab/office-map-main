import { beforeEach, expect, it, vi } from "vitest";
import { slideContentSchema } from "../contracts/content";
import type { PitchContext, PitchDependencies } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import { layoutSlides } from "../layout/engine";
import { STUDIO_TEMPLATE } from "../templates/registry";
import { handleAiRequest } from "./http";
import type { CanvasServices } from "./proposal-canvas-services";
import { knownTranslation, localizeProposalContent } from "./proposal-language-content";

const fixture = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), readReview: vi.fn() }));
vi.mock("../data/store", async original => ({ ...await original<typeof import("../data/store")>(),
  authorizePitch: fixture.actor, pitchRpc: fixture.rpc }));
vi.mock("./workflow", async original => ({ ...await original<typeof import("./workflow")>(), getReviewedCanvasText: fixture.readReview }));

const id = (value: number) => `ae64af2f-2df5-4837-8830-${String(value).padStart(12, "0")}`;
const projectId = id(1), slideId = id(2), assetId = id(3), sourceId = id(4);
const scope = { organizationId: "isolated", region: "华北", city: "北京", businessLine: "office" };
const ctx = { signal: new AbortController().signal } as PitchContext;
const deps = { enabled: true } as PitchDependencies;
const manualText = "手工确认：季度租金为 120 元。";
const translation = "Manually reviewed: quarterly rent is 120 yuan.";
const titleref = "object-92";

async function setup() {
  const source = { id: sourceId, kind: "record", label: "事实资料", recordId: "isolated-receipt", locator: "正式季度",
    version: "1", dataAsOf: "2026-09-30" };
  const content = slideContentSchema.parse({ protocol: "colliers-pitch/1", locale: "zh", title: "净有效租金",
    disclosure: "internal", dataAsOf: "2026-09-30", isTestData: false, sources: [source],
    blocks: [{ kind: "paragraph", text: manualText, sourceIds: [sourceId] }] });
  const [scene] = await layoutSlides(content, STUDIO_THEME, "two-columns");
  scene.elements = scene.elements.map(element => element.kind === "text" && element.role === "title"
    ? { ...element, editorId: titleref, x: element.x + .03 } : element);
  const page = { id: slideId, version: 5, asset_id: assetId, asset_version: 3,
    template_id: "studio-content", template_version: 1, content, scene };
  const workspace = { project: { id: projectId, title: "市场汇报", version: 8, theme_id: STUDIO_THEME.id,
    theme_version: STUDIO_THEME.version, organization_id: scope.organizationId, region: scope.region, city: scope.city,
    business_line: scope.businessLine }, slides: [page], workspace: { context: { language: "zh" },
    page_settings: { [slideId]: { manual: true } }, active_slide: slideId }, history: [], exports: [], tasks: [] };
  fixture.rpc.mockImplementation(async (_ctx, call) => {
    if (call.action === "registry") return { theme: { definition: STUDIO_THEME }, template: { config: STUDIO_TEMPLATE } };
    if (call.action === "catalog") return {};
    if (call.action === "ai_result") return {};
    if (call.action === "workspace_get") return workspace;
    throw new Error("Unexpected call");
  });
  const language = {
    verifyPage: vi.fn<CanvasServices["verifyPage"]>(async () => undefined),
    persist: vi.fn<CanvasServices["persist"]>(async (_ctx, current, slides, locale) => ({ ...current, slides,
      workspace: { ...current.workspace, context: { ...current.workspace.context, language: locale ?? current.workspace.context.language } },
    })),
  } satisfies CanvasServices;
  const call = (payload: object) => handleAiRequest(new Request("https://pitch.test/api/intelligence/pitch/ai", {
    method: "POST", headers: { "Content-Type": "application/json", origin: "https://pitch.test" }, body: JSON.stringify(payload),
  }), deps, undefined, { language });
  const input = { projectId, expectedVersion: 8, question: "整套切换成英文", currentPageId: slideId };
  const review = async (values?: object) => (await call({ action: "proposal_revision", input: { ...input, ...values } })).json();
  return { review, call, input, language, page, workspace };
}

beforeEach(() => {
  fixture.actor.mockReset().mockResolvedValue(ctx);
  fixture.rpc.mockReset();
  fixture.readReview.mockReset();
});

it("requests only text still needing a translation, then updates the same versioned canvas", async () => {
  const { review, call, language, page } = await setup();
  expect(await review()).toMatchObject({ status: "language-translation-required", language: "en",
    pending: [{ pageId: slideId, pageVersion: 5, text: manualText, ref: "block:0" }],
    translated: [{ changes: [{ ref: "title", before: "净有效租金", after: "Net Effective Rent" }] }],
  });
  expect(language.persist).not.toHaveBeenCalled();
  const preview = await review({ languageTexts: [{ pageId: slideId, ref: "block:0", text: translation }] });
  expect(preview, JSON.stringify(preview)).toMatchObject({ status: "language-review", projectVersion: 8 });
  const result = await call(preview.command);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ status: "language-applied", workspace: { workspace: { context: { language: "en" } } } });
  const [, , [saved], requestedLocale] = language.persist.mock.calls[0];
  expect(requestedLocale).toBe("en");
  expect(saved.content.blocks[0]).toMatchObject({ text: translation, sourceIds: [sourceId] });
  expect(saved.content.sources).toEqual(page.content.sources);
  expect(saved.scene.elements.find(element => element.editorId === titleref))
    .toMatchObject({ x: page.scene.elements.find(element => element.editorId === titleref)?.x, text: "Net Effective Rent" });
});

it("reuses an authorized existing translation only for matching source text and rechecks it when confirmed", async () => {
  const { review, call, language } = await setup();
  const receipt = { pageId: slideId, taskId: id(7), fingerprint: "c".repeat(64) };
  const draft = { assetId, assetVersion: 3, scope, content: { locale: "en" },
    changes: [{ id: "block:0", before: manualText, after: translation }] };
  fixture.readReview.mockResolvedValue({ ...draft, changes: [{ ...draft.changes[0], before: "过期旧稿 120 元" }] });
  expect(await review({ languageReceipts: [receipt] })).toMatchObject({ status: "language-translation-required" });
  fixture.readReview.mockResolvedValue(draft);
  const preview = await review({ languageReceipts: [receipt] });
  expect(preview, JSON.stringify(preview)).toMatchObject({ status: "language-review" });
  expect(fixture.rpc).toHaveBeenCalledWith(ctx, { action: "ai_result", taskId: receipt.taskId });
  fixture.readReview.mockResolvedValue({ ...draft, assetVersion: 4 });
  expect((await call(preview.command)).status).toBe(409);
  expect(language.persist).not.toHaveBeenCalled();
});

it("rejects changed numeric values, unselected references and stale confirmations", async () => {
  const { review, call, input, workspace, language } = await setup();
  const request = (entry: { pageId: string; ref: string; text: string }) =>
    call({ action: "proposal_revision", input: { ...input, languageTexts: [entry] } });
  expect((await request({ pageId: slideId, ref: "block:0", text: "Quarterly rent is 130 yuan." })).status).toBe(422);
  expect((await request({ pageId: id(9), ref: "block:0", text: translation })).status).toBe(422);
  const preview = await review({ languageTexts: [{ pageId: slideId, ref: "block:0", text: translation }] });
  expect(preview, JSON.stringify(preview)).toMatchObject({ status: "language-review" });
  workspace.project.version++;
  expect((await call(preview.command)).status).toBe(409);
  expect(language.persist).not.toHaveBeenCalled();
});

it("localizes native chart and table labels without changing their values, units or sources", async () => {
  const { page } = await setup();
  const table = { kind: "table" as const, columns: ["空置率"], rows: [[12], [null]], sourceIds: [sourceId] };
  const chart = { kind: "chart" as const, chartType: "column" as const, categories: ["CBD", "2026-Q3"],
    series: [{ name: "净有效租金", values: [120, null], unit: "CNY/m²/month" }], sourceIds: [sourceId] };
  const result = localizeProposalContent({ ...page.content, blocks: [table, chart] }, "en",
    (_ref, before) => knownTranslation(before, "en") ?? before);
  expect(result.blocks).toEqual([
    { ...table, columns: ["Vacancy Rate"] },
    { ...chart, series: [{ ...chart.series[0], name: "Net Effective Rent" }] },
  ]);
  expect(result.sources).toEqual(page.content.sources);
});
