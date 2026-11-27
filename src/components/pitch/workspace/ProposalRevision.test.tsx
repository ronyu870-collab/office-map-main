import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { layoutFixture } from "@/src/lib/pitch/fixtures/layouts";
import { workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { languageReviewSchema, matchesAppliedLanguage } from "./LanguageRevisionReview";
import { ProposalRevision } from "./ProposalRevision";
import { PhotoReplacementPicker } from "./PhotoReplacementPicker";
import { WorkspaceError, type Call } from "./client";

vi.mock("./PhotoPreviewImage", () => ({
  PhotoPreviewImage: ({ caption }: { caption: string }) => <span>{caption}</span>,
}));

afterEach(cleanup);
const projectId = "11111111-1111-4111-8111-111111111111";
const pageId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
const buildingId = "44444444-4444-4444-8444-444444444444";
const competitor = { id: "55555555-5555-4555-8555-555555555555", name: "五矿广场", submarket: "东二环" };
const version = 6;
const fingerprint = "a".repeat(64);
const content = layoutFixture("chart-insight");
const detail = workspaceDetailSchema.parse({
  project: { id: projectId, version, title: "市场汇报", theme_id: "colliers-default-v1", theme_version: 2,
    organization_id: "test", region: "华北", city: "北京", business_line: "office" },
  slides: [{ id: pageId, asset_id: pageId, asset_version: 1, template_id: "fixture", template_version: 1, content,
    scene: { protocol: "colliers-pitch/1", width: 13.333333, height: 7.5, layoutId: "chart-insight",
      themeId: "colliers-default-v1", themeVersion: 2, layoutVersion: 1,
      elements: [{ kind: "chart", x: 1, y: 1, w: 10, h: 5, chartType: "line",
        categories: ["Q1", "Q2"], series: [{ name: "样本 A", values: [100, null], unit: "RMB/m²" }] }],
    } }],
  workspace: { context: { buildingIds: [buildingId], period: "2026-Q3", language: "zh" }, page_settings: {}, active_slide: pageId },
  history: [], exports: [], tasks: [],
});
const refreshed = { ...detail, project: { ...detail.project, version: version + 1 } };
const planBase = { id: planId, projectId, expectedVersion: version, basePageVersions: [{ id: pageId, version: 2 }] };
const chartPlan = { ...planBase, pages: [{ id: pageId, chartPresentation: [{ blockIndex: 0, type: "column" }] }] };
const chartCommand = { action: "apply_modification", plan: chartPlan, scope: "selected" };
const period = { year: 2026, quarter: 3 };
const refreshPlan = { ...planBase, pages: [{ id: pageId }], refresh: { id: planId, version: 1, contextFingerprint: fingerprint } };
const quarterCommand = { action: "apply_data_refresh", projectId, slideId: pageId, expectedVersion: version, period, fingerprint };

function setup(reply: Record<string, unknown> | ((input: Record<string, unknown>) => unknown), question: string,
  apply: (input: Record<string, unknown>) => unknown = () => refreshed, workspace: WorkspaceDetail = detail, objectIds: string[] = []) {
  const user = userEvent.setup();
  const call = vi.fn(async (input: Record<string, unknown>) => input.action === "proposal_revision"
    ? typeof reply === "function" ? reply(input) : reply
    : apply(input));
  const onApplied = vi.fn();
  const onOpenData = vi.fn();
  const onAppend = vi.fn();
  const onGenerated = vi.fn(async () => {});
  render(<ProposalRevision call={call as unknown as Call} detail={workspace} question={question} active={pageId}
    selected={[]} objectIds={objectIds} disabled={false} onApplied={onApplied} onOpenData={onOpenData} onAppend={onAppend} onGenerated={onGenerated} />);
  return { user, call, onApplied, onOpenData, onAppend, onGenerated };
}

it("shows a reviewed chart format change before applying the exact versioned transaction", async () => {
  const question = "将折线图改为柱状图";
  const { user, call, onApplied } = setup({
    status: "ready", scope: "selected", plan: chartPlan, gaps: [], command: chartCommand,
    chartPreview: [{ pageId, blockIndex: 0, from: "line", type: "column" }],
  }, question);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText("样本 A · 折线图 → 柱状图")).toBeInTheDocument();
  expect(screen.getByText("影响 1 页")).toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "应用修改" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith(refreshed, version));
  expect(call.mock.calls[1][0]).toEqual(chartCommand);
});

it("withholds a chart transaction whose affected changes do not match the review", async () => {
  const { user, call } = setup({
    status: "ready", scope: "selected", plan: chartPlan, gaps: [], command: chartCommand,
    chartPreview: [{ pageId, blockIndex: 0, from: "bar", type: "column" }],
  }, "将折线图改为柱状图");
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  await screen.findByText(/无法生成可应用的修改/);
  expect(screen.queryByRole("button", { name: "应用修改" })).not.toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
});

const duplicatePage = "66666666-6666-4666-8666-666666666666";
const closingPage = "77777777-7777-4777-8777-777777777777";
const shorteningWorkspace = {
  ...detail, slides: [detail.slides[0],
    { ...detail.slides[0], id: duplicatePage, content: { ...content, title: "重复市场说明" } },
    { ...detail.slides[0], id: closingPage, content: { ...content, title: "下一步" } },
  ],
};
const shorteningPlan = { ...planBase,
  basePageVersions: shorteningWorkspace.slides.map(slide => ({ id: slide.id, version: 2 })),
  pages: [{ id: pageId }, { id: closingPage }],
};
const shorteningCommand = { action: "apply_modification", scope: "document", plan: shorteningPlan };
const shorteningPreview = { originalPageCount: 3, pageCount: 2, removed: [{ pageId: duplicatePage, title: "重复市场说明" }] };
const shortened = { ...refreshed, slides: shorteningWorkspace.slides.filter(slide => slide.id !== duplicatePage) };

it("shows the reviewed slide count and exact removed page before applying a shorter deck", async () => {
  const { user, call, onApplied } = setup({ status: "ready", scope: "document", gaps: [], plan: shorteningPlan,
    command: shorteningCommand, shorteningPreview }, "把整套提案精简到2页", () => shortened, shorteningWorkspace);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText("从 3 页精简至 2 页")).toBeInTheDocument();
  expect(screen.getByText("移除第 2 页 · 重复市场说明")).toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "应用修改" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith(shortened, version));
  expect(call.mock.calls[1][0]).toEqual(shorteningCommand);
});

it("withholds a shortening transaction when its listed removal differs from the saved deck", async () => {
  const { user, call } = setup({ status: "ready", scope: "document", gaps: [], plan: shorteningPlan,
    command: shorteningCommand, shorteningPreview: { ...shorteningPreview, removed: [{ pageId: closingPage, title: "下一步" }] },
  }, "把整套提案精简到2页", () => refreshed, shorteningWorkspace);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText(/无法生成可应用的修改/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "应用修改" })).not.toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
});

it("shows formal before and after values and applies the reviewed quarter without leaving AI review", async () => {
  const value = (dataAsOf: string, rent: number) => ({
    dataAsOf, blocks: [{ kind: "metric", label: "平均净有效租金", unit: "元/㎡/月", value: rent }],
  });
  const { user, call, onApplied, onOpenData } = setup({
    status: "ready", scope: "selected", plan: refreshPlan, gaps: [], command: quarterCommand,
    review: { projectVersion: version, fingerprint, changed: true, needsConclusionReview: true, period,
      changes: [{ slideId: pageId, changed: true, before: value("2026-06-30", 100), after: value("2026-09-30", 120) }] },
  }, "把这页更新到2026-Q3");
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText("100 元/㎡/月")).toBeInTheDocument();
  expect(screen.getByText("120 元/㎡/月")).toBeInTheDocument();
  expect(screen.getByText("应用后请复核相关分析结论。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "应用修改" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith(refreshed, version));
  expect(call.mock.calls[1][0]).toEqual(quarterCommand);
  expect(onOpenData).not.toHaveBeenCalled();
});

it("passes the server-resolved quarter to the data inspector when an individual review is required", async () => {
  const { user, call, onOpenData } = setup({
    status: "refresh-review", scope: "document", plan: refreshPlan, gaps: [],
    refreshPlan: { brief: { period: "2026-Q3" } },
  }, "把报告更新到最新季度");
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText(/正式季度 2026-Q3/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开数据检查器" }));
  expect(onOpenData).toHaveBeenCalledWith("2026-Q3");
  expect(call).toHaveBeenCalledTimes(1);
});

it("generates the approved new market edition from the exact reviewed request", async () => {
  const workspace = { ...detail, workspace: { ...detail.workspace, context: { ...detail.workspace.context,
    business: "market-report", period: "2026-Q2", buildingIds: [],
  } } };
  const input = { question: "最新正式季度的北京写字楼市场报告", projectId, city: "北京", buildingIds: [], assetIds: [],
    language: "zh", audience: "internal" };
  const reply = { status: "refresh-review", scope: "document", plan: refreshPlan, gaps: [], regeneration: input,
    refreshPlan: { status: "ready", selection: "none", plan: { id: planId, title: "获权市场报告", version: 1, contextFingerprint: fingerprint,
      slides: [{ id: pageId, title: "季度市场摘要" }], gaps: [] },
    brief: { city: "北京", submarkets: [], period: "2026-Q3", buildingIds: [], language: "zh", scenario: "market-report" } } };
  const { user, call, onApplied, onGenerated } = setup(reply, "把整套报告更新到最新季度", command => ({
    taskId: (command.confirmation as { taskId: string }).taskId, projectId: competitor.id, state: "completed",
  }), workspace);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText("季度市场摘要")).toBeInTheDocument();
  expect(screen.getByText(/北京.*2026-Q3.*1 页/)).toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "确认并生成新版 Pitch" }));
  await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(competitor.id));
  expect(call.mock.calls[1][0]).toEqual({ action: "proposal_generate", confirmation: { taskId: expect.any(String),
    projectId, expectedVersion: version, planId, contextFingerprint: fingerprint, request: input } });
  expect(onApplied).not.toHaveBeenCalled();
});

it("shows the new client and keeps the saved quarterly shortlist in the exact confirmation", async () => {
  const workspace = { ...detail, workspace: { ...detail.workspace, context: { ...detail.workspace.context,
    business: "site-selection", period: "2026-Q3", client: "原客户",
  } } };
  const input = { question: "面向「保险企业」的选址提案，2026-Q3", projectId, city: "北京", buildingIds: [buildingId],
    language: "zh", audience: "internal", period: "2026-Q3" };
  const reply = { status: "refresh-review", scope: "document", plan: refreshPlan, gaps: [], regeneration: input,
    refreshPlan: { status: "ready", selection: "explicit", plan: { id: planId, title: "保险企业选址提案", version: 1,
      contextFingerprint: fingerprint, slides: [{ id: pageId, title: "客户选址要求", pageKind: "requirements" }], gaps: [] },
    brief: { city: "北京", submarkets: [], period: "2026-Q3", buildingIds: [buildingId], language: "zh",
      scenario: "site-selection", targetClient: "保险企业" } } };
  const { user, call, onGenerated } = setup(reply, "整套面向保险企业", command => ({
    taskId: (command.confirmation as { taskId: string }).taskId, projectId: competitor.id, state: "completed",
  }), workspace);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText("生成衍生项目 · 2026-Q3 · 中文 · 保险企业")).toBeInTheDocument();
  expect(screen.getByText("客户选址要求")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "确认并生成新版 Pitch" }));
  await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(competitor.id));
  expect(call.mock.calls[1][0]).toMatchObject({ action: "proposal_generate", confirmation: { request: input, expectedVersion: version } });
});

const comparisonIds = [buildingId, competitor.id];
const comparisonCommand = { action: "add_to_pitch", taskId: planId, fingerprint, target: { mode: "append", expectedVersion: version },
  handoff: { projectId, period: "2026-Q3", language: "zh", source: { kind: "buildings", buildingIds: comparisonIds } } };
const comparisonReply = { status: "ready", mode: "append-comparison", scope: "document", command: comparisonCommand,
  review: { status: "ready", competitor, fingerprint, buildingIds: comparisonIds, period: "2026-Q3", language: "zh",
    pages: [{ title: "竞品对比", sources: content.sources, blocks: [{ kind: "table", columns: ["楼宇", "租金"],
      rows: [["办公楼甲", 103], [competitor.name, 115]], sourceIds: [content.sources[0].id] }] }] } };

it("disambiguates an authorized competitor and retries the exact reviewed append after an uncertain receipt", async () => {
  const queued = { id: planId, state: "queued" };
  const apply = vi.fn().mockRejectedValueOnce(new WorkspaceError("暂时无法查询任务状态。", 503)).mockResolvedValueOnce(queued);
  const { user, call, onAppend, onApplied } = setup(input => {
    const request = input.input as { competitorBuildingId?: string };
    return request.competitorBuildingId === competitor.id ? comparisonReply
      : { status: "clarification", message: "请选择获权楼宇", candidates: [competitor, { id: pageId, name: "五矿广场", submarket: "CBD" }] };
  }, "增加一个真实竞品五矿广场", apply);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  await user.click(await screen.findByRole("button", { name: "五矿广场 · 东二环" }));
  expect(await screen.findByRole("cell", { name: "115" })).toBeInTheDocument();
  expect(screen.getByText("五矿广场 · 2026-Q3 · 追加 1 页")).toBeInTheDocument();
  expect(onAppend).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "追加对比页" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法查询任务状态");
  await user.click(screen.getByRole("button", { name: "继续追加" }));
  await waitFor(() => expect(onAppend).toHaveBeenCalledWith(queued, version));
  expect(call.mock.calls.slice(2).map(([command]) => command)).toEqual([comparisonCommand, comparisonCommand]);
  expect(onApplied).not.toHaveBeenCalled();
});

it("withholds a competitor append when the command and reviewed building scope differ", async () => {
  const { user, call } = setup({ ...comparisonReply, command: { ...comparisonCommand,
    handoff: { ...comparisonCommand.handoff, source: { ...comparisonCommand.handoff.source, buildingIds: [buildingId, pageId] } },
  } }, "追加真实竞品五矿广场");
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText(/无法生成可应用的修改/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "追加对比页" })).not.toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
});

const photoKey = (number: number) => `dbe5662b-9748-40bc-a55a-${String(number).padStart(12, "0")}`;
const selectedPhoto = "object-17";
const photoQuestion = "把所选对象换用楼宇大堂照片";

function buildingPhoto(number: number, caption: string, building = buildingId) {
  const versionHash = String(number).repeat(64);
  const contentHash = String(number + 1).repeat(64);
  const source = {
    id: photoKey(number + 10), recordId: photoKey(number + 20), kind: "record",
    version: versionHash, sha256: contentHash, label: "核验的楼宇照片档案", locator: "楼宇照片目录", dataAsOf: "2026-11-20",
    visual: { id: photoKey(number), version: 3, versionHash, contentHash, kind: "photo", buildingIds: [building],
      origin: { type: "building-photo", buildingId: building, photoId: photoKey(number + 20) } },
  };
  return { caption, pin: source.visual, source };
}

const exterior = buildingPhoto(4, "主入口外立面");
const lobby = buildingPhoto(6, "首层大堂");
const photoInput = {
  projectId, expectedVersion: version, question: photoQuestion, currentPageId: pageId, pageIds: [], objectIds: [selectedPhoto],
};
const photoCommand = { action: "proposal_apply_photo", confirmation: { input: photoInput, fingerprint } };
const photoChange = { pageId, pageVersion: 8, objectId: selectedPhoto, buildingId,
  before: { caption: exterior.caption, pin: exterior.pin },
  after: { caption: lobby.caption, pin: lobby.pin, category: "lobby", sourceLabel: lobby.source.label } };
const photoReply = { status: "photo-review", projectId, projectVersion: version, fingerprint, changes: [photoChange], command: photoCommand };

function photoWorkspace(photo: typeof exterior, projectVersion = version) {
  const { pin, caption, source } = photo;
  const asset = { mediaAssetId: pin.id, mediaVersion: pin.version, alt: caption };
  return workspaceDetailSchema.parse({
    ...detail,
    project: { ...detail.project, version: projectVersion },
    slides: [{
      ...detail.slides[0], content: { ...content, title: "楼宇概况", isTestData: false, sources: [source],
        blocks: [{ kind: "image", ...asset, sourceIds: [source.id] }] },
      scene: { ...detail.slides[0].scene, layoutId: "image-text",
        elements: [{ kind: "image", ...asset, editorId: selectedPhoto, x: 2, y: 1, w: 6, h: 5 }] },
    }],
  });
}

it("reviews a pinned photo on the selected object, then applies the exact AI command", async () => {
  const applied = photoWorkspace(lobby, version + 1);
  const { user, call, onApplied } = setup(photoReply, photoQuestion, () => ({ status: "photo-applied", workspace: applied }),
    photoWorkspace(exterior), [selectedPhoto]);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByRole("dialog", { name: "核对 AI 修改" })).toHaveTextContent("同楼宇实景换图 · 影响 1 页");
  expect(screen.getByText("第 1 页 · 楼宇概况")).toBeInTheDocument();
  expect(screen.getByText("主入口外立面")).toBeInTheDocument();
  expect(screen.getByText("首层大堂")).toBeInTheDocument();
  expect(screen.getByText("核验的楼宇照片档案")).toBeInTheDocument();
  expect(onApplied).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认换图" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith(applied, version));
  expect(call.mock.calls.map(([command]) => command)).toEqual([{ action: "proposal_revision", input: photoInput }, photoCommand]);
});

it.each([
  { ...photoReply, changes: [{ ...photoChange, objectId: "object-18" }] },
  { ...photoReply, changes: [{ ...photoChange, after: { ...photoChange.after, pin: buildingPhoto(8, "其他楼宇大堂", competitor.id).pin } }] },
  { ...photoReply, command: { ...photoCommand, confirmation: { ...photoCommand.confirmation, fingerprint: "f".repeat(64) } } },
])("withholds a photo review outside its pinned selection or confirmation", async reply => {
  const { user, call } = setup(reply, photoQuestion, undefined, photoWorkspace(exterior), [selectedPhoto]);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByRole("status")).toHaveTextContent("无法生成可应用的修改");
  expect(screen.queryByRole("button", { name: "确认换图" })).not.toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
});

it("requires the saved workspace to contain the reviewed version and source", async () => {
  const unrelatedReceipt = { status: "photo-applied", workspace: photoWorkspace(exterior, version + 1) };
  const { user, onApplied } = setup(photoReply, photoQuestion, () => unrelatedReceipt, photoWorkspace(exterior), [selectedPhoto]);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  await user.click(await screen.findByRole("button", { name: "确认换图" }));
  expect(await screen.findByRole("status")).toHaveTextContent("无法核对保存后的照片");
  expect(onApplied).not.toHaveBeenCalled();
});

it("collects a missing translation before reviewing and applying a language change to the same page", async () => {
  const question = "本页改成英文";
  const original = { ...detail, slides: [{ ...detail.slides[0], version: 2,
    content: { ...detail.slides[0].content, locale: "zh", title: "季度租金" } }] };
  const languageTexts = [{ pageId, ref: "title", text: "Quarterly rent" }];
  const command = { action: "proposal_apply_language", confirmation: { fingerprint, input: {
    projectId, expectedVersion: version, question, currentPageId: pageId, pageIds: [], objectIds: [], languageTexts,
  } } };
  const updated = { ...original, project: refreshed.project, slides: [{ ...original.slides[0], version: 3,
    content: { ...original.slides[0].content, locale: "en", title: "Quarterly rent" } }] };
  const review = languageReviewSchema.parse({ status: "language-review", language: "en", projectVersion: version, fingerprint, command,
    translated: [{ pageId, pageVersion: 2, original: "zh", changes: [{ ref: "title", before: "季度租金", after: "Quarterly rent" }] }] });
  const wrongNumericReceipt = structuredClone(updated);
  const chart = wrongNumericReceipt.slides[0].content.blocks.find(block => block.kind === "chart");
  if (chart?.kind !== "chart") throw new Error("Expected a chart in the fixture.");
  chart.series[0].values[0] = 999;
  expect(matchesAppliedLanguage(review, original, wrongNumericReceipt)).toBe(false);

  const { user, call, onApplied } = setup(input => {
    if (!(input.input as { languageTexts?: unknown }).languageTexts) {
      return { status: "language-translation-required", language: "en", translated: [],
        pending: [{ pageId, pageVersion: 2, ref: "title", text: "季度租金" }] };
    }
    return review;
  }, question, () => ({ status: "language-applied", workspace: updated }), original);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  await user.type(await screen.findByRole("textbox", { name: "第 1 页 · 季度租金" }), languageTexts[0].text);
  await user.click(screen.getByRole("button", { name: "预览译文" }));
  await screen.findByText("Quarterly rent");
  expect(onApplied).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认语言切换" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith(updated, version));
  expect(call.mock.calls[2][0]).toEqual(command);
});

it("queries the exact canvas object and confirms the selected replacement category", async () => {
  const workspace = photoWorkspace(exterior);
  const saved = photoWorkspace(lobby, version + 1);
  const call = vi.fn(async (command: Record<string, unknown>) => {
    if (command.action === "proposal_apply_photo") return { status: "photo-applied", workspace: saved };
    const input = command.input as typeof photoInput;
    if (input.question !== photoQuestion) return { status: "unavailable", message: "请选择已登记的图片类型。" };
    return { ...photoReply, command: { ...photoCommand, confirmation: { input, fingerprint } } };
  });
  const onApplied = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<PhotoReplacementPicker call={call as unknown as Call} detail={workspace} pageId={pageId}
    objectId={selectedPhoto} onApplied={onApplied} onClose={onClose} />);
  expect(await screen.findByText("请选择已登记的图片类型。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认换图" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("备选照片类型"), "lobby");
  expect(await screen.findByText(lobby.caption)).toBeInTheDocument();
  expect(screen.getByText("备选照片预览")).toBeInTheDocument();
  expect(call.mock.calls[1][0]).toEqual({ action: "proposal_revision", input: photoInput });
  expect(onApplied).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认换图" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith(saved, version));
  expect(call.mock.calls[2][0]).toEqual(photoCommand);
  expect(onClose).toHaveBeenCalledOnce();
});

it("checks an explicit photo category before offering confirmation", async () => {
  const call = vi.fn(async (command: Record<string, unknown>) => ({
    ...photoReply, command: { ...photoCommand, confirmation: { input: command.input, fingerprint } },
  }));
  render(<PhotoReplacementPicker call={call as unknown as Call} detail={photoWorkspace(exterior)} pageId={pageId}
    objectId={selectedPhoto} onApplied={vi.fn()} onClose={vi.fn()} />);
  await screen.findByRole("button", { name: "确认换图" });
  await userEvent.selectOptions(screen.getByLabelText("备选照片类型"), "exterior");
  expect(await screen.findByText("无法核对这张备选照片，请重新查询。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认换图" })).not.toBeInTheDocument();
});

it.each([
  ["图片全部换成楼宇外观", "整套提案换用楼宇外立面照片"],
  ["把整套PPT改得更简洁", "整套提案精简"],
])("keeps an explicit deck request at document scope even while an object is selected", async (text, command) => {
  const { user, call } = setup({ status: "unavailable", message: "没有适用的修改。" }, text, undefined, photoWorkspace(exterior), [selectedPhoto]);
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  expect(await screen.findByText("没有适用的修改。")).toBeInTheDocument();
  expect(call.mock.calls[0][0]).toEqual({ action: "proposal_revision", input: {
    projectId, expectedVersion: version, question: command, currentPageId: pageId, pageIds: [], objectIds: [],
  } });
});
