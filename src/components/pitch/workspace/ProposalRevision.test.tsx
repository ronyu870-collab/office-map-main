import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { layoutFixture } from "@/src/lib/pitch/fixtures/layouts";
import { workspaceDetailSchema } from "@/src/lib/pitch/workspace/protocol";
import { ProposalRevision } from "./ProposalRevision";
import type { Call } from "./client";

afterEach(cleanup);
const projectId = "11111111-1111-4111-8111-111111111111";
const pageId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
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
  workspace: { context: {}, page_settings: {}, active_slide: pageId },
  history: [], exports: [], tasks: [],
});
const refreshed = { ...detail, project: { ...detail.project, version: version + 1 } };
const planBase = { id: planId, projectId, expectedVersion: version, basePageVersions: [{ id: pageId, version: 2 }] };
const chartPlan = { ...planBase, pages: [{ id: pageId, chartPresentation: [{ blockIndex: 0, type: "column" }] }] };
const chartCommand = { action: "apply_modification", plan: chartPlan, scope: "selected" };
const period = { year: 2026, quarter: 3 };
const refreshPlan = { ...planBase, pages: [{ id: pageId }], refresh: { id: planId, version: 1, contextFingerprint: fingerprint } };
const quarterCommand = { action: "apply_data_refresh", projectId, slideId: pageId, expectedVersion: version, period, fingerprint };

function setup(reply: Record<string, unknown>, question: string) {
  const user = userEvent.setup();
  const call = vi.fn(async (input: Record<string, unknown>) => input.action === "proposal_revision" ? reply : refreshed);
  const onApplied = vi.fn();
  const onOpenData = vi.fn();
  render(<ProposalRevision call={call as unknown as Call} detail={detail} question={question} active={pageId}
    selected={[]} objectIds={[]} disabled={false} onApplied={onApplied} onOpenData={onOpenData} />);
  return { user, call, onApplied, onOpenData };
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
