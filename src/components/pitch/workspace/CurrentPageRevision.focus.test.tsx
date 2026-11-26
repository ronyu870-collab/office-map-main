import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CurrentPageRevision } from "./CurrentPageRevision";
import { WorkspaceError, type Call } from "./client";

const target = { projectId: "11111111-1111-4111-8111-111111111111", slideId: "22222222-2222-4222-8222-222222222222", expectedVersion: 5 };
const receipt = { id: "33333333-3333-4333-8333-333333333333", state: "completed", authorized: true, error_code: null };
function Fixture({ call }: { call: Call }) {
  const [batchId, rememberBatch] = React.useState<string>();
  return <CurrentPageRevision call={call} target={target} batchId={batchId} rememberBatch={rememberBatch}
    onCanvasSaved={() => {}} />;
}
it("starts a single scoped task from this page only on explicit click and recovers the same receipt after a timeout", async () => {
  const call = vi.fn(async (command: Record<string, unknown>) => {
    if (command.action === "start_canvas_text") throw new WorkspaceError("gateway timeout", 503);
    return { tasks: [receipt] };
  });
  render(<Fixture call={call as Call} />);
  expect(call).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "修订本页文字" }));
  expect(await screen.findByRole("button", { name: "查看修改前后" })).toBeInTheDocument();
  const [start, status] = call.mock.calls.map(([command]) => command);
  expect(start).toMatchObject({ action: "start_canvas_text", ...target });
  expect(start).not.toHaveProperty("content");
  expect(status).toEqual({ action: "status", batchId: start.batchId });
  expect(call.mock.calls.filter(([command]) => command.action === "start_canvas_text")).toHaveLength(1);
});

it("reports missing authority without polling, and an unauthorized completed receipt cannot show text", async () => {
  const denied = vi.fn(async () => { throw new WorkspaceError("未启动模型", 403); });
  const first = render(<Fixture call={denied as Call} />);
  fireEvent.click(screen.getByRole("button", { name: "修订本页文字" }));
  expect(await screen.findByText("未启动模型")).toBeInTheDocument();
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
  first.unmount();
  const noAccess = vi.fn(async () => ({ tasks: [{ ...receipt, authorized: false }] }));
  render(<Fixture call={noAccess as Call} />);
  fireEvent.click(screen.getByRole("button", { name: "修订本页文字" }));
  expect(await screen.findByText("原素材权限已变化，不能预览或应用。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "查看修改前后" })).toBeNull();
});
