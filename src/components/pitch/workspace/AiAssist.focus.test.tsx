// @vitest-environment jsdom
import * as React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { AiAssist } from "./AiAssist";
import { outlineDataParameters } from "@/src/lib/pitch/workspace/protocol";
import type { Call } from "./client";
const id = "11111111-1111-4111-8111-111111111111";
afterEach(cleanup);
describe("Pitch optional assistant behavior", () => {
  it("prepares a natural language plan without generating pages until explicit adoption", async () => {
    const onGenerate = vi.fn(async () => {}),
      part = { mode: "dynamic", parameters: { templateId: "rent-trend" } };
    const call = vi.fn(async (input: Record<string, unknown>) =>
      input.action === "prepare"
        ? {
            status: "ready",
            part,
            explanation: "正式季度 2025 Q1—2025 Q4",
            modelCalls: 0,
          }
        : {},
    );
    render(
      <AiAssist
        call={call as Call}
        projectId={id}
        buildingIds={[]}
        period="2025-Q4"
        language="zh"
        admin={false}
        busy={false}
        onGenerate={onGenerate}
        onGenerateOutline={async () => {}}
        onExport={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("需要制作什么页面？"), {
      target: { value: "生成北京写字楼市场租金走势页面" },
    });
    fireEvent.click(screen.getByText("识别页面需求"));
    await screen.findByText("正式季度 2025 Q1—2025 Q4");
    expect(onGenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("生成这一页"));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(part));
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ action: "feedback", event: "accepted" }),
      true,
      "ai",
    );
  });
  it("shows relevant real asset results and passes only selected IDs to the shared generator", async () => {
    const onGenerate = vi.fn(async () => {}),
      call = vi.fn(async (input: Record<string, unknown>) =>
        input.action === "recommend"
          ? {
              items: [
                {
                  id,
                  version: 3,
                  title: "匿名隔离案例",
                  kind: "case",
                  templateId: "case-portfolio",
                  reasons: ["相同服务类型"],
                },
              ],
            }
          : {},
      );
    render(
      <AiAssist
        call={call as Call}
        projectId={id}
        buildingIds={[]}
        period=""
        language="zh"
        admin={false}
        busy={false}
        onGenerate={onGenerate}
        onGenerateOutline={async () => {}}
        onExport={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("查找适用素材"));
    await screen.findByText(/相同服务类型/);
    fireEvent.click(screen.getByRole("checkbox", { name: /匿名隔离案例/ }));
    fireEvent.click(screen.getByText("用所选素材生成"));
    await waitFor(() =>
      expect(onGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          assetIds: [id],
          mode: "static",
          templateId: "case-portfolio",
        }),
      ),
    );
    expect(screen.queryByText("开始整理")).toBeNull();
  });
  it("does not transform a failed authorization or failed model task into a completed page", async () => {
    const onGenerate = vi.fn(async () => {}),
      call = vi.fn(async (input: Record<string, unknown>) => {
        if (input.action === "recommend")
          return {
            items: [
              {
                id,
                version: 1,
                title: "隔离素材",
                kind: "case",
                templateId: "case-portfolio",
                reasons: [],
              },
            ],
          };
        if (input.action === "start")
          return {
            tasks: [
              {
                id,
                state: "failed",
                authorized: false,
                request: { task: "summarize" },
                error_code: "authorization_denied",
                result: null,
              },
            ],
          };
        return {};
      });
    render(
      <AiAssist
        call={call as Call}
        projectId={id}
        buildingIds={[]}
        period=""
        language="zh"
        admin
        busy={false}
        onGenerate={onGenerate}
        onGenerateOutline={async () => {}}
        onExport={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("查找适用素材"));
    await screen.findByText("隔离素材");
    fireEvent.click(screen.getByRole("checkbox", { name: /隔离素材/ }));
    fireEvent.click(screen.getByText("辅助理解所选资料"));
    fireEvent.click(screen.getByText("开始整理"));
    await screen.findByText(/未获模型处理授权/);
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByText("已完成")).toBeNull();
  });
  it("makes outlines reviewable and keeps them inert until the batch confirmation", async () => {
    const call = vi.fn(async () => ({
      sections: [
        {
          id,
          title: "隔离公司",
          materials: [{ id, title: "隔离企业素材", version: 2 }],
          part: {
            mode: "static",
            templateId: "corporate-overview",
            assetIds: [id],
            length: "brief",
            allowFallback: false,
            variant: "standard",
          },
        },
      ],
    }));
    render(
      <AiAssist
        call={call as Call}
        projectId={id}
        buildingIds={[]}
        period=""
        language="zh"
        admin={false}
        busy={false}
        onGenerate={async () => {}}
        onGenerateOutline={async () => {}}
        onExport={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("提案结构建议"));
    fireEvent.click(screen.getByText("推荐提纲"));
    await screen.findByText("确认生成 1 个板块");
    fireEvent.change(screen.getByLabelText("章节标题"), {
      target: { value: "调整后的章节" },
    });
    expect(screen.getByDisplayValue("调整后的章节")).toBeDefined();
    expect(call).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("移除"));
    expect(screen.queryByText("确认生成 1 个板块")).toBeNull();
  });
  it("submits the reviewed order and pinned asset versions as one background outline", async () => {
    const secondId = "22222222-2222-4222-8222-222222222222";
    const part = (assetId: string) => ({ mode: "static", templateId: "corporate-overview",
      assetIds: [assetId], length: "brief", allowFallback: false, variant: "standard" });
    const call = vi.fn(async (input: Record<string, unknown>) => input.action === "outline" ? ({
      sections: [
        { id, title: "原公司", part: part(id), materials: [{ id, title: "已发布公司资料", version: 3 }] },
        { id: secondId, title: "原市场", part: part(secondId), materials: [{ id: secondId, title: "已审阅资料", version: 7 }] },
      ], missing: ["缺少正式竞品数据"],
    }) : {});
    const onGenerateOutline = vi.fn(async () => {});
    render(<AiAssist call={call as Call} projectId={id} buildingIds={[]} period="" language="zh"
      initialQuestion="为北京客户做办公选址提案" admin={false} busy={false}
      onGenerate={async () => {}} onGenerateOutline={onGenerateOutline} onExport={() => {}} />);
    fireEvent.click(screen.getByText("提案结构建议"));
    fireEvent.click(screen.getByText("推荐提纲"));
    await screen.findByText("已审阅资料 · v7");
    expect(screen.getByText("缺少正式竞品数据")).toBeInTheDocument();
    expect(onGenerateOutline).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByLabelText("章节标题")[1], { target: { value: "先看市场" } });
    fireEvent.click(screen.getAllByRole("button", { name: "上移" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "确认生成 2 个板块" }));
    await waitFor(() => expect(onGenerateOutline).toHaveBeenCalledExactlyOnceWith({
      mode: "outline", parts: [{ ...part(secondId), title: "先看市场" }, { ...part(id), title: "原公司" }],
      bindings: [{ id: secondId, version: 7 }, { id, version: 3 }],
    }));
    expect(screen.getByRole("button", { name: "确认生成 2 个板块" })).toBeDisabled();
    expect(call.mock.calls.some(([request]) => request.action === "start" || request.action === "status")).toBe(false);
  });

  it("reviews exact building names before permitting generation, and blocks if the selected quarter changes", async () => {
    const parameters = outlineDataParameters([id], "2026-Q3");
    const fingerprint = "b".repeat(64);
    const call = vi.fn(async () => ({ parameters, fingerprint, buildings: [{ id, name: "合成甲座", facts: [{ label: "总面积（㎡）", value: "10,000" }] }] }));
    const onGenerateOutline = vi.fn(async () => {});
    const renderAt = (period: string) => <AiAssist call={call as Call} projectId={id}
      buildingIds={[id]} period={period} language="zh" admin={false} busy={false}
      onGenerate={async () => {}} onGenerateOutline={onGenerateOutline} onExport={() => {}} />;
    const { rerender } = render(renderAt("2026-Q3"));
    fireEvent.click(screen.getByText("提案结构建议"));
    fireEvent.click(screen.getByRole("button", { name: "核对并加入正式数据" }));
    await screen.findByText("合成甲座");
    expect(screen.getByText("总面积（㎡）：10,000")).toBeInTheDocument();
    expect(onGenerateOutline).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith({ action: "review_outline_data", projectId: id,
      buildingIds: [id], period: "2026-Q3" }, true, "workspace", expect.anything());
    rerender(renderAt("2026-Q4"));
    expect(screen.getByRole("button", { name: "确认生成 1 个板块" })).toBeDisabled();
    expect(screen.getByText(/关联楼宇或季度已变化/)).toBeInTheDocument();
    rerender(renderAt("2026-Q3"));
    fireEvent.click(screen.getByRole("button", { name: "确认生成 1 个板块" }));
    await waitFor(() => expect(onGenerateOutline).toHaveBeenCalledExactlyOnceWith({
      mode: "outline", parts: [{ mode: "dynamic", title: "目标项目概况", parameters }],
      bindings: [], dataFingerprint: fingerprint,
    }));
  });

  it("requires re-review after enabling comparisons and submits the confirmed rates", async () => {
    const parameters = outlineDataParameters([id], "2026-Q3");
    const fingerprint = "c".repeat(64), building = { id, name: "国贸测试楼", facts: [] };
    const call = vi.fn(async (input: Record<string, unknown>) => ({
      parameters, fingerprint, buildings: [building],
      ...(input.compareQuarters ? { comparisons: [{ metric: "净有效租金", note: "基期为零时不计算。",
        columns: ["楼宇", "本期", "环比", "同比"], rows: [["国贸测试楼", "100", "+25%", "基期为零"]] }] } : {}),
    }));
    const onGenerateOutline = vi.fn(async () => {});
    render(<AiAssist call={call as Call} projectId={id} buildingIds={[id]} period="2026-Q3"
      language="zh" admin={false} busy={false} onGenerate={async () => {}} onGenerateOutline={onGenerateOutline} onExport={() => {}} />);
    fireEvent.click(screen.getByText("提案结构建议"));
    fireEvent.click(screen.getByRole("button", { name: "核对并加入正式数据" }));
    const submit = await screen.findByRole("button", { name: "确认生成 1 个板块" });
    fireEvent.click(screen.getByRole("checkbox", { name: "同时核对租金和空置率的环比、同比" }));
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新核对正式数据" }));
    expect(await screen.findByRole("cell", { name: "+25%" })).toBeInTheDocument();
    fireEvent.click(submit);
    await waitFor(() => expect(onGenerateOutline).toHaveBeenCalledWith(expect.objectContaining({ dataFingerprint: fingerprint, compareQuarters: true })));
  });

});

it("keeps assistant keywords focused through delayed results, middle edits and Chinese IME", async () => {
  const user = userEvent.setup();
  let resolveSearch!: (value: unknown) => void;
  const call = vi.fn(async (input: Record<string, unknown>) =>
    input.action === "recommend"
      ? new Promise((resolve) => {
          resolveSearch = resolve;
        })
      : {},
  );
  render(
    <AiAssist
      call={call as Call}
      projectId={id}
      buildingIds={[]}
      period=""
      language="zh"
      admin={false}
      busy={false}
      onGenerate={async () => {}}
      onGenerateOutline={async () => {}}
      onExport={() => {}}
    />,
  );
  const field = screen.getByLabelText("关键词") as HTMLInputElement;
  await user.type(field, "office case");
  expect(field).toHaveFocus();
  field.setSelectionRange(7, 7);
  await user.keyboard("X");
  expect(field.value).toBe("office Xcase");
  expect(field.selectionStart).toBe(8);
  await user.click(screen.getByText("查找适用素材"));
  field.focus();
  field.setSelectionRange(7, 8);
  fireEvent.compositionStart(field, { data: "北" });
  fireEvent.change(field, { target: { value: "office 北京case" } });
  field.setSelectionRange(9, 9);
  await act(async () => {
    resolveSearch({
      items: [
        {
          id,
          version: 1,
          title: "隔离搜索结果",
          kind: "case",
          templateId: "case-portfolio",
          reasons: [],
        },
      ],
    });
  });
  expect(screen.getByLabelText("关键词")).toBe(field);
  expect(field).toHaveFocus();
  expect(field.selectionStart).toBe(9);
  expect(field.value).toBe("office 北京case");
  fireEvent.compositionEnd(field, { data: "北京" });
  await user.click(screen.getByText("查找适用素材"));
  field.focus();
  field.setSelectionRange(9, 9);
  await act(async () => {
    resolveSearch({ items: [] });
  });
  expect(screen.queryByText("隔离搜索结果")).toBeNull();
  expect(field).toHaveFocus();
  expect(field.selectionStart).toBe(9);
  expect(call).toHaveBeenLastCalledWith(
    expect.objectContaining({
      action: "recommend",
      query: expect.objectContaining({ q: "office 北京case" }),
    }),
    true,
    "ai",
    expect.any(AbortSignal),
  );
});
