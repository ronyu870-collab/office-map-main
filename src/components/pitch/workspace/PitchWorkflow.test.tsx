import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { readPitchHandoff } from "../PitchHandoffLink";
import { HandoffReview } from "./HandoffReview";
import { ProposalPreview } from "./ProposalPreview";
import type { Call } from "./client";

afterEach(cleanup);

const id = "11111111-1111-4111-8111-111111111111";
const buildingId = "22222222-2222-4222-8222-222222222222";
const secondBuildingId = "33333333-3333-4333-8333-333333333333";
const newId = "44444444-4444-4444-8444-444444444444";
const fingerprint = "f".repeat(64);
const scope = { organizationId: "test", region: "北京", city: "北京", businessLine: "office" };

it("uses the actual proposal review and reuses the generation task after a lost response", async () => {
  const user = userEvent.setup();
  const requests: Record<string, unknown>[] = [];
  let fail = true;
  const call = vi.fn(async (request: Record<string, unknown>) => {
    requests.push(request);
    if (request.action === "proposal_plan") {
      return { status: "ready", plan: { id, title: "CBD 写字楼选址", version: 1, contextFingerprint: fingerprint,
        slides: [{ id: newId, title: "办公楼宇对比" }], gaps: [{ pageKind: "visuals", reason: "没有可披露照片。" }] },
        brief: { city: "北京", submarkets: ["CBD"], period: "2026-Q3", buildingIds: [buildingId] },
        selection: "explicit" };
    }
    if (fail) { fail = false; throw new Error("响应中断"); }
    return { taskId: (request.confirmation as { taskId: string }).taskId, projectId: newId, state: "completed" };
  }) as unknown as Call;
  const onGenerated = vi.fn(async () => {});
  const question = "制作CBD五个甲级写字楼的选址对比。";
  render(<ProposalPreview call={call} projectId={id} projectVersion={2} question={question}
    city="北京" language="zh" period="2026-Q3" buildingIds={[buildingId]}
    initialQuestion={question} disabled={false} onGenerated={onGenerated} />);
  await screen.findByText("办公楼宇对比", {}, { timeout: 5000 });
  expect(requests).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "确认并生成 Pitch" }));
  await screen.findByText("响应中断");
  await user.click(screen.getByRole("button", { name: "重新查询或继续生成" }));
  await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(newId));
  expect(requests[2]).toEqual(requests[1]);
  expect(requests[1]).toEqual({ action: "proposal_generate", confirmation: expect.objectContaining({
    projectId: id, expectedVersion: 2, planId: id, contextFingerprint: fingerprint, request: requests[0].input,
  }) });
});

it("preserves source selection through review and confirms one versioned handoff", async () => {
  const user = userEvent.setup();
  const source = { kind: "buildings" as const, buildingIds: [buildingId, secondBuildingId] };
  const transfer = JSON.stringify({ source, period: "2026-Q3", ignored: "client content" });
  const item = readPitchHandoff("#add-to-pitch=" + encodeURIComponent(transfer));
  expect(item).toEqual({ source, period: "2026-Q3" });
  const requests: Record<string, unknown>[] = [];
  const call = vi.fn(async (request: Record<string, unknown>) => {
    requests.push(request);
    if (request.action === "list") return { items: [] };
    if (request.action === "review_handoff") return {
      status: "ready", fingerprint, period: "2026-Q3", submarkets: [], buildingIds: source.buildingIds,
      binding: { dataAsOf: "2026-09-30" }, pages: [{ title: "已选楼宇对比", sources: [{ label: "正式季度数据" }] }],
    };
    return { state: "queued" };
  }) as unknown as Call;
  const onOpen = vi.fn(async () => {});
  const onClose = vi.fn();
  render(<HandoffReview source={item!} call={call} grants={[scope]}
    theme={{ id: "colliers-default-v1", current_version: 2 }} onOpen={onOpen} onClose={onClose} />);
  await user.click(screen.getByRole("button", { name: "核对来源" }));
  expect(await screen.findByText("正式季度数据")).toBeInTheDocument();
  expect(requests.find(entry => entry.action === "review_handoff")).toEqual({ action: "review_handoff", handoff: { source, period: "2026-Q3" } });
  expect(requests.some(entry => entry.action === "add_to_pitch")).toBe(false);
  await user.click(screen.getByRole("button", { name: "确认并创建" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(requests.filter(entry => entry.action === "add_to_pitch")).toHaveLength(1);
  const command = requests.find(entry => entry.action === "add_to_pitch")!;
  expect(command).toEqual({ action: "add_to_pitch", fingerprint, taskId: expect.any(String), handoff: { source, period: "2026-Q3" },
    target: { mode: "create", title: "已选楼宇对比", projectId: expect.any(String), scope,
      themeId: "colliers-default-v1", themeVersion: 2 } });
  expect(onOpen).toHaveBeenCalledWith((command.target as { projectId: string }).projectId);
});
