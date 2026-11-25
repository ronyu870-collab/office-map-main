// @vitest-environment jsdom
import * as React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { AiAssist } from "./AiAssist";
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
        onReload={async () => {}}
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
        onReload={async () => {}}
        onExport={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("查找适用素材"));
    await screen.findByText(/相同服务类型/);
    fireEvent.click(screen.getByRole("checkbox"));
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
        onReload={async () => {}}
        onExport={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("查找适用素材"));
    await screen.findByText("隔离素材");
    fireEvent.click(screen.getByRole("checkbox"));
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
        onReload={async () => {}}
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
});
