import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { ExportPanel } from "./ExportPanel";
import { WorkspaceError, type Call } from "./client";

const projectId = "10000000-0000-4000-8000-000000000000";
const first = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
const detail = {
  project: { id: projectId, version: 3 },
  slides: [{ id: first, content: { title: "楼宇介绍" } }, { id: second, content: { title: "内部数据" } }],
  exports: [],
} as unknown as WorkspaceDetail;

afterEach(cleanup);

it("shows page-specific disclosure limits, then exports the explicitly selected PDF range", async () => {
  const user = userEvent.setup();
  const requests: Record<string, unknown>[] = [];
  const call = vi.fn(async (input: Record<string, unknown>) => {
    requests.push(input);
    if (input.action === "export_eligibility") {
      return { projectVersion: 3, audienceAllowed: true, pages: [
        { id: first, position: 1, reasons: [] },
        { id: second, position: 2, reasons: input.audience === "client" ? ["internal_only", "source_permission"] : [] },
      ] };
    }
    return { state: "ready", progress: 100, filename: "楼宇介绍.pdf" };
  }) as unknown as Call;
  render(<ExportPanel call={call} detail={detail} active={first} selected={[second]}
    flush={async () => detail} canClient disabled={false} />);
  await user.click(screen.getByRole("button", { name: "导出" }));
  await user.selectOptions(screen.getByLabelText("使用范围"), "client");
  expect(await screen.findByText(/第 2 页 内部数据.*页面仅供内部使用/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成文件" })).toBeDisabled();
  expect(requests.some(input => input.action === "export_start")).toBe(false);

  await user.selectOptions(screen.getByLabelText("页面范围"), "current");
  await user.selectOptions(screen.getByLabelText("文件格式"), "pdf");
  await user.click(screen.getByRole("button", { name: "生成文件" }));
  expect(await screen.findByRole("button", { name: "下载已生成文件" })).toBeEnabled();
  expect(requests.find(input => input.action === "export_start")).toMatchObject({
    projectId, audience: "client", format: "pdf", pages: [0],
  });
}, 45000);

it("starts no duplicate export when retrying an unacknowledged request", async () => {
  const user = userEvent.setup();
  const starts: unknown[] = [];
  const call = vi.fn(async (input: Record<string, unknown>) => {
    if (input.action === "export_eligibility") return { projectVersion: 3, audienceAllowed: true, pages: [] };
    starts.push(input.exportId);
    if (starts.length === 1) throw new TypeError("连接中断");
    return { state: "ready", progress: 100, filename: "提案.pptx" };
  }) as unknown as Call;
  render(<ExportPanel call={call} detail={detail} active={first} selected={[]}
    flush={async () => detail} canClient={false} disabled={false} />);
  await user.click(screen.getByRole("button", { name: "导出" }));
  const create = screen.getByRole("button", { name: "生成文件" });
  await waitFor(() => expect(create).toBeEnabled());
  await user.click(create);
  expect(await screen.findByRole("alert")).toHaveTextContent("连接中断");
  await user.click(create);
  expect(await screen.findByRole("button", { name: "下载已生成文件" })).toBeEnabled();
  expect(starts).toHaveLength(2);
  expect(starts[0]).toBe(starts[1]);
}, 45000);

it("only offers the ready file for the currently selected format and pages", async () => {
  const user = userEvent.setup();
  const call = vi.fn(async (input: Record<string, unknown>) => input.action === "export_eligibility"
    ? { projectVersion: 3, audienceAllowed: true, pages: [] }
    : { state: "ready", progress: 100, filename: `提案.${input.format}` });
  render(<ExportPanel call={call as unknown as Call} detail={detail} active={first} selected={[]}
    flush={async () => detail} canClient={false} disabled={false} />);
  await user.click(screen.getByRole("button", { name: "导出" }));
  const generate = screen.getByRole("button", { name: "生成文件" });
  await waitFor(() => expect(generate).toBeEnabled());
  await user.click(generate);
  const download = screen.getByRole("button", { name: "下载已生成文件" });
  await waitFor(() => expect(download).toBeEnabled());

  await user.selectOptions(screen.getByLabelText("文件格式"), "pdf");
  expect(download).not.toBeInTheDocument();
  await user.click(generate);
  await waitFor(() => expect(download).toBeEnabled());
  expect(call.mock.calls.at(-1)?.[0]).toMatchObject({ action: "export_start", format: "pdf" });

  await user.selectOptions(screen.getByLabelText("页面范围"), "current");
  expect(download).not.toBeInTheDocument();
}, 45000);

it("requires a fresh review after a concurrent export conflict and preserves the selected page ID", async () => {
  const user = userEvent.setup();
  let serverVersion = 3;
  const advanced = {
    ...detail,
    project: { ...detail.project, version: 4 },
    slides: [detail.slides[1], detail.slides[0]],
  };
  const call = vi.fn(async (input: Record<string, unknown>) => {
    if (input.action === "export_eligibility") return { projectVersion: serverVersion, audienceAllowed: true, pages: [] };
    if (serverVersion === 3) {
      serverVersion = 4;
      throw new WorkspaceError("版本冲突", 409);
    }
    return { state: "ready", progress: 100, filename: "楼宇介绍.pptx" };
  });
  const panel = (project: WorkspaceDetail) => <ExportPanel call={call as unknown as Call} detail={project}
    active={first} selected={[first]} flush={async () => project} canClient={false} disabled={false} />;
  const view = render(panel(detail));
  await user.click(screen.getByRole("button", { name: "导出" }));
  await user.selectOptions(screen.getByLabelText("页面范围"), "selected");
  const generate = screen.getByRole("button", { name: "生成文件" });
  await waitFor(() => expect(generate).toBeEnabled());
  await user.click(generate);
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent("项目已在其他窗口更新。请重新打开项目后再导出。");
    expect(call.mock.calls.filter(([command]) => command.action === "export_eligibility")).toHaveLength(2);
  });
  expect(generate).toBeDisabled();
  expect(screen.queryByRole("button", { name: "下载已生成文件" })).not.toBeInTheDocument();

  view.rerender(panel(advanced));
  await waitFor(() => expect(generate).toBeEnabled());
  await user.click(generate);
  expect(await screen.findByRole("button", { name: "下载已生成文件" })).toBeEnabled();
  const starts = call.mock.calls.map(([command]) => command).filter(command => command.action === "export_start");
  expect(starts.map(command => command.expectedVersion)).toEqual([3, 4]);
  expect(starts.map(command => command.pages)).toEqual([[0], [1]]);
  expect(starts[0].exportId).not.toEqual(starts[1].exportId);
});
