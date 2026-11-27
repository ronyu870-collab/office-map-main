import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { readPitchHandoff } from "../PitchHandoffLink";
import { HandoffReview } from "./HandoffReview";
import { ProposalPreview } from "./ProposalPreview";
import { WorkspaceError, type Call } from "./client";

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
  let scopeMatches = false;
  const call = vi.fn(async (request: Record<string, unknown>) => {
    requests.push(request);
    if (request.action === "list") return { items: [] };
    if (request.action === "review_handoff") return {
      status: "ready", fingerprint, period: "2026-Q3", submarkets: [], buildingIds: scopeMatches ? source.buildingIds : [buildingId],
      binding: { dataAsOf: "2026-09-30" }, pages: [{ title: "已选楼宇对比", sources: [{ label: "正式季度数据" }] }],
    };
    return { state: "queued" };
  }) as unknown as Call;
  const onOpen = vi.fn(async () => {});
  const onClose = vi.fn();
  render(<HandoffReview source={item!} call={call} grants={[scope]}
    theme={{ id: "colliers-default-v1", current_version: 2 }} onOpen={onOpen} onClose={onClose} />);
  await user.click(screen.getByRole("button", { name: "核对来源" }));
  await screen.findByText("返回的范围或季度与所选来源不一致，请重新核对。");
  expect(screen.queryByRole("button", { name: "确认并创建" })).not.toBeInTheDocument();
  scopeMatches = true;
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

it("verifies a trusted analysis against its archived quarter without sending a period override", async () => {
  const user = userEvent.setup();
  const source = { kind: "analysis-result", id } as const;
  let period = "2026-Q3";
  const call = vi.fn(async (request: Record<string, unknown>) => {
    if (request.action === "list") return { items: [] };
    if (request.action === "review_handoff") return {
      status: "ready", fingerprint, period, buildingIds: [], submarkets: ["CBD"],
      binding: { dataAsOf: "2026-06-30" },
      pages: [{ title: "子市场正式分析", sources: [{ label: "归档结果的获权来源" }] }],
    };
    return { state: "queued" };
  });
  const onOpen = vi.fn(async () => {});
  render(<HandoffReview source={{ source, period: "2026-Q2" }} call={call as unknown as Call} grants={[scope]}
    theme={{ id: "colliers-default-v1", current_version: 2 }} onOpen={onOpen} onClose={() => {}} />);
  expect(screen.getByText("2026-Q2")).toBeInTheDocument();
  expect(screen.queryByLabelText("正式季度")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "核对来源" }));
  await screen.findByText("返回的范围或季度与所选来源不一致，请重新核对。");
  period = "2026-Q2";
  await user.click(screen.getByRole("button", { name: "核对来源" }));
  await screen.findByText("归档结果的获权来源");
  await user.click(screen.getByRole("button", { name: "确认并创建" }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  const commands = call.mock.calls.map(([command]) => command);
  expect(commands.filter(command => command.action === "review_handoff")).toEqual([
    { action: "review_handoff", handoff: { source } }, { action: "review_handoff", handoff: { source } },
  ]);
  expect(commands.find(command => command.action === "add_to_pitch")?.handoff).toEqual({ source });
});

it("reviews the historical stacking selection with its observed date and confirmed city", async () => {
  const user = userEvent.setup();
  const source = { kind: "stacking-plan" as const, buildingId, selection: { towerIds: [secondBuildingId] } };
  const call = vi.fn(async (input: Record<string, unknown>) => {
    if (input.action === "list") return { items: [] };
    if (input.action === "review_handoff") return {
      status: "ready", period: "", sourceCity: "北京", stackingSource: source, fingerprint, submarkets: [], buildingIds: [buildingId],
      binding: { dataAsOf: null, disclosure: "restricted", observedOn: "2026-09-30" },
      pages: [{ title: "A 座历史堆叠图", sources: [{ label: "受限历史来源" }] }],
    };
    return { state: "queued" };
  });
  const onOpen = vi.fn(async () => {});
  render(<HandoffReview source={{ source, language: "zh" }} call={call as unknown as Call}
    grants={[{ ...scope, city: "上海" }, scope]} theme={{ id: "colliers-default-v1", current_version: 2 }} onOpen={onOpen} onClose={() => {}} />);
  expect(screen.queryByLabelText("正式季度")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "核对来源" }));
  expect(await screen.findByText("来源日期待确认 · 观察日期 2026-09-30 · 受限来源")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "上海 · office" })).toBeDisabled();
  expect(screen.getByLabelText("所属区域")).toHaveValue("1");
  await user.click(screen.getByRole("button", { name: "确认并创建" }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  const sent = call.mock.calls.filter(([command]) => command.action !== "list").map(([command]) => command);
  expect(sent[0]).toEqual({ action: "review_handoff", handoff: { source, language: "zh" } });
  expect(sent[1]).toMatchObject({ action: "add_to_pitch", handoff: { source, language: "zh" }, fingerprint,
    target: { mode: "create", scope } });
});

it("uses the research edition's fixed quarter and confirms only the reviewed Beijing sample", async () => {
  const user = userEvent.setup();
  const source = { kind: "quarterly-research", edition: "2026Q2" } as const;
  const hash = (input: object) => "#add-to-pitch=" + encodeURIComponent(JSON.stringify(input));
  const item = readPitchHandoff(hash({ source }));
  expect(item).toEqual({ source });
  expect(readPitchHandoff(hash({ source, period: "2026-Q3" }))).toBeNull();
  expect(readPitchHandoff(hash({ source: { ...source, edition: "2026Q4" } }))).toBeNull();
  let period = "2026-Q3";
  const call = vi.fn(async (input: Record<string, unknown>) => {
    if (input.action === "list") return { items: [
      { id, city: "上海", title: "上海选址" }, { id: newId, city: "北京", title: "北京写字楼" },
    ] };
    if (input.action === "review_handoff") return {
      status: "ready", period, sourceCity: "北京", fingerprint, submarkets: [], buildingIds: [],
      binding: { dataAsOf: "2026-06-30" },
      pages: [{ title: "北京甲级写字楼季度指标", sources: [{ label: "获权跟踪样本来源" }] }],
    };
    return { state: "queued" };
  });
  const onOpen = vi.fn(async () => {});
  render(<HandoffReview source={item!} call={call as unknown as Call}
    grants={[{ ...scope, city: "上海" }, scope]} theme={{ id: "colliers-default-v1", current_version: 2 }}
    onOpen={onOpen} onClose={() => {}} />);
  await screen.findByRole("option", { name: "北京写字楼" });
  expect(screen.queryByRole("option", { name: "上海选址" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("所属区域")).toHaveValue("1");
  expect(screen.queryByLabelText("正式季度")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "核对来源" }));
  await screen.findByText("返回的季度研究范围与所选版次不一致，请重新核对。");
  expect(screen.queryByRole("button", { name: "确认并创建" })).not.toBeInTheDocument();

  period = "2026-Q2";
  await user.click(screen.getByRole("button", { name: "核对来源" }));
  expect(await screen.findByText("获权跟踪样本来源")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "确认并创建" }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  const commands = call.mock.calls.map(([command]) => command);
  expect(commands.filter(command => command.action === "review_handoff")).toEqual([
    { action: "review_handoff", handoff: { source } }, { action: "review_handoff", handoff: { source } },
  ]);
  expect(commands.find(command => command.action === "add_to_pitch")).toMatchObject({
    handoff: { source }, fingerprint, target: { mode: "create", scope },
  });
});

it("rechecks the same home project version when confirming a newly reviewed plan", async () => {
  const user = userEvent.setup();
  let version = 1;
  const createProject = vi.fn(async ({ id }: { id: string }) => ({ id, version }));
  const onGenerated = vi.fn(async () => {});
  const call = vi.fn(async (entry: Record<string, unknown>) => {
    if (entry.action === "proposal_plan") {
      return { status: "ready", selection: "explicit",
        plan: { id, title: "楼宇推介", version: 1, contextFingerprint: fingerprint,
          slides: [{ id: newId, title: "楼宇概况" }], gaps: [] },
        brief: { city: "北京", submarkets: [], period: "2026-Q3", buildingIds: [buildingId] } };
    }
    const confirmation = entry.confirmation as { taskId: string; expectedVersion: number };
    if (confirmation.expectedVersion === 1) {
      version = 2;
      throw new WorkspaceError("项目版本已变化。", 409);
    }
    return { taskId: confirmation.taskId, projectId: newId, state: "completed" };
  }) as unknown as Call;
  render(<ProposalPreview call={call} question="为五矿广场制作项目推介" language="zh" period=""
    buildingIds={[]} createProject={createProject} disabled={false} onGenerated={onGenerated} />);
  for (let attempt = 0; attempt < 2; attempt++) {
    await user.click(screen.getByRole("button", { name: "规划正式提案" }));
    await user.click(await screen.findByRole("button", { name: "确认并生成 Pitch" }));
    if (attempt === 0) await screen.findByText("项目或资料已更新，请重新规划正式提案。");
  }
  await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(newId));
  expect(createProject).toHaveBeenCalledTimes(2);
  expect(createProject.mock.calls[1][0].id).toBe(createProject.mock.calls[0][0].id);
});

it("follows the original task automatically and resumes after an interrupted progress request", async () => {
  const user = userEvent.setup();
  const confirmations: { taskId: string }[] = [];
  const onGenerated = vi.fn(async () => {});
  const call = vi.fn(async (entry: Record<string, unknown>) => {
    if (entry.action === "proposal_plan") {
      return { status: "ready", selection: "none",
        plan: { id, title: "季度市场报告", version: 1, contextFingerprint: fingerprint,
          slides: [{ id: newId, title: "北京市场" }], gaps: [] },
        brief: { city: "北京", submarkets: [], period: "2026-Q3", buildingIds: [] } };
    }
    const confirmation = entry.confirmation as { taskId: string };
    confirmations.push(confirmation);
    if (confirmations.length === 2) throw new Error("进度查询中断");
    const state = ["queued", null, "running", "cancelled", "completed"][confirmations.length - 1];
    return { taskId: confirmation.taskId, state, ...(state === "completed" ? { projectId: newId } : {}) };
  }) as unknown as Call;
  render(<ProposalPreview call={call} projectId={id} projectVersion={1} question="北京季度写字楼市场报告"
    language="zh" period="" buildingIds={[]} disabled={false} onGenerated={onGenerated} />);
  await user.click(screen.getByRole("button", { name: "规划正式提案" }));
  await user.click(await screen.findByRole("button", { name: "确认并生成 Pitch" }));
  await screen.findByText("等待生成提案…");
  await screen.findByText("进度查询中断", {}, { timeout: 4000 });
  expect(confirmations).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "重新查询生成进度" }));
  await screen.findByText("正在生成提案…", {}, { timeout: 4000 });
  await screen.findByText("生成已取消。可以重新生成。", {}, { timeout: 4000 });
  expect(confirmations).toEqual(Array(4).fill(confirmations[0]));
  expect(onGenerated).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认并生成 Pitch" }));
  await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(newId));
  expect(confirmations[4].taskId).not.toBe(confirmations[0].taskId);
}, 15000);
