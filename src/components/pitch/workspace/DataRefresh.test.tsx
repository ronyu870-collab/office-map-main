import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import type { Call } from "./client";
import { DataRefresh } from "./DataRefresh";

afterEach(cleanup);

const id = "11111111-1111-4111-8111-111111111111";
const slideId = "22222222-2222-4222-8222-222222222222";
const fingerprint = "a".repeat(64);

it("reads a server binding, then sends the reviewed quarter and fingerprint on apply", async () => {
  const user = userEvent.setup();
  const expectedVersion = 3;
  const workspace = {
    project: { id, version: expectedVersion, title: "项目", theme_id: "theme", theme_version: 1,
      organization_id: "org", region: "北京", city: "北京", business_line: "office" },
    workspace: { context: {}, page_settings: {}, active_slide: null },
    slides: [], tasks: [], exports: [], history: [],
  } as unknown as WorkspaceDetail;
  const revision = (dataAsOf: string, value: number) => ({
    dataAsOf, blocks: [
      { kind: "metric", label: "平均净有效租金", unit: "元/㎡/月", value },
      { kind: "chart", chartType: "line", categories: ["CBD"],
        series: [{ name: "季度租金", unit: "元/㎡/月", values: [value] }] },
    ],
  });
  const reply = {
    projectVersion: expectedVersion, fingerprint, changed: true, needsConclusionReview: true,
    period: { year: 2026, quarter: 4 },
    changes: [{ slideId, changed: true, before: revision("2026-09-30", 350), after: revision("2026-12-31", 392) }],
  };
  const call = vi.fn(async (input: Record<string, unknown>) => {
    if (input.action === "document_bindings") {
      return { projectVersion: expectedVersion, pages: [{ id: slideId,
        objects: [{ valueOrigin: "business", binding: { domain: "quarter", dataAsOf: "2026-09-30" },
          query: { period: { year: 2026, quarter: 3 } } }] }] };
    }
    if (input.action === "preview_data_refresh") return reply;
    return { ...workspace, project: { ...workspace.project, version: expectedVersion + 1 } };
  }) as unknown as Call;
  const onApplied = vi.fn();
  render(<DataRefresh call={call} detail={workspace} slideId={slideId} disabled={false} onApplied={onApplied} />);
  const quarter = await screen.findByLabelText("目标季度");
  await user.type(quarter, "2026-Q4");
  await user.click(screen.getByRole("button", { name: "预览数据更新" }));
  await screen.findByRole("dialog", { name: "核对数据更新" });
  expect(screen.getByText("350 元/㎡/月")).toBeInTheDocument();
  expect(screen.getByText("392 元/㎡/月")).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader", { name: "季度租金（元/㎡/月）" })).toHaveLength(2);
  expect(screen.getByRole("cell", { name: "350" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "392" })).toBeInTheDocument();
  expect(screen.getByText("应用后请复核相关分析结论。")).toBeInTheDocument();
  expect(vi.mocked(call).mock.calls.some(([data]) => data.action === "apply_data_refresh")).toBe(false);
  await user.click(screen.getByRole("button", { name: "应用数据更新" }));
  expect(vi.mocked(call).mock.calls.at(-1)?.[0]).toEqual({
    action: "apply_data_refresh", projectId: id, slideId, expectedVersion,
    period: { year: 2026, quarter: 4 }, fingerprint,
  });
  expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({
    project: expect.objectContaining({ version: expectedVersion + 1 }),
  }), expectedVersion);
});
