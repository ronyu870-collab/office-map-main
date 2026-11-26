import { beforeAll, expect, it, vi } from "vitest";
import type { SlideContent } from "../contracts/content";
import type { PitchContext } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import { layoutFixture } from "../fixtures/layouts";
import { layoutSlides } from "../layout/engine";
import { STUDIO_TEMPLATE } from "../templates/registry";
import { objectId } from "../workspace/object-layout";
import { pageEditSchema, workspaceCommandSchema } from "../workspace/protocol";
import { compileProposalChartEdits } from "./proposal-chart-revision";
import { proposalRevisionRequestSchema } from "./proposal-edit-intent";
import { planProposalRevision } from "./proposal-revision-runtime";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../data/store", async original => ({ ...await original<typeof import("../data/store")>(), pitchRpc: rpc }));

const id = (value: number) => `f38ff87e-6e15-4e4d-bd53-${String(value).padStart(12, "0")}`;
const first = id(1), second = id(2), projectId = id(3);
const fixture = layoutFixture("chart-insight");
const baseChart = fixture.blocks.find(block => block.kind === "chart")!;
const content: SlideContent = { ...fixture,
  blocks: [{ ...baseChart, chartType: "column" }, { ...baseChart, series: baseChart.series.map(item => ({ ...item, name: "另一组数据" })) }],
};

let scene: Awaited<ReturnType<typeof layoutSlides>>[number];
beforeAll(async () => {
  [scene] = await layoutSlides(content, STUDIO_THEME, "chart-stack");
});
const page = () => ({ id: first, content, scene });

it("binds the chosen scene object to its exact source block on a two-chart page", () => {
  const objectIds = scene.elements.map((element, index) => element.kind === "chart" ? objectId(element, index) : "").filter(Boolean);
  const target = { kind: "objects" as const, pageId: first, objectIds: [objectIds[0]] };
  const edits = compileProposalChartEdits(target, { kind: "set-chart", chart: "bar" }, [page()]);
  expect(edits?.[0].changes).toEqual([{ blockIndex: 0, from: "column", type: "bar" }]);
  expect(edits?.[0].slide.content).toBe(content);
});

it("requires an explicit all-charts selection when multiple source charts are possible", () => {
  const target = { kind: "pages" as const, pageIds: [first] };
  expect(compileProposalChartEdits(target, { kind: "set-chart", chart: "bar" }, [page()])).toBeNull();
  expect(compileProposalChartEdits(target, { kind: "set-chart", chart: "bar", all: true }, [page()])?.[0].changes)
    .toEqual([{ blockIndex: 0, from: "column", type: "bar" }, { blockIndex: 1, from: "line", type: "bar" }]);
});

it("keeps existing manual object positions and paginated charts intact", () => {
  const target = { kind: "pages" as const, pageIds: [first] };
  const operation = { kind: "set-chart" as const, chart: "line" as const, from: "column" as const };
  const edited = { ...scene, elements: scene.elements.map((element, index) => ({ ...element, editorId: objectId(element, index) })) };
  expect(compileProposalChartEdits(target, operation, [{ ...page(), scene: edited }])).toBeNull();
  expect(compileProposalChartEdits(target, operation, [{ ...page(), scene: { ...scene, pagination: { index: 0, count: 2 } } }])).toBeNull();
});

it("returns a versioned workspace transaction only when that installed workspace accepts it", async () => {
  const stored = {
    project: { id: projectId, version: 6, title: "市场汇报", theme_id: STUDIO_THEME.id, theme_version: STUDIO_THEME.version,
      organization_id: "test", region: "华北", city: "北京", business_line: "office" },
    slides: [first, second].map((pageId, index) => ({
      id: pageId, version: index + 2, asset_id: id(5), asset_version: 1, template_id: "fixture", template_version: 1, content, scene,
    })),
    workspace: { context: {}, page_settings: { [first]: { origin: "data" }, [second]: { origin: "data" } }, active_slide: first },
    history: [], exports: [], tasks: [],
  };
  let saved: { slides: { id: string; content: SlideContent }[] } | undefined;
  rpc.mockReset().mockImplementation(async (_ctx, command) => {
    if (command.action === "workspace_get") return stored;
    if (command.action === "catalog") return {};
    if (command.action === "registry") return { template: { config: STUDIO_TEMPLATE }, theme: { definition: STUDIO_THEME } };
    if (command.action === "preview_context") return { media: [] };
    if (command.action === "workspace_save") { saved = command; return {}; }
    throw new Error(`Unexpected write: ${command.action}`);
  });
  const request = proposalRevisionRequestSchema.parse({ projectId, expectedVersion: 6, currentPageId: first,
    question: "将柱状图改为折线图" });
  const ctx = { signal: new AbortController().signal } as PitchContext;
  const result = await planProposalRevision(ctx, request);
  if (!("chartPresentation" in pageEditSchema.shape)) {
    expect(result).toMatchObject({ status: "unavailable", operations: [{ kind: "set-chart", from: "column", chart: "line" }] });
    expect(rpc.mock.calls.map(([, command]) => command.action)).toEqual(["workspace_get", "catalog"]);
    return;
  }
  expect(result).toMatchObject({ status: "ready", scope: "selected",
    chartPreview: [{ pageId: first, blockIndex: 0, from: "column", type: "line" }],
    command: { action: "apply_modification", plan: { expectedVersion: 6,
      basePageVersions: [{ id: first, version: 2 }, { id: second, version: 3 }],
      pages: [{ id: first, chartPresentation: [{ blockIndex: 0, type: "line" }] }, { id: second }] } } });
  expect(result.status === "ready" && workspaceCommandSchema.safeParse(result.command).success).toBe(true);
  expect(rpc.mock.calls.map(([, command]) => command.action)).toEqual(["workspace_get", "catalog", "registry"]);
  const workspace = await import("../workspace/workflow");
  if (result.status !== "ready" || !("applyDocumentModification" in workspace) || typeof workspace.applyDocumentModification !== "function") {
    throw new Error("Missing chart transaction");
  }
  const apply = workspace.applyDocumentModification as (context: PitchContext, command: unknown) => Promise<unknown>;
  stored.project.version += 1;
  await expect(apply(ctx, result.command)).rejects.toThrow("PITCH_CONFLICT");
  expect(saved).toBeUndefined();
  stored.project.version -= 1;
  await apply(ctx, result.command);
  expect(saved?.slides.find(slide => slide.id === first)?.content).toEqual({
    ...content, blocks: [{ ...content.blocks[0], chartType: "line" }, content.blocks[1]],
  });
  expect(saved?.slides.find(slide => slide.id === second)?.content).toEqual(content);
});
