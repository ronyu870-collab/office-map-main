import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RevisionReview } from "./RevisionReview";
import { WorkspaceError, type Call } from "./client";
import type { RevisionPreview } from "@/src/lib/pitch/ai/revision-preview";

const taskId = "11111111-1111-4111-8111-111111111111";
const scope = { organizationId: "test", region: "CN", city: "Beijing", businessLine: "office" };
const destination = { scope, categoryId: "22222222-2222-4222-8222-222222222222" };
const receipt: RevisionPreview = {
  scope, fingerprint: "a".repeat(64), sourceVersion: 7, dataAsOf: "2026-09-30",
  beforeLanguage: "zh", afterLanguage: "zh", redacted: false, preservedBlocks: 2,
  changes: [{ id: "title", label: "标题", before: "保留原稿", after: "新的提案标题" }],
};

it("compares exact source and draft, with no save until explicit confirmation", async () => {
  const call = vi.fn(async (input: Record<string, unknown>) => input.action === "revision_preview" ? receipt : {});
  render(<RevisionReview taskId={taskId} call={call as Call} destination={destination} />);
  fireEvent.click(screen.getByText("查看修改前后"));
  expect(await screen.findByText("保留原稿")).toBeInTheDocument();
  expect(screen.getByText("新的提案标题")).toBeInTheDocument();
  expect(screen.getByText(/来源 v7/)).toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "暂不采用" }));
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("查看修改前后"));
  fireEvent.click(await screen.findByRole("button", { name: "保存为私有草稿" }));
  expect(await screen.findByText("已保存到素材库的私有草稿，原稿未改。")).toBeInTheDocument();
  expect(call).toHaveBeenLastCalledWith(expect.objectContaining({
    action: "materialize", taskId, revisionFingerprint: receipt.fingerprint, ...destination,
  }), true, "ai", expect.anything());
});

it("redacts original text and refuses mismatched scope before saving", async () => {
  const call = vi.fn(async () => ({ ...receipt, redacted: true, beforeLanguage: null,
    changes: [{ id: "approved:0", label: "获批脱敏片段", before: null, after: "Only approved text" }] }));
  render(<RevisionReview taskId={taskId} call={call as Call}
    destination={{ ...destination, scope: { ...scope, city: "Shanghai" } }} />);
  fireEvent.click(screen.getByText("查看修改前后"));
  expect(await screen.findByText("Only approved text")).toBeInTheDocument();
  expect(screen.queryByText("修改前")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存为私有草稿" })).toBeDisabled();
});

it("a stale source forces another read rather than repeating a save", async () => {
  const call = vi.fn(async (input: Record<string, unknown>) => {
    if (input.action === "revision_preview") return receipt;
    throw new WorkspaceError("资料版本已变化", 409);
  });
  render(<RevisionReview taskId={taskId} call={call as Call} destination={destination} />);
  fireEvent.click(screen.getByText("查看修改前后"));
  fireEvent.click(await screen.findByRole("button", { name: "保存为私有草稿" }));
  expect(await screen.findByText("资料版本已变化")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("保存为私有草稿")).not.toBeInTheDocument());
  expect(call.mock.calls.map(([input]) => input.action)).toEqual(["revision_preview", "materialize"]);
});

it("renders the selected-only proposal and the same selection is bound to save", async () => {
  const changes = [...receipt.changes,
    { id: "block:1", label: "正文段落 1", before: "留着这段", after: "不要应用这段" }];
  const all = { ...receipt, changes, selectedRefs: ["title", "block:1"] };
  const chosen = { ...all, selectedRefs: ["title"], fingerprint: "b".repeat(64),
    visual: { before: ["<svg/>"], after: ["<svg width='2'/>"] } };
  const call = vi.fn(async (input: Record<string, unknown>) => input.action === "revision_preview"
    ? (input.visual ? chosen : all) : {});
  render(<RevisionReview taskId={taskId} call={call as Call} destination={destination} />);
  fireEvent.click(screen.getByText("查看修改前后"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "采用正文段落 1" }));
  expect(screen.getByRole("button", { name: "保存为私有草稿" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "预览所选改动" }));
  expect(await screen.findByRole("img", { name: "仅采用所选改动第 1 页" })).toBeInTheDocument();
  expect(call).toHaveBeenLastCalledWith({ action: "revision_preview", taskId, visual: true, selectedRefs: ["title"] },
    true, "ai", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "保存为私有草稿" }));
  await waitFor(() => expect(call).toHaveBeenLastCalledWith(expect.objectContaining({
    action: "materialize", taskId, selectedRefs: ["title"], revisionFingerprint: chosen.fingerprint,
  }), true, "ai", expect.anything()));
});
