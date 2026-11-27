import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { layoutFixture } from "@/src/lib/pitch/fixtures/layouts";
import { workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { ProposalRevision } from "./ProposalRevision";
import { WorkspaceError, type Call } from "./client";

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
  apply: (input: Record<string, unknown>) => unknown = () => refreshed, workspace: WorkspaceDetail = detail) {
  const user = userEvent.setup();
  const call = vi.fn(async (input: Record<string, unknown>) => input.action === "proposal_revision"
    ? typeof reply === "function" ? reply(input) : reply
    : apply(input));
  const onApplied = vi.fn();
  const onOpenData = vi.fn();
  const onAppend = vi.fn();
  const onGenerated = vi.fn(async () => {});
  render(<ProposalRevision call={call as unknown as Call} detail={workspace} question={question} active={pageId}
    selected={[]} objectIds={[]} disabled={false} onApplied={onApplied} onOpenData={onOpenData} onAppend={onAppend} onGenerated={onGenerated} />);
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
    brief: { city: "北京", submarkets: [], period: "2026-Q3", buildingIds: [], language: "zh" } } };
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
