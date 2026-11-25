// @vitest-environment jsdom
import * as React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { AiManager } from "./AiManager";
import { DEFAULT_AI_CONFIG } from "@/src/lib/pitch/ai/protocol";
import type { Call, Catalog } from "./client";
const id = "11111111-1111-4111-8111-111111111111";
const catalog: Catalog = {
  scopes: [
    {
      organizationId: "synthetic",
      region: "test",
      city: "test",
      businessLine: "test",
      canAdmin: true,
      canMaintain: true,
      canGenerate: true,
      canClientExport: false,
    },
  ],
  categories: [],
  themes: [],
};
const operations = {
  tasks: [],
  candidates: [
    {
      id,
      project_version: 3,
      state: "submitted",
      content: { title: "明确提交的单页" },
      scope: {},
      materialized_id: null,
    },
  ],
  usage: [],
  next: null,
  summary: {
    count: 0,
    completed: 0,
    cacheHits: 0,
    queued: 0,
    permissionBlocks: 0,
    budgetPauses: 0,
    modelLatency: { averageMs: null, p95Ms: null },
    taskCosts: [],
  },
};
const content = {
  protocol: "colliers-pitch/1",
  locale: "zh",
  title: "明确提交的单页",
  blocks: [
    {
      kind: "paragraph",
      text: "仅在获权核对时读取的完整正文。",
      sourceIds: [id],
    },
    {
      kind: "table",
      columns: ["指标", "值"],
      rows: [
        ["真实零值", 0],
        ["未知", null],
      ],
      sourceIds: [id],
    },
  ],
  sources: [
    {
      id,
      kind: "synthetic",
      label: "隔离候选来源",
      locator: "slide:2",
      version: "1",
      dataAsOf: "2025-12-31",
    },
  ],
  dataAsOf: "2025-12-31",
  isTestData: true,
  disclosure: "internal",
};
afterEach(cleanup);
it.each([true, false])(
  "loads candidate content only after explicit authorized preview (%s)",
  async (allowed) => {
    const call = vi.fn(async (input: Record<string, unknown>) => {
      if (input.action === "config") return DEFAULT_AI_CONFIG;
      if (input.action === "operations") return operations;
      if (input.action === "candidate_preview") {
        if (!allowed) throw new Error("当前来源已撤回");
        return { content };
      }
      throw new Error("Unexpected action");
    });
    render(<AiManager call={call as Call} catalog={catalog} />);
    fireEvent.click(screen.getByText("候选与反馈"));
    await screen.findByText(/明确提交的单页/);
    expect(
      call.mock.calls.some(([v]) => v.action === "candidate_preview"),
    ).toBe(false);
    expect(screen.queryByText("仅在获权核对时读取的完整正文。")).toBeNull();
    fireEvent.click(screen.getByText("查看待核对内容"));
    if (allowed) {
      await screen.findByText("仅在获权核对时读取的完整正文。");
      expect(screen.getByText("真实零值")).toBeDefined();
      expect(screen.getByText("0")).toBeDefined();
      expect(screen.getByText("—")).toBeDefined();
    } else {
      await screen.findByText("当前来源已撤回");
      expect(screen.queryByLabelText("候选页面内容")).toBeNull();
    }
    expect(call).toHaveBeenCalledWith(
      { action: "candidate_preview", candidateId: id },
      true,
      "ai",
    );
  },
);

it("keeps model filter focused through delayed and stale results, middle edits and Chinese IME", async () => {
  const user = userEvent.setup();
  const pending: Array<{ model: string; resolve: (value: unknown) => void }> =
    [];
  const call = vi.fn(async (input: Record<string, unknown>) => {
    if (input.action === "config") return DEFAULT_AI_CONFIG;
    if (!input.model) return operations;
    return new Promise((resolve) =>
      pending.push({ model: String(input.model), resolve }),
    );
  });
  render(<AiManager call={call as Call} catalog={catalog} />);
  const field = (await screen.findByLabelText("模型")) as HTMLInputElement;
  await user.type(field, "model");
  expect(field).toHaveFocus();
  field.setSelectionRange(2, 2);
  await user.keyboard("X");
  expect(field.value).toBe("moXdel");
  expect(field.selectionStart).toBe(3);
  fireEvent.compositionStart(field, { data: "模" });
  fireEvent.change(field, { target: { value: "mo模型del" } });
  field.setSelectionRange(4, 4);
  await act(async () => {});
  expect(pending.at(-1)?.model).toBe("mo模型del");
  await act(async () => {
    pending
      .at(-1)!
      .resolve({ ...operations, summary: { ...operations.summary, count: 7 } });
  });
  await screen.findByText(/本页 7 项/);
  // An obsolete request completing after the latest response must not replace it.
  await act(async () => {
    pending[0].resolve(operations);
  });
  expect(screen.getByText(/本页 7 项/)).toBeInTheDocument();
  expect(screen.getByLabelText("模型")).toBe(field);
  expect(field).toHaveFocus();
  expect(field.selectionStart).toBe(4);
  expect(field.value).toBe("mo模型del");
  fireEvent.compositionEnd(field, { data: "模型" });
  await user.clear(field);
  await screen.findByText(/本页 0 项/);
  expect(field).toHaveFocus();
  expect(screen.getByLabelText("模型")).toBe(field);
});
