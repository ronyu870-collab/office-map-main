import * as React from "react";
import { applyObjectMoves, applyObjectTexts, objectId, type ObjectMove, type ObjectText } from "@/src/lib/pitch/workspace/object-layout";
import { slideContentSchema } from "@/src/lib/pitch/contracts/content";
import { slideSceneSchema, type SlideScene } from "@/src/lib/pitch/contracts/scene";
import { BUSINESS_RECIPES } from "@/src/lib/pitch/business/recipes";
import { Manager } from "./workspace/Manager";
import type { Catalog, Call } from "./workspace/client";
import type { AuthSessionResult } from "@/src/services/Auth";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  id: "11111111-1111-4111-8111-111111111111",
  role: "editor",
  other: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/src/components/SessionProvider", () => ({
  useAppSession: () => ({
    status: "authenticated",
    session: {
      user: { id: state.id },
      session: { user: { id: state.id }, access_token: "synthetic-token" },
      role: state.role,
    },
  }),
}));
vi.mock("@/src/services/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: state.other ? "changed" : state.id },
            access_token: "synthetic-token",
          },
        },
      }),
    },
  },
}));
vi.mock("@/src/components/layout", () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
import { PitchWorkspace } from "./PitchWorkspace";
const projectId = "22222222-2222-4222-8222-222222222222",
  pageId = "33333333-3333-4333-8333-333333333333",
  assetId = "44444444-4444-4444-8444-444444444444",
  sourceId = "55555555-5555-4555-8555-555555555555";
const catalog = {
  scopes: [
    {
      organizationId: "test",
      region: "test",
      city: "test",
      businessLine: "test",
      canGenerate: true,
      canMaintain: false,
      canAdmin: false,
      canClientExport: false,
    },
  ],
  categories: [],
  themes: [{ id: "colliers-default-v1", current_version: 2 }],
};
const content = {
  protocol: "colliers-pitch/1",
  locale: "zh",
  title: "隔离页面",
  blocks: [{ kind: "paragraph", text: "原始正文", sourceIds: [sourceId] }],
  sources: [
    {
      id: sourceId,
      kind: "record",
      label: "隔离测试来源",
      recordId: "test",
      locator: "1",
      version: "1",
      dataAsOf: "2026-01-01",
    },
  ],
  dataAsOf: "2026-01-01",
  disclosure: "internal",
  isTestData: true,
};
const scene: SlideScene = {
  protocol: "colliers-pitch/1",
  rendererVersion: "pitch-scene/2",
  width: 13.333333,
  height: 7.5,
  layoutId: "two-columns",
  layoutVersion: 2,
  themeId: "colliers-default-v1",
  themeVersion: 2,
  elements: [
    {
      kind: "text",
      x: 1,
      y: 1,
      w: 10,
      h: 1,
      text: "隔离页面",
      role: "title",
      bold: true,
    },
  ],
};
const initial = () => ({
  project: {
    id: projectId,
    title: "隔离测试 Pitch",
    version: 1,
    theme_id: "colliers-default-v1",
    theme_version: 2,
    organization_id: "test",
    region: "test",
    city: "test",
    business_line: "test",
  },
  workspace: {
    context: {
      language: "zh",
      buildingIds: [],
      client: "",
      business: "",
      period: "",
      notes: "",
    },
    page_settings: {},
    active_slide: pageId,
  },
  slides: [
    {
      id: pageId,
      asset_id: assetId,
      asset_version: 1,
      template_id: "studio-content",
      template_version: 1,
      content,
      scene,
    },
  ],
  history: [],
  tasks: [],
  exports: [],
});
let detail: ReturnType<typeof initial>,
  writes: Record<string, unknown>[],
  revisions: Map<number, ReturnType<typeof initial>>,
  failTaskPoll = false,
  failCompletedRead = false,
  completedTask = false,
  rejectSave = false,
  expandedCatalog = false;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
beforeEach(() => {
  state.role = "editor";
  state.other = false;
  rejectSave = false;
  expandedCatalog = false;
  failTaskPoll = false;
  failCompletedRead = false;
  completedTask = false;
  detail = clone(initial());
  writes = [];
  revisions = new Map();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, "http://localhost"),
        c =
          init?.method === "POST"
            ? JSON.parse(String(init.body))
            : Object.fromEntries(u.searchParams),
        path = u.pathname.split("/").pop();
      let body: unknown = {};
      let status = 200;
      if (init?.method === "POST") writes.push(c);
      if (c.action === "catalog")
        body = path === "business" ? { recipes: expandedCatalog ? BUSINESS_RECIPES.map(r => ({...r, revision: 1, categoryId: sourceId, enabled: true})) : [], dynamic: [] } : catalog;
      else if (c.action === "capabilities")
        body = { allowedDynamic: [], buildingSearch: false };
      else if (c.action === "preferences") body = { favorites: [], recent: [] };
      else if (c.action === "list")
        body = {
          items: [
            {
              ...detail.project,
              page_count: detail.slides.length,
              updated_at: "2026-11-26T01:00:00Z",
              deleted_at: null,
            },
          ],
          next: null,
        };
      else if (c.action === "get") {
        if (failCompletedRead && writes.some((c) => c.action === "status"))
          throw new Error("新页面暂时读取失败");
        body = detail;
      } else if (c.action === "create") {
        body = {...detail, project: {...detail.project, id: c.projectId, title: c.title, theme_id: c.themeId, theme_version: c.themeVersion}, workspace: {...detail.workspace, context: c.context, active_slide: null}, slides: [], tasks: []};
      } else if (c.action === "status") {
        if (failTaskPoll) throw new Error("生成进度网络中断");
        body = {
          id: c.taskId,
          state: completedTask ? "completed" : "failed",
          attempts: 1,
          error_code: "PITCH_WORKER_TIMEOUT",
        };
      } else if (c.action === "preview")
        body = {
          svg: c.editorSlideId
            ?  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720"/>${detail.slides[0].scene.elements.map((element, index) => `<g data-pitch-object="${objectId(element, index)}"/>`).join("")}</svg>`
            : '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><text>实际测试场景</text></svg>',
          scene: slideSceneSchema.parse(detail.slides[0].scene),
        };
      else if (c.action === "restore_page") {
        const old = revisions.get(c.revision)?.slides.find(slide => slide.id === c.slideId);
        if (!old || c.expectedVersion !== detail.project.version) {
          status = 409;
          body = { error: "版本已变化" };
        } else {
          revisions.set(detail.project.version, clone(detail));
          detail = { ...detail, project: { ...detail.project, version: detail.project.version + 1 },
            slides: detail.slides.map(slide => slide.id === c.slideId ? clone(old) : slide) };
          body = detail;
        }
      }
      else if (c.action === "save") {
        if (rejectSave) {
          status = 409;
          body = { error: "其他窗口已更新，编辑保留。" };
        } else {
          revisions.set(detail.project.version, clone(detail));
          detail = {
            ...detail,
            project: {
              ...detail.project,
              title: c.title,
              version: detail.project.version + 1,
            },
            workspace: {
              ...detail.workspace,
              context: c.context,
              active_slide: c.activeSlide,
            },
            slides: c.pages.map(
              (p: {
                id: string;
                duplicateOf?: string;
                title?: string;
                paragraphs?: string[];
                objectMoves?: ObjectMove[];
                objectTexts?: ObjectText[];
              }) => {
                const original = detail.slides.find(
                  (s) => s.id === (p.duplicateOf ?? p.id),
                )!;
                const patchedText = p.objectTexts && applyObjectTexts(slideSceneSchema.parse(original.scene), slideContentSchema.parse(original.content), p.objectTexts);
                const patchedScene = patchedText ? patchedText.scene : slideSceneSchema.parse(original.scene);
                return {
                  ...original,
                  id: p.id,
                  scene: (p.objectMoves ? applyObjectMoves(patchedScene, p.objectMoves) : patchedScene),
                  content: {
                    ...original.content,
                    title: p.title ?? (patchedText ? patchedText.content.title : original.content.title),
                    blocks: p.paragraphs
                      ? original.content.blocks.map((b, i) => ({
                          ...b,
                          text: p.paragraphs![i],
                        }))
                      : original.content.blocks,
                  },
                };
              },
            ),
          };
          body = detail;
        }
      } else body = { items: [], next: null };
      return { ok: status < 400, status, json: async () => clone(body) };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function enter() {
  const user = userEvent.setup();
  render(<PitchWorkspace />);
  await screen.findByRole("button", { name: "我的 Pitch" });
  await user.click(screen.getByRole("button", { name: "我的 Pitch" }));
  await user.click(
    await screen.findByRole("button", { name: /隔离测试 Pitch/ }),
  );
  await screen.findByLabelText("页面标题");
  return user;
}
describe("Pitch workspace continuous editing", () => {
  it("takes a workbench brief to the real project assistant only after project creation", async () => {
    const user = userEvent.setup();
    render(<PitchWorkspace />);
    const brief = await screen.findByLabelText("你想制作什么？");
    await user.type(brief, "为科技企业制作选址提案");
    await user.click(screen.getByRole("button", { name: "进入提案助手" }));
    expect(writes.some((entry) => entry.action === "create" || entry.action === "prepare")).toBe(false);
    await user.type(screen.getByLabelText("Pitch 名称"), "选址项目");
    await user.click(screen.getByRole("button", { name: /^创建$/ }));
    const question = await screen.findByLabelText("需要制作什么页面？");
    expect(question).toHaveValue("为科技企业制作选址提案");
    expect(writes.filter((entry) => entry.action === "create")).toHaveLength(1);
    expect(writes.some((entry) => entry.action === "prepare")).toBe(false);
  });
  it("saves pending edits before creating a separate demo and inherits the newly saved project context", async () => {
    expandedCatalog = true;
    const user = await enter();
    await user.click(screen.getByText("项目设置", { selector: "summary" }));
    fireEvent.change(screen.getByLabelText("默认季度"), {target: {value: "2026-Q4"}});
    await user.click(screen.getByRole("button", {name: "示例与套装"}));
    await user.click(await screen.findByRole("tab", {name: "提案套装"}));
    await user.click(screen.getByRole("button", {name: "创建演示 Pitch"}));
    await waitFor(() => expect(writes.some(c => c.action === "create")).toBe(true));
    const created = writes.find(c => c.action === "create")!;
    expect(created.context).toMatchObject({period: "2026-Q4"});
    expect(created.projectId).not.toBe(projectId);
    const saveAt = writes.findIndex(c => c.action === "save"), createAt = writes.findIndex(c => c.action === "create");
    expect(saveAt).toBeGreaterThanOrEqual(0); expect(saveAt).toBeLessThan(createAt);
  });
  it("resizes the editor divider with the keyboard without writing project content", async () => {
    await enter();
    const divider = screen.getByRole("separator", { name: "调整左栏宽度" });
    const before = writes.filter((entry) => entry.action === "save").length;
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "240");
    fireEvent.keyDown(divider, { key: "End" });
    expect(divider).toHaveAttribute("aria-valuenow", "340");
    expect(writes.filter((entry) => entry.action === "save")).toHaveLength(before);
  });
  it("moves an actual canvas layer with the keyboard and saves the same coordinates after reopening", async () => {
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    const layer = await screen.findByRole("button", { name: "对象 1：隔离页面" });
    layer.focus();
    fireEvent.keyDown(layer, { key: "ArrowRight" });
    expect(screen.getByText("横向 1.05 英寸 · 纵向 1.00 英寸")).toBeInTheDocument();
    expect(writes.some(entry => entry.action === "save")).toBe(false);
    await user.click(screen.getByRole("button", { name: "应用位置" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[0].x).toBe(1.05), { timeout: 3000 });
    expect(writes.find(entry => entry.action === "save")?.pages).toEqual([
      { id: pageId, objectMoves: [{ id: "object-1", x: 1.05, y: 1 }] },
    ]);
    cleanup();
    await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    await user.click(await screen.findByRole("button", { name: "对象 1：隔离页面" }));
    expect(screen.getByText("横向 1.05 英寸 · 纵向 1.00 英寸")).toBeInTheDocument();
  });
  it("edits a real title inside the canvas, undoing and redoing before applying", async () => {
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    const layer = await screen.findByRole("button", { name: "对象 1：隔离页面" });
    fireEvent.doubleClick(layer);
    const input = screen.getByRole("textbox", { name: "画布文字" });
    fireEvent.change(input, { target: { value: "画布新标题" } });
    await user.click(screen.getByRole("button", { name: "完成文字编辑" }));
    expect(screen.getByRole("button", { name: "对象 1：画布新标题" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撤销画布操作" }));
    expect(screen.getByRole("button", { name: "对象 1：隔离页面" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重做画布操作" }));
    expect(screen.getByRole("button", { name: "对象 1：画布新标题" })).toBeInTheDocument();
    expect(writes.some(entry => entry.action === "save")).toBe(false);
    await user.click(screen.getByRole("button", { name: "应用到页面" }));
    await waitFor(() => expect(detail.slides[0].content.title).toBe("画布新标题"), { timeout: 3000 });
    expect(writes.find(entry => entry.action === "save")?.pages).toEqual([
      { id: pageId, objectTexts: [{ id: "object-1", text: "画布新标题" }] },
    ]);
  });
  it("rescales a shape in the canvas and saves proportional dimensions", async () => {
    detail.slides[0].scene.elements.push({
      kind: "shape", x: 2, y: 4, w: 3, h: 1, fill: "primary", background: false, shape: "rect",
    });
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    await user.click(await screen.findByRole("button", { name: "对象 2：形状" }));
    await user.click(screen.getByRole("button", { name: "缩小所选" }));
    expect(screen.getByLabelText("所选对象缩放")).toHaveTextContent("90%");
    const control = screen.getByRole("button", { name: "缩放所选对象" });
    fireEvent.keyDown(control, { key: "ArrowLeft", shiftKey: true });
    expect(screen.getByLabelText("所选对象缩放")).toHaveTextContent("80%");
    await user.click(screen.getByRole("button", { name: "应用位置" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[1].w).toBeCloseTo(2.4), { timeout: 3000 });
    expect(writes.find(entry => entry.action === "save")?.pages).toEqual([
      { id: pageId, objectMoves: [{ id: "object-2", x: 2, y: 4, scale: .8 }] },
    ]);
    expect(detail.slides[0].scene.elements[1].h).toBeCloseTo(.8);
    await user.click(await screen.findByRole("button", { name: "撤销已保存的调整" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[1].w).toBe(3));
    await user.click(screen.getByRole("button", { name: "重做已保存的调整" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[1].w).toBeCloseTo(2.4));
    expect(writes.filter(entry => entry.action === "restore_page").map(entry => entry.revision)).toEqual([1, 2]);
  });
  it("keeps project name focused through continuous typing and cursor edits", async () => {
    const user = await enter(),
      input = screen.getByLabelText("项目名称") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Alpha Beta 2026");
    expect(input).toHaveFocus();
    expect(screen.getByLabelText("项目名称")).toBe(input);
    input.setSelectionRange(6, 10);
    fireEvent.change(input, { target: { value: "Alpha 修改 2026" } });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "Alpha 修改中文 2026" } });
    fireEvent.compositionEnd(input);
    expect(input).toHaveFocus();
    await waitFor(
      () =>
        expect(
          writes.some(
            (c) => c.action === "save" && c.title === "Alpha 修改中文 2026",
          ),
        ).toBe(true),
      { timeout: 3000 },
    );
    expect(screen.getByLabelText("项目名称")).toBe(input);
    expect(input).toHaveFocus();
  });
  it("keeps page text focused through autosave and restores real server edits after remount", async () => {
    const user = await enter(),
      field = screen.getByLabelText("正文 1");
    await user.clear(field);
    await user.type(field, "中文 and English edit");
    expect(field).toHaveFocus();
    await waitFor(
      () =>
        expect(detail.slides[0].content.blocks[0].text).toBe(
          "中文 and English edit",
        ),
      { timeout: 3000 },
    );
    expect(screen.getByLabelText("正文 1")).toBe(field);
    expect(field).toHaveFocus();
    cleanup();
    await enter();
    expect(screen.getByLabelText("正文 1")).toHaveValue(
      "中文 and English edit",
    );
  });
  it("combines duplicate, keyboard reorder, selection and deletion without losing unaffected content", async () => {
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "复制第 1 页" }));
    expect(screen.getByText("2 页")).toBeInTheDocument();
    const second = screen.getByRole("button", { name: /打开第 2 页/ });
    fireEvent.keyDown(second, { key: "ArrowLeft", altKey: true });
    await user.click(screen.getByLabelText("选择第 2 页"));
    await user.click(screen.getByRole("button", { name: "删除选中" }));
    expect(screen.getByText("1 页")).toBeInTheDocument();
    await waitFor(() => expect(detail.slides).toHaveLength(1), {
      timeout: 3000,
    });
    expect(detail.slides[0].content.blocks[0].text).toBe("原始正文");
  });
  it("retains conflicting draft and hides privileged navigation from an ordinary account", async () => {
    const user = await enter();
    expect(
      screen.queryByRole("button", { name: "管理中心" }),
    ).not.toBeInTheDocument();
    rejectSave = true;
    await user.type(screen.getByLabelText("页面标题"), " · 本地未保存");
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "将编辑另存副本" }),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.getByLabelText("页面标题")).toHaveValue(
      "隔离页面 · 本地未保存",
    );
    expect(detail.slides[0].content.title).toBe("隔离页面");
  });
  it("refuses an API write when authentication identity changes instead of leaking a cached draft", async () => {
    const user = await enter();
    state.other = true;
    await user.type(screen.getByLabelText("页面标题"), " changed");
    await waitFor(
      () =>
        expect(
          screen.getByText("账号已切换，请重新进入工作台。"),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(writes.filter((c) => c.action === "save")).toHaveLength(0);
  });
  it("keeps project search stable through delayed empty results, middle edits and IME", async () => {
    const user = userEvent.setup();
    render(<PitchWorkspace />);
    await screen.findByRole("button", { name: "我的 Pitch" });
    await user.click(screen.getByRole("button", { name: "我的 Pitch" }));
    const field = screen.getByLabelText("搜索 Pitch") as HTMLInputElement;
    await user.type(field, "ABC 中文");
    field.setSelectionRange(1, 3);
    fireEvent.change(field, { target: { value: "A修改中文" } });
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: "A上海修改" } });
    fireEvent.compositionEnd(field);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /隔离测试 Pitch/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("搜索 Pitch")).toBe(field);
    expect(field).toHaveFocus();
  });
});

it("recovers progress after a network failure without duplicating generation or losing the old page", async () => {
  Object.assign(detail, {
    tasks: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        state: "processing",
        attempts: 1,
      },
    ],
  });
  failTaskPoll = true;
  const user = await enter();
  const retry = await screen.findByRole(
    "button",
    { name: "重新查询生成进度" },
    { timeout: 3000 },
  );
  expect(screen.getByLabelText("页面标题")).toHaveValue(
    initial().slides[0].content.title,
  );
  expect(
    screen.queryByRole("button", { name: "重试生成" }),
  ).not.toBeInTheDocument();
  failTaskPoll = false;
  await user.click(retry);
  await screen.findByRole("button", { name: "重试生成" }, { timeout: 3000 });
  expect(writes.filter((c) => c.action === "start")).toHaveLength(0);
  expect(writes.filter((c) => c.action === "status")).toHaveLength(2);
});

it("keeps the old page until a completed generation can actually be read, then recovers without a second generation", async () => {
  Object.assign(detail, {
    tasks: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        state: "processing",
        attempts: 1,
      },
    ],
  });
  failCompletedRead = true;
  completedTask = true;
  const user = await enter();
  const retry = await screen.findByRole(
    "button",
    { name: "重新查询生成进度" },
    { timeout: 3000 },
  );
  expect(screen.getByLabelText("页面标题")).toHaveValue(
    initial().slides[0].content.title,
  );
  expect(screen.getByRole("button", { name: "导出" })).toBeDisabled();
  expect(screen.getByText("页面已生成，正在读取结果")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "取消生成" }),
  ).not.toBeInTheDocument();
  failCompletedRead = false;
  detail.slides[0].content.title = "已读取的实际新页面";
  await user.click(retry);
  await waitFor(() =>
    expect(screen.getByLabelText("页面标题")).toHaveValue("已读取的实际新页面"),
  );
  expect(screen.getByRole("button", { name: "导出" })).toBeEnabled();
  expect(writes.filter((c) => c.action === "start")).toHaveLength(0);
});

it("keeps category fields focused while editing and switching static filters", async () => {
  const user = userEvent.setup(),
    catalog: Catalog = {
      scopes: [
        {
          organizationId: "test",
          region: "test",
          city: "test",
          businessLine: "test",
          canGenerate: true,
          canMaintain: true,
          canAdmin: true,
          canClientExport: false,
        },
      ],
      categories: [],
      themes: [],
    };
  render(
    <Manager
      call={(async () => ({ items: [], next: null })) as Call}
      catalog={catalog}
      session={
        {
          user: { id: state.id },
          session: { user: { id: state.id } },
        } as AuthSessionResult
      }
      onProject={async () => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "分类与主题" }));
  const field = screen.getByLabelText("分类名称"),
    code = screen.getByLabelText("稳定标识");
  await user.type(field, "团队内容");
  expect(field).toHaveFocus();
  await user.type(code, "team-new");
  expect(code).toHaveFocus();
  fireEvent.compositionStart(field);
  fireEvent.change(field, { target: { value: "企业素材" } });
  fireEvent.compositionEnd(field);
  expect(screen.getByLabelText("分类名称")).toBe(field);
});
