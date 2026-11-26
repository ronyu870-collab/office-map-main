import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { ExportPanel } from "./ExportPanel";
import type { Call } from "./client";

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
