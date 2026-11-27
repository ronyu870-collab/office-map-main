import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SharePanel } from "./SharePanel";
import type { Call } from "./client";

afterEach(cleanup);

it("retries the same creation receipt, copies the frozen link and revokes it", async () => {
  userEvent.setup();
  const receipt = {
    id: "", version: 7, createdAt: "2026-11-27T00:00:00.000Z", pageIds: ["one"], expiresAt: null, revokedAt: null,
  };
  const calls = vi.fn(async (input: Record<string, unknown>) => {
    switch (input.action) {
      case "shares": return [];
      case "share_create":
        if (!receipt.id) {
          receipt.id = String(input.shareId);
          throw new Error("aborted");
        }
        return receipt;
      case "share_revoke": return { ...receipt, revokedAt: "2026-11-27T01:00:00.000Z" };
    }
  });
  render(<SharePanel projectId="project" version={7} active="two" selected={["one"]} pageIds={["one", "two"]}
    call={calls as Call} canCreate />);
  fireEvent.click(screen.getByRole("button", { name: "共享" }));
  await screen.findByText("暂无共享链接。");
  fireEvent.change(screen.getByLabelText("收件账号邮箱"), { target: { value: "VIEWER@EXAMPLE.TEST" } });
  fireEvent.change(screen.getByLabelText("共享范围"), { target: { value: "selected" } });
  fireEvent.click(screen.getByRole("button", { name: "创建只读链接" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("使用原账号和页面范围重试");
  fireEvent.click(screen.getByRole("button", { name: "创建只读链接" }));
  const link = location.origin + "/intelligence/pitch/shared/" + receipt.id;
  expect(await screen.findByRole("textbox", { name: "共享链接" })).toHaveValue(link);
  expect(calls.mock.calls[1][0]).toMatchObject({ expectedVersion: 7, recipientEmail: "viewer@example.test", slideIds: ["one"] });
  expect(calls.mock.calls[2]).toEqual(calls.mock.calls[1]);
  fireEvent.click(screen.getByRole("button", { name: "复制链接" }));
  expect(await screen.findByText("已复制链接。")).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toBe(link);
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
  expect(await screen.findByText("已撤销共享。")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "共享链接" })).not.toBeInTheDocument();
  expect(calls).toHaveBeenLastCalledWith({ action: "share_revoke", projectId: "project", shareId: receipt.id }, true);
});
