import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { pitchCommandSchema } from "@/src/lib/pitch/contracts/api";
import { previewPage } from "@/src/lib/pitch/data/renderWorkflow";
import { pitchRpc, type PitchContext } from "@/src/lib/pitch/data/store";
import { STUDIO_THEME } from "@/src/lib/pitch/design/theme";
import { layoutFixture } from "@/src/lib/pitch/fixtures/layouts";
import { layoutSlides } from "@/src/lib/pitch/layout/engine";
import { LayoutError } from "@/src/lib/pitch/layout/metrics";
import { numberDeckPages } from "@/src/lib/pitch/layout/pagination";
import { STUDIO_TEMPLATE } from "@/src/lib/pitch/templates/registry";
import { saveSchema, workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { saveWorkspace } from "@/src/lib/pitch/workspace/workflow";
import { ProposalRevision } from "./ProposalRevision";
import { WorkspaceError, type Call } from "./client";

vi.mock("@/src/lib/pitch/data/store", async original => ({
  ...await original<typeof import("@/src/lib/pitch/data/store")>(), pitchRpc: vi.fn(),
}));
afterEach(cleanup);

const id = (number: number) => `7378c59e-cce2-40d6-afa8-${String(number).padStart(12, "0")}`;
const projectId = id(30);
const ctx = { signal: new AbortController().signal } as PitchContext;
const selected = [id(2), id(3)];

async function fixture(layout = "two-columns") {
  const source = layoutFixture(layout);
  const content = { ...source, blocks: source.blocks.filter(block => block.kind !== "image") };
  const [scene] = await layoutSlides(content, STUDIO_THEME, layout);
  return workspaceDetailSchema.parse({
    project: { id: projectId, version: 8, title: "选址提案", theme_id: STUDIO_THEME.id, theme_version: 2,
      organization_id: "test", region: "华北", city: "北京", business_line: "office" },
    slides: numberDeckPages([1, 2, 3, 4, 5, 6].map(number => ({
      id: id(number), asset_id: id(number + 10), asset_version: 1, template_id: "studio-content", template_version: 1,
      content, scene, theme: STUDIO_THEME,
    }))),
    workspace: { context: {}, page_settings: {}, active_slide: id(1) },
    history: [], tasks: [], exports: [],
  });
}

function setup(detail: WorkspaceDetail, question: string, identicalCoverVariant = false) {
  let stored = detail;
  vi.mocked(pitchRpc).mockImplementation(async (_ctx, input) => {
    if (input.action === "workspace_get") return stored;
    if (input.action === "preview_context") return { slides: stored.slides, themes: [{ definition: STUDIO_THEME }], media: [] };
    if (input.action === "registry") return { template: { config: STUDIO_TEMPLATE }, theme: { definition: STUDIO_THEME } };
    if (input.action === "workspace_save") {
      expect(input.expectedVersion).toBe(stored.project.version);
      const slides = input.slides as { id: string; content: WorkspaceDetail["slides"][number]["content"]; scene: WorkspaceDetail["slides"][number]["scene"] }[];
      stored = { ...stored, project: { ...stored.project, version: stored.project.version + 1 },
        slides: stored.slides.map((slide, index) => ({ ...slide, ...slides[index] })) };
      return stored;
    }
    throw new Error("Unexpected RPC " + input.action);
  });
  const call = vi.fn(async (input: Record<string, unknown>, _write?: boolean, path?: string, signal?: AbortSignal) => {
    const context = { ...ctx, signal: signal ?? ctx.signal };
    if (path === "") {
      const command = pitchCommandSchema.parse(input);
      if (command.action === "preview") {
        try {
          const result = await previewPage(context, command);
          if (!identicalCoverVariant || command.layoutId !== "cover") return result;
          return { ...result, scene: { ...result.scene, elements: stored.slides[command.page].scene.elements } };
        } catch (error) {
          if (error instanceof LayoutError) throw new WorkspaceError(error.message, 422);
          throw error;
        }
      }
    }
    if (path === "workspace") return saveWorkspace(context, saveSchema.parse(input));
    throw new Error("Unexpected request " + input.action);
  });
  const onApplied = vi.fn();
  render(<ProposalRevision call={call as unknown as Call} detail={detail} question={question} active={id(1)}
    selected={selected} objectIds={[]} disabled={false} onApplied={onApplied} onOpenData={vi.fn()} onAppend={vi.fn()} />);
  return { call, onApplied, user: userEvent.setup() };
}

it("previews the specified page range and saves those layouts through the real rendering and workspace handlers", async () => {
  const detail = await fixture();
  const { user, call, onApplied } = setup(detail, "重新设计第3至第5页");
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText("影响 3 页")).toBeInTheDocument();
  for (const number of [3, 4, 5]) {
    expect(screen.getByRole("img", { name: `第 ${number} 页新布局预览` }).getAttribute("src"))
      .toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  }
  expect(call.mock.calls.map(([input]) => input.page)).toEqual([2, 3, 4]);
  expect(onApplied).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "应用新布局" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
  const saved: WorkspaceDetail = onApplied.mock.calls[0][0];
  expect(saved.slides.map(({ scene }) => scene.variant)).toEqual(["standard", "standard", "alternate", "alternate", "alternate", "standard"]);
  expect(saved.slides.map(({ content }) => content)).toEqual(detail.slides.map(({ content }) => content));
  expect(call.mock.calls.at(-1)?.[0]).toMatchObject({ action: "save", expectedVersion: detail.project.version,
    pages: detail.slides.map((slide, index) => index >= 2 && index <= 4
      ? { id: slide.id, layoutId: "two-columns", variant: "alternate" } : { id: slide.id }),
  });
});

it("previews only the current page for a direct change-design request", async () => {
  const { user, call } = setup(await fixture(), "这页太丑，换一种设计。");
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByRole("img", { name: "第 1 页新布局预览" })).toBeInTheDocument();
  expect(call.mock.calls.map(([input]) => input.page)).toEqual([0]);
});

it("continues to a compatible layout when a cover variation renders identical geometry", async () => {
  const { user, call } = setup(await fixture("cover"), "换一种设计", true);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByRole("img", { name: "第 1 页新布局预览" })).toBeInTheDocument();
  expect(call.mock.calls.map(([input]) => input.layoutId)).toEqual(["cover", "image-text", "two-columns"]);
});

it("keeps grouped or positioned objects intact and withholds a partial change for the selected range", async () => {
  const detail = await fixture();
  detail.slides[3].scene.elements[0].editorId = "object-18";
  const { user, call } = setup(detail, "重新设计第3至第5页");
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByRole("status")).toHaveTextContent("第 4 页");
  expect(screen.queryByRole("button", { name: "应用新布局" })).not.toBeInTheDocument();
  expect(call).not.toHaveBeenCalled();
});
