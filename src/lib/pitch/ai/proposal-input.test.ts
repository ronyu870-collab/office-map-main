import { describe, expect, it, vi } from "vitest";
import type { AgentCompletion } from "@/src/lib/intelligence/agent/modelProtocol";
import { proposalRequestSchema, readProposalBrief } from "./proposal-brief";
import { proposalRevisionRequestSchema, readProposalEdit } from "./proposal-edit-intent";
import { createProposalInterpreter, type ProposalModel } from "./proposal-interpretation";

const session = { actorId: "actor-a", sessionId: "session-a", configurationVersion: "runtime/1" };
const projectId = "10000000-0000-4000-8000-000000000001";
const pageId = "10000000-0000-4000-8000-000000000002";
const secondPageId = "10000000-0000-4000-8000-000000000003";
const request = (question: string) => proposalRequestSchema.parse({ question });
function completion(result: object): AgentCompletion {
  return {
    provider: "deepseek", model: "offline-mock", inputTokens: null, outputTokens: null,
    message: { role: "assistant", content: JSON.stringify(result) },
  };
}

describe("proposal request understanding", () => {
  it.each([
    ["为霄云路33号制作招商代理提案", { scenario: "leasing-agency", buildingQueries: ["霄云路33号"], pages: 19 }],
    ["比较CBD五栋甲级写字楼", { scenario: "office-comparison", comparisonCount: 5, submarkets: ["CBD"], grade: "A" }],
    ["制作北京最新正式季度写字楼市场报告", { scenario: "market-report", city: "北京", period: null, style: "research" }],
    ["为霄云路33号制作高端项目推介", { scenario: "building-promotion", buildingQueries: ["霄云路33号"], style: "premium" }],
    ["为某金融企业制作选址方案", { scenario: "site-selection", targetClient: "某金融企业" }],
    ["根据已有分析结果生成客户汇报PPT", { scenario: "analysis-briefing" }],
    ["Create a premium building profile for Lincoln Tower", { scenario: "building-promotion", language: "en", buildingQueries: ["Lincoln Tower"] }],
    ["制作北京2024Q4至2025年第三季度写字楼市场报告", { scenario: "market-report", start: "2024-Q4", period: "2025-Q3", periodConflict: false }],
  ])("extracts the business brief from %s", (question, expected) => {
    expect(readProposalBrief(request(question))).toMatchObject(expected);
  });

  it("uses selected property IDs when the request refers to the current building", () => {
    const input = proposalRequestSchema.parse({ question: "2026Q2，为所选楼宇制作项目推介", buildingIds: [projectId] });
    expect(readProposalBrief(input)).toMatchObject({ buildingQueries: [], buildingIds: [projectId], period: "2026-Q2" });
  });

  it("does not adjudicate conflicting explicit quarters on its own", () => {
    expect(readProposalBrief(request("制作2026Q2和2026Q3北京写字楼市场报告")).periodConflict).toBe(true);
  });

  it("makes no model attempt for a standard brief", async () => {
    const invoke = vi.fn<ProposalModel["invoke"]>();
    const interpret = createProposalInterpreter();
    const result = await interpret(request("比较CBD五栋甲级写字楼"), new AbortController().signal, { cacheScope: session, invoke });
    expect(result.modelCalls).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("limits complex interpretation to one compact structured turn and scopes replay", async () => {
    const invoke = vi.fn<ProposalModel["invoke"]>().mockResolvedValue(completion({
      scenario: "site-selection", targetClient: "北城银行", priorities: ["commute", "cost"],
    }));
    const interpret = createProposalInterpreter();
    const input = request("做一份面向北城银行、综合权衡通勤与预算的办公空间决策材料");
    const signal = new AbortController().signal;
    const model = { cacheScope: session, invoke };
    expect(await interpret(input, signal, model)).toMatchObject({
      modelCalls: 1, modelStatus: "interpreted", brief: { scenario: "site-selection", targetClient: "北城银行" },
    });
    expect(await interpret(input, signal, model)).toMatchObject({ modelCalls: 0, modelStatus: "cached" });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toHaveLength(2);
    expect(await interpret(input, signal, { ...model, cacheScope: { ...session, sessionId: "session-b" } })).toMatchObject({ modelCalls: 1 });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    { scenario: "site-selection", buildingQueries: ["不存在于原始请求的楼宇"] },
    { scenario: "site-selection", rent: 199 },
    { scenario: "site-selection", sql: "select 1" },
  ])("rejects ungrounded or unsupported model slots", async payload => {
    const invoke = vi.fn<ProposalModel["invoke"]>().mockResolvedValue(completion(payload));
    const interpret = createProposalInterpreter();
    const result = await interpret(request("面向北城银行综合权衡办公空间"), new AbortController().signal, { cacheScope: session, invoke });
    expect(result).toMatchObject({ modelCalls: 1, modelStatus: "invalid", brief: { scenario: null } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not start a duplicate in-flight plan for the current session", async () => {
    let complete: ((value: AgentCompletion) => void) | undefined;
    const invoke = vi.fn<ProposalModel["invoke"]>().mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const interpret = createProposalInterpreter();
    const input = request("北城银行办公空间决策，综合权衡通勤与成本");
    const model = { cacheScope: session, invoke };
    const signal = new AbortController().signal;
    const pending = interpret(input, signal, model);
    expect(await interpret(input, signal, model)).toMatchObject({ modelCalls: 0, modelStatus: "pending" });
    complete!(completion({ scenario: "site-selection" }));
    await expect(pending).resolves.toMatchObject({ modelCalls: 1, modelStatus: "interpreted" });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("returns a deterministic fallback when the model ignores its timeout", async () => {
    const invoke = vi.fn<ProposalModel["invoke"]>().mockImplementation(() => new Promise(() => {}));
    const interpret = createProposalInterpreter({ timeoutMs: 10 });
    const result = await interpret(request("为霄云路33号制作招商代理提案，从投资方视角重构叙事"), new AbortController().signal, { cacheScope: session, invoke });
    expect(result).toMatchObject({ modelCalls: 1, modelStatus: "timeout", brief: { scenario: "leasing-agency" } });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].aborted).toBe(true);
  });

  it("honors cancellation and forbids external models when requested", async () => {
    const invoke = vi.fn<ProposalModel["invoke"]>().mockImplementation(() => new Promise(() => {}));
    const interpret = createProposalInterpreter();
    const model = { cacheScope: session, invoke };
    const controller = new AbortController();
    expect(await interpret(request("综合权衡，禁止使用外部模型"), controller.signal, model)).toMatchObject({ modelCalls: 0 });
    const pending = interpret(request("综合权衡，选择商务提案叙事"), controller.signal, model);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("proposal edit intentions", () => {
  const revise = (question: string, selection: { pageIds?: string[]; objectIds?: string[] } = {}) =>
    readProposalEdit(proposalRevisionRequestSchema.parse({ question, projectId, expectedVersion: 2, currentPageId: pageId, ...selection }));

  it("pins each turn independently to its selection and flags factual changes", () => {
    expect(revise("整套提案更新到2026Q2，并换成英文")).toMatchObject({
      kind: "intent", target: { kind: "deck" }, verifyFacts: true,
      operations: [{ kind: "set-period", period: "2026-Q2" }, { kind: "set-language", language: "en" }],
    });
    expect(revise("换成大堂照片", { objectIds: ["image:1"] })).toMatchObject({
      kind: "intent", target: { kind: "objects", pageId, objectIds: ["image:1"] },
      operations: [{ kind: "replace-photo", category: "lobby" }], verifyFacts: true,
    });
    expect(revise("调整成柱状图", { pageIds: [pageId, secondPageId] })).toMatchObject({
      kind: "intent", target: { kind: "pages", pageIds: [pageId, secondPageId] },
      operations: [{ kind: "set-chart", chart: "column" }], verifyFacts: true,
    });
    expect(revise("润色标题")).toMatchObject({ target: { kind: "pages", pageIds: [pageId] }, verifyFacts: false });
    expect(revise("加一栋成交过的虚构楼宇")).toMatchObject({ kind: "clarification" });
  });

  it("keeps a quoted title intact and distinguishes it from a data refresh", () => {
    const question = "把标题改成《2026Q2 北京。并调整图表》";
    expect(revise(question)).toMatchObject({
      kind: "intent", target: { kind: "pages", pageIds: [pageId] }, verifyFacts: false,
      operations: [{ kind: "revise-text", request: question }],
    });
    expect(revise("换成「2026Q2」")).toMatchObject({
      kind: "intent", operations: [{ kind: "set-period", period: "2026-Q2" }], verifyFacts: true,
    });
    expect(revise("增加「国贸三期」作为竞品")).toMatchObject({
      kind: "intent", operations: [{ kind: "add-competitor", buildingQuery: "国贸三期" }],
    });
  });

  it("keeps theme, page-count and retarget requests typed", () => {
    expect(revise("整套换成高端风格，并精简到8页")).toMatchObject({
      kind: "intent", operations: [{ kind: "set-style", style: "premium" }, { kind: "shorten", pages: 8 }],
    });
    expect(revise("增加国贸三期作为竞品")).toMatchObject({
      kind: "intent", operations: [{ kind: "add-competitor", buildingQuery: "国贸三期" }],
    });
    expect(revise("改为面向金融企业的提案")).toMatchObject({
      kind: "intent", operations: [{ kind: "retarget", targetClient: "金融企业" }],
    });
  });
});
