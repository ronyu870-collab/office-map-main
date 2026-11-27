import * as React from "react";
import { applyObjectMoves, applyObjectOrder, applyObjectGroups, applyObjectTexts, objectId, type ObjectMove, type ObjectText, type ObjectGroup } from "@/src/lib/pitch/workspace/object-layout";
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
  within,
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
      buildingIds: [] as string[],
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
  expandedCatalog = false,
  workspaceBuildingLookup = false,
  templateCapabilities: string[] = [],
  promotionPlanBuilding: string | undefined,
  sitePlanBuildingIds: string[] | undefined,
  readyProposal = false,
  dropProposalCreateResponse = false,
  bindingResponse: (() => unknown) | undefined,
  proposalSource: { id: string; detail: unknown } | undefined;
const proposalId = "66666666-6666-4666-8666-666666666666";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
beforeEach(() => {
  state.role = "editor";
  state.other = false;
  rejectSave = false;
  expandedCatalog = false;
  workspaceBuildingLookup = false;
  templateCapabilities = [];
  promotionPlanBuilding = undefined;
  sitePlanBuildingIds = undefined;
  failTaskPoll = false;
  failCompletedRead = false;
  completedTask = false;
  readyProposal = false;
  dropProposalCreateResponse = false;
  bindingResponse = undefined;
  proposalSource = undefined;
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
        body = path === "business" ? {
          recipes: expandedCatalog ? BUSINESS_RECIPES.map(r => ({...r, revision: 1, categoryId: sourceId, enabled: true})) : [],
          dynamic: ["competition-map", "stacking-plan", "lease-representatives", "lease-industry-distribution", "building-profile", "project-comparison"]
            .map(id => ({ id, name: id, status: "available", reason: "" })),
        } : catalog;
      else if (c.action === "capabilities")
        body = { allowedDynamic: templateCapabilities, buildingSearch: workspaceBuildingLookup };
      else if (c.action === "buildings")
        body = { items: [{ id: assetId, name: "工作台核对楼宇" }], next: null };
      else if (c.action === "preferences") body = { favorites: [], recent: [] };
      else if (c.action === "document_bindings") {
        if (bindingResponse) body = bindingResponse();
        else { status = 400; body = { error: "不支持此命令" }; }
      }
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
        body = proposalSource && c.projectId === proposalSource.id ? proposalSource.detail
          : c.projectId === proposalId ? { ...detail, project: { ...detail.project, id: proposalId, title: "CBD 选址方案" } }
            : detail;
      } else if (c.action === "create") {
        const created = {...detail, project: {...detail.project, id: c.projectId, title: c.title, theme_id: c.themeId, theme_version: c.themeVersion, organization_id: c.scope.organizationId, region: c.scope.region, city: c.scope.city, business_line: c.scope.businessLine}, workspace: {...detail.workspace, context: c.context, active_slide: null}, slides: [], tasks: []};
        body = created;
        if (readyProposal) {
          proposalSource = { id: c.projectId, detail: created };
          if (dropProposalCreateResponse) throw new Error("建项响应中断");
        }
      } else if (c.action === "proposal_plan") {
        body = sitePlanBuildingIds ? {
          status: "ready", selection: "explicit",
          plan: { id: sourceId, version: 1, title: "办公选址方案", contextFingerprint: "a".repeat(64),
            theme: { id: "colliers-default-v1", version: 3 }, slides: [{ id: pageId, title: "候选项目正式参数" }], gaps: [] },
          brief: { city: "test", scenario: "site-selection", submarkets: [], period: c.input.period ?? "2026-Q3",
            language: "zh", buildingIds: sitePlanBuildingIds },
        } : promotionPlanBuilding ? {
          status: "ready", selection: "explicit",
          plan: { id: sourceId, version: 1, title: "已选楼宇推介", contextFingerprint: "a".repeat(64),
            theme: { id: "colliers-default-v1", version: 3 }, slides: [{ id: pageId, title: "写字楼项目介绍" }], gaps: [] },
          brief: { city: "test", scenario: "building-promotion", submarkets: [], period: c.input.period ?? "2026-Q3",
            language: "zh", buildingIds: [promotionPlanBuilding] },
        } : readyProposal ? {
          status: "ready", selection: "scoped-sample",
          plan: { id: sourceId, version: 1, title: "CBD 选址方案", contextFingerprint: "a".repeat(64),
            theme: { id: "colliers-default-v1", version: 3 },
            slides: [{ id: pageId, title: "楼宇参数对比" }], gaps: [] },
          brief: { city: "北京", submarkets: ["CBD"], period: "2026-Q3", language: "zh", buildingIds: [assetId] },
        } : { status: "clarification", message: "请确认选址范围。" };
      } else if (c.action === "proposal_generate") {
        body = { state: "completed", taskId: c.confirmation.taskId, projectId: proposalId };
      } else if (c.action === "review_handoff") {
        const lease = c.handoff.source.kind === "lease-search" ? c.handoff.source : undefined;
        body = lease ? {
          status: "ready", fingerprint: "f".repeat(64), period: "", submarkets: [], buildingIds: [assetId],
          binding: { dataAsOf: lease.to }, parameters: { from: lease.from, to: lease.to, direction: lease.direction,
            leaseSource: lease.dataset, templateId: "lease-industry-distribution", chart: "bar", measure: "area" },
          pages: [{ title: "已选楼宇成交面积", sources: [{ label: "获权历史成交" }] }],
        } : {
          status: "ready", fingerprint: "f".repeat(64), period: "2026-Q3", submarkets: [], buildingIds: [assetId],
          binding: { dataAsOf: "2026-09-30" },
          pages: [{ title: "楼宇正式季度参数", sources: [{ label: "获权季度库" }],
            blocks: [{ kind: "table", columns: ["楼宇", "净有效租金"], rows: [["工作台核对楼宇", 95]],
              sourceIds: [sourceId] }] }],
        };
      } else if (c.action === "add_to_pitch") {
        body = { state: "queued" };
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
                objectOrder?: string[];
                objectGroups?: ObjectGroup[];
              }) => {
                const original = detail.slides.find(
                  (s) => s.id === (p.duplicateOf ?? p.id),
                )!;
                const patchedText = p.objectTexts && applyObjectTexts(slideSceneSchema.parse(original.scene), slideContentSchema.parse(original.content), p.objectTexts);
                const patchedScene = patchedText ? patchedText.scene : slideSceneSchema.parse(original.scene);
                const positioned = p.objectMoves ? applyObjectMoves(patchedScene, p.objectMoves) : patchedScene;
                const ordered = p.objectOrder ? applyObjectOrder(positioned, p.objectOrder) : positioned;
                return {
                  ...original,
                  id: p.id,
                  scene: p.objectGroups ? applyObjectGroups(ordered, p.objectGroups) : ordered,
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
  it("protects a formally bound paragraph in the inspector and canvas while submitting only the new manual text", async () => {
    const page = detail.slides[0];
    const manualId = "99999999-9999-4999-8999-999999999999";
    const official = "正式净有效租金为 145 元／平方米／月";
    const manual = "联络说明";
    page.content.blocks = [
      { kind: "paragraph", text: official, sourceIds: [sourceId] },
      { kind: "paragraph", text: manual, sourceIds: [manualId] },
    ];
    page.content.sources.push({ ...page.content.sources[0], id: manualId, recordId: "workspace:" + projectId, label: "人工说明" });
    page.scene.elements.push(
      { kind: "text", x: 1, y: 2, w: 9, h: 1, text: official, role: "body", bold: false },
      { kind: "text", x: 1, y: 4, w: 9, h: 1, text: manual, role: "body", bold: false },
    );
    bindingResponse = () => ({ projectVersion: detail.project.version, pages: [{ id: pageId, materials: { incompatible: true }, objects: [
      { index: 0, kind: "paragraph", sourceIds: [sourceId], valueOrigin: "business", receipts: [{
        sourceId, receiptId: "formal-rent", resultId: assetId,
        binding: { dataAsOf: "2026-01-01" }, query: { fields: ["netEffectiveRent"] },
      }] },
      { index: 1, kind: "paragraph", sourceIds: [manualId], valueOrigin: "manual" },
    ] }] });
    const user = await enter();
    const protectedField = await screen.findByLabelText("正文 1 · 只读");
    expect(protectedField).toHaveAttribute("readonly");
    expect(screen.getByLabelText("正文 2")).not.toHaveAttribute("readonly");
    await user.click(screen.getByRole("button", { name: "查看数据与来源" }));
    expect(await screen.findByText("正式查询依据")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "属性" }));
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    await user.click(await screen.findByRole("button", { name: `对象 2：${official}` }));
    expect(screen.queryByRole("button", { name: "编辑所选文字" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `对象 3：${manual}` }));
    expect(screen.getByRole("button", { name: "编辑所选文字" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "返回预览" }));
    const bindingReads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("document_bindings"));
    expect(bindingReads()).toHaveLength(1);
    const notes = screen.getByLabelText("正文 2");
    await user.clear(notes);
    await user.type(notes, "已核对联络安排");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(writes.find(entry => entry.action === "save")).toMatchObject({
      pages: [{ id: pageId, paragraphs: [official, "已核对联络安排"] }],
    }));
    await waitFor(() => expect(bindingReads()).toHaveLength(2));
  });
  it("opens the exact bound visual receipt from the canvas and omits unmatched versions", async () => {
    const page = detail.slides[0];
    const imageId = "66666666-6666-4666-8666-666666666666";
    const documentId = "77777777-7777-4777-8777-777777777777";
    const documentSourceId = "88888888-8888-4888-8888-888888888888";
    const otherImageId = "99999999-9999-4999-8999-999999999999";
    const digest = "a".repeat(64), version = "b".repeat(64), documentDigest = "c".repeat(64);
    const date = "2026-06-15";
    page.content = { ...page.content, blocks: [
      { kind: "image", mediaAssetId: imageId, mediaVersion: 2, alt: "已选楼宇外观", sourceIds: [sourceId] },
      { kind: "image", mediaAssetId: otherImageId, mediaVersion: 1, alt: "其他成稿图片", sourceIds: [documentSourceId] },
    ], sources: [
      { ...page.content.sources[0], label: "图库已核对来源", locator: "外立面", version, sha256: digest, dataAsOf: date },
      { id: documentSourceId, kind: "document", documentId, label: "获权历史案例", locator: "第 8 页", version: "4",
        sha256: documentDigest, dataAsOf: "2026-01-01" },
    ] } as unknown as typeof page.content;
    page.scene.elements.push(
      { kind: "image", x: 1, y: 2, w: 4, h: 3, mediaAssetId: imageId, mediaVersion: 2, fit: "contain", alt: "已选楼宇外观" },
      { kind: "image", x: 7, y: 2, w: 4, h: 3, mediaAssetId: otherImageId, mediaVersion: 1, fit: "contain", alt: "其他成稿图片" },
    );
    bindingResponse = () => ({ projectVersion: detail.project.version, pages: [{ id: pageId, objects: [
      { index: 0, kind: "image", valueOrigin: "asset", sourceIds: [sourceId], mediaRefs: [{ id: imageId, version: 2 }] },
      { index: 1, kind: "image", valueOrigin: "asset", sourceIds: [documentSourceId], mediaRefs: [{ id: otherImageId, version: 1 }] },
    ], materials: { asset: { id: assetId, version: 1 },
      documents: [{ sourceId: documentSourceId, documentId, pageId: null, version: 4, sha256: documentDigest, dataAsOf: null }],
      media: [{ id: otherImageId, version: 2, documentId, pageId, documentVersion: 4, sha256: digest, dataAsOf: null }],
      visuals: [{ id: imageId, version: 2, sourceId, kind: "photo", sha256: digest, versionHash: version, sourceDate: date,
        dataAsOf: null, buildingIds: [assetId] }],
    } }] });
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    await user.click(await screen.findByRole("button", { name: "对象 3：其他成稿图片" }));
    expect(screen.queryByRole("button", { name: "查看素材来源" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "对象 2：已选楼宇外观" }));
    await user.click(await screen.findByRole("button", { name: "查看素材来源" }));
    expect(screen.getByText("素材来源", { selector: "summary" })).toHaveFocus();
    expect(screen.getByText(`图库登记日 ${date}`)).toBeVisible();
    expect(screen.queryByText("获权历史案例")).not.toBeInTheDocument();
    await user.click(screen.getByText("版本校验", { selector: "summary" }));
    expect(screen.getByText(`SHA-256 ${digest}`)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看本页全部来源" }));
    expect(screen.getByText("第 8 页 · 原件版本 4")).toBeVisible();
    expect(screen.getByText("业务日期待确认")).toBeVisible();
    expect(screen.queryByText("素材图片版本 2 · 原件版本 4")).not.toBeInTheDocument();
  });
  it("keeps paragraph editing locked until bindings for the current revision arrive", async () => {
    let fresh = false;
    bindingResponse = () => ({ projectVersion: fresh ? detail.project.version : detail.project.version + 1,
      pages: [{ id: pageId, objects: [{ index: 0, kind: "paragraph", sourceIds: [sourceId], valueOrigin: "asset" }] }] });
    const user = await enter();
    expect(await screen.findByText("项目版本已变化，请重新打开项目检查数据绑定。")).toBeInTheDocument();
    expect(screen.getByLabelText("正文 1")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("页面标题")).not.toHaveAttribute("readonly");
    fresh = true;
    await user.click(screen.getByRole("button", { name: "重试读取绑定" }));
    await waitFor(() => expect(screen.getByLabelText("正文 1")).not.toHaveAttribute("readonly"));
    expect(writes.some(entry => entry.action === "save")).toBe(false);
  });
  it("plans a workbench brief before writes and opens the project assistant when settings are needed", async () => {
    const user = userEvent.setup();
    render(<PitchWorkspace />);
    const brief = await screen.findByLabelText("你想制作什么？");
    await user.type(brief, "为科技企业制作选址提案");
    await user.click(screen.getByRole("button", { name: "进入提案助手" }));
    await screen.findByText("请确认选址范围。");
    expect(writes.find(entry => entry.action === "proposal_plan")?.input).not.toHaveProperty("projectId");
    expect(writes.some((entry) => entry.action === "create" || entry.action === "prepare")).toBe(false);
    await user.click(screen.getByRole("button", { name: "打开项目设置" }));
    const projectTitle = screen.getByLabelText("Pitch 名称");
    expect(projectTitle).toHaveValue("为科技企业制作选址提案");
    await user.clear(projectTitle);
    await user.type(projectTitle, "选址项目");
    await user.click(screen.getByRole("button", { name: /^创建$/ }));
    const question = await screen.findByLabelText("需要制作什么页面？", {}, { timeout: 10000 });
    expect(question).toHaveValue("为科技企业制作选址提案");
    await screen.findByText("请确认选址范围。");
    expect(writes.filter((entry) => entry.action === "create")).toHaveLength(1);
    expect(writes.filter((entry) => entry.action === "proposal_plan")).toHaveLength(2);
    expect(writes.some((entry) => entry.action === "proposal_generate")).toBe(false);
  }, 60000);
  it("routes each flagship entry through a business plan review without creating a project", async () => {
    const user = userEvent.setup();
    render(<PitchWorkspace />);
    const scenarios = [
      ["招商代理", "为霄云路33号制作招商代理提案。"],
      ["办公选址对比", "制作CBD五个甲级写字楼的选址对比。"],
      ["季度市场报告", "用最新正式季度制作北京写字楼市场报告。"],
      ["单楼项目推介", "为五矿广场制作项目推介。"],
    ];
    for (const [label, question] of scenarios) {
      await user.click(await screen.findByRole("button", { name: label }));
      await screen.findByText("请确认选址范围。");
      expect(writes.at(-1)).toMatchObject({ action: "proposal_plan", input: { question, audience: "internal" } });
      await user.click(screen.getByRole("button", { name: "关闭" }));
    }
    expect(writes.map(entry => entry.action)).toEqual(scenarios.map(() => "proposal_plan"));
  });
  it("creates the reviewed home proposal only after confirmation and recovers the same project after a lost create response", async () => {
    readyProposal = true;
    dropProposalCreateResponse = true;
    const user = userEvent.setup();
    render(<PitchWorkspace />);
    await user.click(await screen.findByRole("button", { name: "办公选址对比" }));
    await screen.findByText("楼宇参数对比");
    expect(writes.filter(entry => entry.action === "create" || entry.action === "proposal_generate")).toHaveLength(0);
    const plan = writes.find(entry => entry.action === "proposal_plan")!;
    expect(plan.input).toEqual(expect.objectContaining({
      question: "制作CBD五个甲级写字楼的选址对比。", audience: "internal",
    }));
    await user.click(screen.getByRole("button", { name: "确认并生成 Pitch" }));
    await screen.findByLabelText("页面标题");
    const creates = writes.filter(entry => entry.action === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ themeId: "colliers-default-v1", themeVersion: 3 });
    expect(creates[0].context).toMatchObject({ buildingIds: [assetId], period: "2026-Q3" });
    expect(writes.find(entry => entry.action === "proposal_generate")?.confirmation).toEqual(expect.objectContaining({
      projectId: creates[0].projectId, expectedVersion: 1, contextFingerprint: "a".repeat(64),
      request: { ...(plan.input as object), projectId: creates[0].projectId },
    }));
    expect(writes.find(entry => entry.action === "get" && entry.projectId === proposalId)).toBeDefined();
  }, 60000);
  it("reviews selected buildings in the data inspector and appends exactly the reviewed scope to the current project", async () => {
    workspaceBuildingLookup = true;
    detail.workspace.context.period = "2026-Q3";
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "数据" }));
    await user.click(screen.getByText("查找楼宇数据", { selector: "summary" }));
    await user.type(await screen.findByLabelText("搜索楼宇"), "工作台核对");
    await user.click(await screen.findByRole("button", { name: "工作台核对楼宇" }));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "核对季度数据" }));
    await screen.findByText("追加到 隔离测试 Pitch");
    expect(screen.queryByLabelText("目标项目")).not.toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "95" })).toBeInTheDocument();
    expect(screen.getByText("获权季度库")).toBeInTheDocument();
    expect(writes.some(entry => entry.action === "add_to_pitch")).toBe(false);
    const review = writes.find(entry => entry.action === "review_handoff");
    expect(review).toEqual({ action: "review_handoff", handoff: {
      projectId, source: { kind: "buildings", buildingIds: [assetId] }, period: "2026-Q3", language: "zh",
    } });
    await user.click(screen.getByRole("button", { name: "确认并追加" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "加入 Pitch" })).not.toBeInTheDocument());
    expect(writes.filter(entry => entry.action === "add_to_pitch")).toEqual([{
      action: "add_to_pitch", handoff: review?.handoff, target: { mode: "append", expectedVersion: 1 },
      fingerprint: "f".repeat(64), taskId: expect.any(String),
    }]);
    expect(writes.some(entry => entry.action === "save")).toBe(false);
    expect(detail.workspace.context.buildingIds).toEqual([]);
    await user.click(screen.getByRole("button", { name: "数据" }));
    await user.click(screen.getByText("查找楼宇数据", { selector: "summary" }));
    await user.click(screen.getByText("项目设置", { selector: "summary" }));
    const settings = await screen.findByRole("group", { name: "关联项目" });
    await user.type(within(settings).getByLabelText("搜索楼宇"), "工作台核对");
    await user.click(await within(settings).findByRole("button", { name: "工作台核对楼宇" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(detail.workspace.context.buildingIds).toEqual([assetId]));
  });
  it("opens a photo-backed promotion with the exact picked building and confirms a separate project", async () => {
    workspaceBuildingLookup = true;
    templateCapabilities = ["building-profile"];
    promotionPlanBuilding = pageId;
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "数据" }));
    await user.click(screen.getByText("查找楼宇数据", { selector: "summary" }));
    await user.type(await screen.findByLabelText("搜索楼宇"), "工作台核对");
    await user.click(await screen.findByRole("button", { name: "工作台核对楼宇" }));
    await user.click(screen.getByText("楼宇资料页", { selector: "summary" }));
    await user.click(screen.getByRole("button", { name: "新建楼宇推介" }));
    const dialog = await screen.findByRole("dialog", { name: "新建楼宇推介" });
    expect(await within(dialog).findByText("推介方案与所选楼宇或季度不一致，请重新核对。")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "确认并生成 Pitch" })).not.toBeInTheDocument();
    expect(writes.find(entry => entry.action === "proposal_plan")).toEqual({ action: "proposal_plan", input: {
      question: "为所选楼宇制作项目推介", city: "test", audience: "internal", buildingIds: [assetId], language: "zh",
    } });
    promotionPlanBuilding = assetId;
    await user.click(within(dialog).getByText("调整正式季度", { selector: "summary" }));
    await user.type(within(dialog).getByLabelText("正式季度"), "2026-Q2");
    await user.click(within(dialog).getByRole("button", { name: "按此季度核对" }));
    await within(dialog).findByText("写字楼项目介绍");
    const input = writes.filter(entry => entry.action === "proposal_plan").at(-1)?.input;
    expect(input).toMatchObject({ period: "2026-Q2", buildingIds: [assetId] });
    expect(writes.some(entry => entry.action === "create")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "确认并生成 Pitch" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建楼宇推介" })).not.toBeInTheDocument());
    const created = writes.find(entry => entry.action === "create")!;
    expect(created.projectId).not.toBe(projectId);
    expect(created).toMatchObject({ scope: { organizationId: "test", region: "test", city: "test", businessLine: "test" },
      context: { buildingIds: [assetId], period: "2026-Q2" } });
    expect(writes.find(entry => entry.action === "proposal_generate")?.confirmation).toMatchObject({
      projectId: created.projectId, request: { ...(input as object), projectId: created.projectId },
    });
    expect(writes.some(entry => entry.action === "save")).toBe(false);
  });
  it("forwards a building-detail handoff to a new pitch with the original quarter and exact workspace scope", async () => {
    templateCapabilities = ["building-profile"];
    promotionPlanBuilding = assetId;
    const user = userEvent.setup();
    const original = window.location.href;
    const source = { source: { kind: "buildings", buildingIds: [assetId] }, period: "2026-Q2" };
    window.history.replaceState(null, "", "#add-to-pitch=" + encodeURIComponent(JSON.stringify(source)));
    try {
      render(<PitchWorkspace />);
      const handoff = await screen.findByRole("dialog", { name: "加入 Pitch" });
      await user.click(within(handoff).getByRole("button", { name: "新建楼宇推介" }));
      const promotion = await screen.findByRole("dialog", { name: "新建楼宇推介" });
      await within(promotion).findByText("写字楼项目介绍");
      expect(writes.find(entry => entry.action === "proposal_plan")?.input).toMatchObject({
        buildingIds: [assetId], period: "2026-Q2",
      });
      expect(writes.some(entry => entry.action === "create" || entry.action === "add_to_pitch")).toBe(false);
      await user.click(within(promotion).getByRole("button", { name: "确认并生成 Pitch" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建楼宇推介" })).not.toBeInTheDocument());
      const created = writes.find(entry => entry.action === "create")!;
      expect(created.scope).toEqual({ organizationId: "test", region: "test", city: "test", businessLine: "test" });
      expect(created.context).toMatchObject({ buildingIds: [assetId], period: "2026-Q2" });
    } finally {
      window.history.replaceState(null, "", original);
    }
  });
  it("takes the exact ordered map selection into a complete site proposal and keeps the source after closing the preview", async () => {
    templateCapabilities = ["project-comparison"];
    const selected = [assetId, pageId];
    sitePlanBuildingIds = [assetId, sourceId];
    const user = userEvent.setup();
    const original = window.location.href;
    const source = { source: { kind: "buildings", buildingIds: selected }, period: "2026-Q2" };
    window.history.replaceState(null, "", "#add-to-pitch=" + encodeURIComponent(JSON.stringify(source)));
    try {
      render(<PitchWorkspace />);
      const handoff = await screen.findByRole("dialog", { name: "加入 Pitch" });
      expect(within(handoff).getByText("已选 2 栋楼宇")).toBeInTheDocument();
      await user.click(within(handoff).getByRole("button", { name: "新建办公选址方案" }));
      const firstPreview = await screen.findByRole("dialog", { name: "新建办公选址方案" });
      await within(firstPreview).findByText("选址方案与所选楼宇或季度不一致，请重新核对。");
      expect(within(firstPreview).queryByRole("button", { name: "确认并生成 Pitch" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      const restored = await screen.findByRole("dialog", { name: "加入 Pitch" });
      expect(within(restored).getByLabelText("正式季度")).toHaveValue("2026-Q2");
      expect(within(restored).getByText("已选 2 栋楼宇")).toBeInTheDocument();

      sitePlanBuildingIds = selected;
      await user.click(within(restored).getByRole("button", { name: "新建办公选址方案" }));
      const preview = await screen.findByRole("dialog", { name: "新建办公选址方案" });
      await within(preview).findByText("候选项目正式参数");
      const input = writes.filter(entry => entry.action === "proposal_plan").at(-1)?.input;
      expect(input).toEqual({ question: "为所选楼宇制作办公选址方案", city: "test", audience: "internal",
        language: "zh", buildingIds: selected, period: "2026-Q2" });
      expect(writes.some(entry => entry.action === "create" || entry.action === "add_to_pitch")).toBe(false);
      await user.click(within(preview).getByRole("button", { name: "确认并生成 Pitch" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建办公选址方案" })).not.toBeInTheDocument());
      expect(screen.queryByRole("dialog", { name: "加入 Pitch" })).not.toBeInTheDocument();
      const created = writes.find(entry => entry.action === "create")!;
      expect(created.context).toMatchObject({ buildingIds: selected, period: "2026-Q2" });
      expect(writes.find(entry => entry.action === "proposal_generate")?.confirmation).toMatchObject({
        projectId: created.projectId, request: { ...(input as object), projectId: created.projectId },
      });
    } finally {
      window.history.replaceState(null, "", original);
    }
  });
  it("plans office site selection from the data inspector without changing the current proposal", async () => {
    workspaceBuildingLookup = true;
    templateCapabilities = ["project-comparison"];
    detail.workspace.context.buildingIds = [pageId];
    detail.workspace.context.period = "2026-Q2";
    sitePlanBuildingIds = [pageId, assetId];
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "数据" }));
    await user.click(screen.getByText("查找楼宇数据", { selector: "summary" }));
    await user.type(await screen.findByLabelText("搜索楼宇"), "工作台核对");
    await user.click(await screen.findByRole("button", { name: "工作台核对楼宇" }));
    await user.click(screen.getByText("楼宇资料页", { selector: "summary" }));
    await user.click(screen.getByRole("button", { name: "新建办公选址方案" }));
    const preview = await screen.findByRole("dialog", { name: "新建办公选址方案" });
    await within(preview).findByText("候选项目正式参数");
    expect(writes.find(entry => entry.action === "proposal_plan")?.input).toMatchObject({
      buildingIds: [pageId, assetId], period: "2026-Q2",
    });
    expect(writes.some(entry => ["create", "add_to_pitch", "save"].includes(String(entry.action)))).toBe(false);
    expect(detail.workspace.context.buildingIds).toEqual([pageId]);
  });
  it.each([
    ["competition-map", "添加区位图", "添加历史堆叠图"],
    ["stacking-plan", "添加历史堆叠图", "添加区位图"],
  ])("appends %s for the exact selected buildings with the required server capability", async (templateId, label, unavailableLabel) => {
    workspaceBuildingLookup = true;
    templateCapabilities = [templateId];
    detail.workspace.context.period = "2026-Q3";
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "数据" }));
    await user.click(screen.getByText("查找楼宇数据", { selector: "summary" }));
    await user.type(await screen.findByLabelText("搜索楼宇"), "工作台核对");
    await user.click(await screen.findByRole("button", { name: "工作台核对楼宇" }));
    await user.click(await screen.findByText("楼宇资料页", { selector: "summary" }));
    expect(screen.queryByRole("button", { name: unavailableLabel })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(writes.find(entry => entry.action === "start")).toMatchObject({
      projectId, expectedVersion: 1, replaceIds: [],
      part: { mode: "dynamic", parameters: {
        templateId, buildingIds: [assetId], period: { year: 2026, quarter: 3 },
      } },
    }));
    expect(writes.some(entry => entry.action === "save")).toBe(false);
    expect(detail.workspace.context.buildingIds).toEqual([]);
  });
  it("regenerates the reviewed visual page even after navigating to another page", async () => {
    templateCapabilities = ["stacking-plan"];
    workspaceBuildingLookup = true;
    const otherPageId = "77777777-7777-4777-8777-777777777777";
    detail.slides.push({ ...detail.slides[0], id: otherPageId,
      content: { ...detail.slides[0].content, title: "另一页" },
    });
    const period = { year: 2026, quarter: 3 };
    detail.workspace.page_settings = { [pageId]: { origin: "data", manual: false, part: { mode: "dynamic", parameters: {
      templateId: "stacking-plan", buildingIds: [assetId], submarkets: [], inventory: "tracked", period, start: period, end: period,
      fields: ["totalArea"], direction: "desc", chart: "table", from: "2026-01-01", to: "2026-09-30", leaseSource: "combined", measure: "count",
    } } } };
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "数据" }));
    await user.click(screen.getByRole("button", { name: "调整参数并重新生成" }));
    expect(screen.queryByLabelText("统计季度")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("图表形式")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开第 2 页：另一页" }));
    await user.click(screen.getByRole("button", { name: "重新生成页面" }));
    await waitFor(() => expect(writes.find(entry => entry.action === "start")).toMatchObject({
      projectId, replaceIds: [pageId],
      part: { mode: "dynamic", parameters: { templateId: "stacking-plan", buildingIds: [assetId] } },
    }));
  });
  it("reviews lease evidence for the selected building with the chosen dates, source and permitted aggregation", async () => {
    workspaceBuildingLookup = true;
    templateCapabilities = ["lease-industry-distribution"];
    detail.workspace.context.period = "2026-Q3";
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "数据" }));
    await user.click(screen.getByText("查找楼宇数据", { selector: "summary" }));
    expect(screen.queryByText("租赁成交", { selector: "summary" })).not.toBeInTheDocument();
    await user.type(await screen.findByLabelText("搜索楼宇"), "工作台核对");
    await user.click(await screen.findByRole("button", { name: "工作台核对楼宇" }));
    await user.click(screen.getByText("租赁成交", { selector: "summary" }));
    expect(screen.getByLabelText("成交开始日期")).toHaveValue("2026-07-01");
    expect(screen.getByLabelText("成交结束日期")).toHaveValue("2026-09-30");
    expect(screen.queryByRole("option", { name: "成交明细" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("成交开始日期"), { target: { value: "2026-10-01" } });
    expect(screen.getByRole("button", { name: "核对成交资料" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("成交开始日期"), { target: { value: "2026-08-01" } });
    await user.selectOptions(screen.getByLabelText("成交来源"), "history");
    await user.selectOptions(screen.getByLabelText("成交内容"), "industry-area");
    await user.click(screen.getByRole("button", { name: "核对成交资料" }));
    expect(await screen.findByText("获权历史成交")).toBeInTheDocument();
    expect(writes.filter(entry => entry.action === "review_handoff")).toEqual([{ action: "review_handoff", handoff: {
      projectId, language: "zh", source: { kind: "lease-search", dataset: "history", from: "2026-08-01", to: "2026-09-30",
        buildingIds: [assetId], submarkets: [], view: "industry-area", direction: "desc" },
    } }]);
    expect(writes.some(entry => entry.action === "add_to_pitch")).toBe(false);
    await user.click(screen.getByRole("button", { name: "确认并追加" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "加入 Pitch" })).not.toBeInTheDocument());
    expect(writes.find(entry => entry.action === "add_to_pitch")).toMatchObject({
      handoff: writes.find(entry => entry.action === "review_handoff")?.handoff,
      target: { mode: "append", expectedVersion: 1 }, fingerprint: "f".repeat(64),
    });
    expect(writes.some(entry => entry.action === "save")).toBe(false);
  });
  it("saves pending edits before creating a separate demo and inherits the newly saved project context", async () => {
    expandedCatalog = true;
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "数据" }));
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
    const inspector = screen.getByRole("separator", { name: "调整右栏宽度" });
    const before = writes.filter((entry) => entry.action === "save").length;
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "220");
    fireEvent.keyDown(divider, { key: "End" });
    expect(divider).toHaveAttribute("aria-valuenow", "288");
    fireEvent.keyDown(inspector, { key: "ArrowLeft" });
    expect(inspector).toHaveAttribute("aria-valuenow", "316");
    fireEvent.keyDown(inspector, { key: "Home" });
    expect(inspector).toHaveAttribute("aria-valuenow", "260");
    expect(writes.filter((entry) => entry.action === "save")).toHaveLength(before);
  });
  it("keeps the assistant draft and page search when returning from the focused canvas", async () => {
    const user = await enter();
    const search = screen.getByRole("searchbox", { name: "搜索页面" });
    await user.type(search, "隔离");
    await user.click(screen.getByRole("button", { name: "提案助手" }));
    const question = await screen.findByLabelText("需要制作什么页面？");
    await user.type(question, "保留我的提案需求");
    await user.click(screen.getByRole("button", { name: "设计" }));
    expect(screen.getByLabelText("整套设计主题")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "专注画布" }));
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "页面预览" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "退出专注画布" }));
    expect(search).toHaveValue("隔离");
    await user.click(screen.getByRole("button", { name: "提案助手" }));
    expect(question).toHaveValue("保留我的提案需求");
    expect(writes.some((entry) => entry.action === "save")).toBe(false);
  });
  it("moves an actual canvas layer with the keyboard and saves the same coordinates after reopening", async () => {
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    const layer = await screen.findByRole("button", { name: "对象 1：隔离页面" }, { timeout: 3000 });
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
  it("shows the nearest drag guide and saves its exact position for every member of the moved group", async () => {
    const group = "88888888-8888-4888-8888-888888888888";
    const scene = detail.slides[0].scene;
    scene.elements.push(...[2, 4].map((x, index) => ({
      kind: "shape" as const, x, y: 4 + index, w: 1, h: 1, fill: "primary" as const,
      background: false, shape: "rect" as const, editorId: `object-${index + 2}`, editorGroup: group,
    })));
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    const layer = await screen.findByRole("button", { name: "对象 2：形状" });
    const board = layer.parentElement!;
    vi.spyOn(board, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, scene.width * 100, scene.height * 100));
    Object.defineProperty(layer, "setPointerCapture", { value: vi.fn() });

    fireEvent.pointerDown(layer, { pointerId: 1, clientX: 200, clientY: 400, button: 0 });
    fireEvent.pointerMove(layer, { pointerId: 1, clientX: 103, clientY: 400 });
    expect(board.querySelector('[data-axis="x"]')).toBeInTheDocument();
    expect(screen.getByText("横向 1.00 英寸 · 纵向 4.00 英寸")).toBeInTheDocument();
    expect(writes.some(entry => entry.action === "save")).toBe(false);
    fireEvent.pointerUp(layer, { pointerId: 1, clientX: 103, clientY: 400 });
    expect(board.querySelector('[data-axis="x"]')).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "应用位置" }));
    await waitFor(() => expect(detail.slides[0].scene.elements.slice(1).map(element => element.x)).toEqual([1, 3]));
    expect(writes.find(entry => entry.action === "save")?.pages).toEqual([
      { id: pageId, objectMoves: [{ id: "object-2", x: 1, y: 4 }, { id: "object-3", x: 3, y: 5 }] },
    ]);
    expect(detail.slides[0].scene.elements.slice(1).every(element => element.editorGroup === group)).toBe(true);
  });

  it("aligns the edges of checked objects as one undoable change and persists only changed positions", async () => {
    detail.slides[0].scene.elements.push({
      kind: "shape", x: 2, y: 4, w: 1, h: 1, fill: "primary", background: false, shape: "rect",
    });
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    const shape = await screen.findByRole("button", { name: "对象 2：形状" });
    await user.click(shape);
    await user.click(screen.getByText("图层（从上到下）"));
    await user.click(screen.getByRole("checkbox", { name: "多选对象：形状" }));
    expect(screen.queryByLabelText("对齐所选对象")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "多选对象：隔离页面" }));
    await user.selectOptions(screen.getByLabelText("对齐所选对象"), "left");
    expect(screen.getByText("横向 1.00 英寸 · 纵向 4.00 英寸")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撤销画布操作" }));
    expect(screen.getByText("横向 2.00 英寸 · 纵向 4.00 英寸")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重做画布操作" }));
    expect(writes.some(entry => entry.action === "save")).toBe(false);
    await user.click(screen.getByRole("button", { name: "应用位置" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[1].x).toBe(1));
    expect(writes.find(entry => entry.action === "save")?.pages).toEqual([
      { id: pageId, objectMoves: [{ id: "object-2", x: 1, y: 4 }] },
    ]);
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
    await user.click(screen.getByRole("button", { name: "右转 15°" }));
    expect(screen.getByLabelText("所选对象角度")).toHaveTextContent("15°");
    const angle = screen.getByRole("spinbutton", { name: "旋转角度" });
    fireEvent.change(angle, { target: { value: "25" } });
    fireEvent.blur(angle);
    expect(screen.getByLabelText("所选对象角度")).toHaveTextContent("25°");
    await user.click(screen.getByRole("button", { name: "应用位置" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[1].w).toBeCloseTo(2.4), { timeout: 3000 });
    expect(writes.find(entry => entry.action === "save")?.pages).toEqual([
      { id: pageId, objectMoves: [{ id: "object-2", x: 2, y: 4, scale: .8, rotation: 25 }] },
    ]);
    expect(detail.slides[0].scene.elements[1].h).toBeCloseTo(.8);
    expect(detail.slides[0].scene.elements[1]).toMatchObject({ rotation: 25 });
    await user.click(await screen.findByRole("button", { name: "撤销已保存的调整" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[1].w).toBe(3));
    await user.click(screen.getByRole("button", { name: "重做已保存的调整" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[1].w).toBeCloseTo(2.4));
    expect(writes.filter(entry => entry.action === "restore_page").map(entry => entry.revision)).toEqual([1, 2]);
  });
  it("saves layer order and preserves stable IDs when the page is reopened", async () => {
    detail.slides[0].scene.elements.push({
      kind: "shape", x: 2, y: 4, w: 3, h: 1, fill: "primary", background: false, shape: "rect",
    });
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    await user.click(await screen.findByRole("button", { name: "对象 2：形状" }));
    await user.click(screen.getByText("图层（从上到下）"));
    await user.click(screen.getByRole("button", { name: "下移一层" }));
    await user.click(screen.getByRole("button", { name: "应用到页面" }));
    await waitFor(() => expect(detail.slides[0].scene.elements.map(el => el.editorId)).toEqual(["object-2", "object-1"]), { timeout: 3000 });
    expect(writes.find(entry => entry.action === "save")?.pages).toEqual([
      { id: pageId, objectOrder: ["object-2", "object-1"] },
    ]);
    cleanup();
    await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    expect(await screen.findByRole("button", { name: "对象 1：形状" })).toBeInTheDocument();
  });
  it("persists the same equal spacing applied on the real object canvas", async () => {
    detail.slides[0].scene.elements.push(...[1, 4, 10].map(x => ({
      kind: "shape" as const, x, y: 4, w: 1, h: 1, fill: "primary" as const,
      background: false, shape: "rect" as const,
    })));
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    await screen.findByRole("button", { name: "对象 2：形状" });
    await user.click(screen.getByText("图层（从上到下）"));
    for (const item of screen.getAllByRole("checkbox", { name: "多选对象：形状" })) await user.click(item);
    await user.click(screen.getByRole("button", { name: "水平等距分布" }));
    await user.click(screen.getByRole("button", { name: "应用位置" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[2].x).toBe(5.5), { timeout: 3000 });
    expect(writes.find(entry => entry.action === "save")?.pages).toEqual([
      { id: pageId, objectMoves: [{ id: "object-3", x: 5.5, y: 4 }] },
    ]);
    expect(detail.slides[0].scene.elements.slice(1).map(element => element.x)).toEqual([1, 5.5, 10]);
  });
  it("moves a persistent canvas group together and can dissolve it without moving any member", async () => {
    detail.slides[0].scene.elements.push({
      kind: "shape", x: 2, y: 4, w: 3, h: 1, fill: "primary", background: false, shape: "rect",
    });
    const user = await enter();
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    await screen.findByRole("button", { name: "对象 2：形状" }, { timeout: 15000 });
    await user.click(screen.getByText("图层（从上到下）"));
    await user.click(screen.getByRole("checkbox", { name: "多选对象：形状" }));
    await user.click(screen.getByRole("checkbox", { name: "多选对象：隔离页面" }));
    await user.click(screen.getByRole("button", { name: "组合所选对象" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "对象 2：形状" }), { key: "ArrowRight" });
    await user.click(screen.getByRole("button", { name: "应用到页面" }));
    await waitFor(() => expect(detail.slides[0].scene.elements[1].x).toBeCloseTo(2.05), { timeout: 3000 });
    const saved = detail.slides[0].scene.elements;
    expect(saved[0].x).toBeCloseTo(1.05);
    expect(saved[0].editorGroup).toBeDefined();
    expect(saved[0].editorGroup).toBe(saved[1].editorGroup);
    await user.click(screen.getByRole("button", { name: "调整画布对象" }));
    await user.click(await screen.findByRole("button", { name: "对象 2：形状" }, { timeout: 15000 }));
    await user.click(screen.getByText("图层（从上到下）"));
    await user.click(screen.getByRole("button", { name: "取消所选组合" }));
    await user.click(screen.getByRole("button", { name: "应用到页面" }));
    await waitFor(() => expect(detail.slides[0].scene.elements.every(el => !el.editorGroup)).toBe(true), { timeout: 3000 });
    expect(detail.slides[0].scene.elements[1].x).toBeCloseTo(2.05);
  }, 60000);
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
    await user.click(screen.getByLabelText("选择第 1 页"));
    await user.click(screen.getByRole("button", { name: "复制选中" }));
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
