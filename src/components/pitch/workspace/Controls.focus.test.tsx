import * as React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import { TemplatePicker, type Template } from "./TemplatePicker";
import { TemplateParameters, BuildingPicker } from "./Parameters";
import { AssetPicker } from "./Assets";
import { ExportPanel } from "./ExportPanel";
import type { Call } from "./client";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
const id = "22222222-2222-4222-8222-222222222222";
afterEach(cleanup);
const template: Template = {
  id: "team-multiple",
  name: "多人团队",
  description: "组合团队成员",
  kind: "team",
};
function requests(result: Record<string, unknown> = { items: [], next: null }) {
  return vi.fn(async () => result) as unknown as Call;
}
describe("Pitch parameter and search focus", () => {
  it("resumes a failed progress request without starting a duplicate export", async () => {
    const user = userEvent.setup();
    let fail = true;
    const call = vi.fn(async (input: Record<string, unknown>) => {
      if (input.action === "export_status") {
        if (fail) throw new Error("网络中断");
        return { state: "ready", progress: 100, filename: "恢复.pptx" };
      }
      return {};
    }) as unknown as Call;
    const detail = {
      project: { id },
      slides: [{ id: "a" }],
      exports: [],
    } as unknown as WorkspaceDetail;
    render(
      <ExportPanel
        call={call}
        detail={detail}
        active="a"
        selected={[]}
        flush={async () => detail}
        canClient={false}
        disabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "导出" }));
    await user.click(screen.getByRole("button", { name: "生成文件" }));
    await screen.findByText("网络中断", {}, { timeout: 3000 });
    expect(
      screen.queryByRole("button", { name: "下载已生成文件" }),
    ).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "重新查询进度" }));
    await screen.findByRole(
      "button",
      { name: "下载已生成文件" },
      { timeout: 3000 },
    );
    expect(
      vi
        .mocked(call)
        .mock.calls.filter(([input]) => input.action === "export_start"),
    ).toHaveLength(1);
  });
  it("keeps template and enterprise asset searches stable through delayed results, middle edits, empty matches and IME", async () => {
    const user = userEvent.setup(),
      call = requests({ svg: "<svg/>" }),
      choose = vi.fn();
    const view = render(
      <TemplatePicker
        call={call}
        templates={[template]}
        onChoose={choose}
        favorites={[]}
        recent={[]}
        onFavorite={() => {}}
      />,
    );
    const field = screen.getByLabelText("搜索模板") as HTMLInputElement;
    await user.type(field, "多人");
    expect(field).toHaveFocus();
    field.setSelectionRange(0, 1);
    fireEvent.change(field, { target: { value: "团" } });
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: "不存在" } });
    fireEvent.compositionEnd(field);
    expect(screen.getByText("没有匹配的模板。")).toBeInTheDocument();
    expect(screen.getByLabelText("搜索模板")).toBe(field);
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.click(
      screen.getByRole("button", { name: /多人团队.*组合团队成员/ }),
    );
    expect(choose).toHaveBeenCalledWith(template);
    view.unmount();
    render(
      <AssetPicker call={requests()} onAdd={async () => {}} busy={false} />,
    );
    const asset = screen.getByLabelText("搜索企业素材");
    await user.type(asset, "中文素材");
    fireEvent.compositionStart(asset);
    fireEvent.change(asset, { target: { value: "研究" } });
    fireEvent.compositionEnd(asset);
    await waitFor(() =>
      expect(screen.getByText("没有匹配的已发布素材。")).toBeInTheDocument(),
    );
    expect(asset).toHaveFocus();
    expect(screen.getByLabelText("搜索企业素材")).toBe(asset);
  });
  it("keeps checked assets across categories and ignores a late result while loading a new category page", async () => {
    const user = userEvent.setup();
    const caseId = "33333333-3333-4333-8333-333333333333";
    const disabledId = "44444444-4444-4444-8444-444444444444";
    const asset = (assetId: string, name: string) => ({ id: assetId, names: { zh: name }, current_version: 3, is_test_data: false });
    const first = asset(id, "企业简介");
    const historical = asset("history", "历史项目");
    type Page = { items: ReturnType<typeof asset>[]; next: string | null };
    let resolvePrevious!: (page: Page) => void;
    let resolveCasePage!: (page: Page) => void;
    let previousSignal: AbortSignal | undefined;
    const call = vi.fn(async (input: Record<string, unknown>, _write?: boolean, _path?: string, signal?: AbortSignal) => {
      if (input.categoryId === caseId && input.before === historical.id)
        return new Promise(resolve => { resolveCasePage = resolve; });
      if (input.categoryId === caseId) return { items: [historical], next: historical.id };
      if (input.before === first.id) {
        previousSignal = signal;
        return new Promise(resolve => { resolvePrevious = resolve; });
      }
      return { items: [first], next: first.id };
    });
    const add = vi.fn(async () => {});
    render(<AssetPicker call={call as unknown as Call} busy={false} onAdd={add} categories={[
      { id: caseId, system_code: "case", names: { zh: "代表案例" }, enabled: true, revision: 1 },
      { id: disabledId, system_code: "disabled", names: { zh: "停用类别" }, enabled: false, revision: 1 },
    ]} />);
    await user.click(await screen.findByRole("checkbox", { name: "企业简介" }));
    await user.click(screen.getByRole("button", { name: "更多素材" }));
    expect(screen.queryByRole("option", { name: "停用类别" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("素材分类"), caseId);
    await user.click(await screen.findByRole("checkbox", { name: "历史项目" }));
    await user.click(screen.getByRole("button", { name: "更多素材" }));
    expect(previousSignal?.aborted).toBe(true);
    expect(call.mock.calls.some(([input, write, path]) => input.categoryId === caseId &&
      input.state === "published" && input.validity === "valid" && !write && path === "library")).toBe(true);

    await act(async () => resolvePrevious({ items: [asset("late", "旧分类迟到结果")], next: null }));
    expect(screen.queryByText("旧分类迟到结果")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在加载…" })).toBeDisabled();
    await act(async () => resolveCasePage({ items: [historical, asset("more", "另一历史项目")], next: null }));
    expect(screen.getAllByRole("checkbox", { name: "历史项目" })).toHaveLength(1);

    await user.click(screen.getByText("已选素材（2）"));
    await user.click(screen.getByRole("button", { name: "移除企业简介" }));
    await user.selectOptions(screen.getByLabelText("组合布局"), "case-study");
    await user.click(screen.getByRole("button", { name: "添加到 Pitch（1）" }));
    expect(add).toHaveBeenCalledWith([historical.id], "case-study");
    expect(screen.queryByText("已选素材（1）")).not.toBeInTheDocument();
  });

  it("previews the listed version from the protected material library and retries a failed read", async () => {
    const user = userEvent.setup();
    const asset = { id, names: { zh: "案例索引" }, current_version: 3, is_test_data: false };
    const sourceId = "55555555-5555-4555-8555-555555555555";
    const content = {
      protocol: "colliers-pitch/1", title: "项目提案", locale: "zh", disclosure: "internal", isTestData: false,
      dataAsOf: "2026-09-30", blocks: [
        { kind: "case", title: "业务案例", challenge: "分散选址", approach: "集中比选", outcome: "形成短名单", sourceIds: [sourceId] },
      ],
      sources: [{ id: sourceId, kind: "record", label: "项目归档", locator: "页 4", version: "1", dataAsOf: "2026-09-30" }],
    };
    let previews = 0;
    const call = vi.fn(async (input: Record<string, unknown>) => {
      if (input.action !== "asset") return { items: [asset], next: null };
      if (!previews++) throw new Error("网络中断");
      return { version: { content } };
    });
    render(<AssetPicker call={call as unknown as Call} busy={false} onAdd={async () => {}} />);
    const open = await screen.findByRole("button", { name: "预览案例索引" });
    expect(previews).toBe(0);
    await user.click(open);
    expect(await screen.findByRole("alert")).toHaveTextContent("网络中断");
    await user.click(screen.getByRole("button", { name: "重试预览" }));
    expect(await screen.findByText("形成短名单")).toBeInTheDocument();
    expect(screen.getByText("项目归档 · 页 4")).toBeInTheDocument();
    expect(screen.getByText("资料日期 2026-09-30 · v3")).toBeInTheDocument();
    expect(call).toHaveBeenLastCalledWith({ action: "asset", assetId: id, version: 3 }, false, "library", expect.any(AbortSignal));
    expect(open).toHaveAttribute("aria-expanded", "true");
    await user.click(open);
    expect(screen.queryByText("形成短名单")).not.toBeInTheDocument();
  });

  it("keeps building and business asset search focused and submits actual selected bindings", async () => {
    const user = userEvent.setup(),
      call = requests({
        items: [
          {
            id,
            name: "隔离真实目录楼宇",
            names: { zh: "隔离成员" },
            is_test_data: true,
          },
        ],
        next: null,
      }),
      generate = vi.fn(async () => {});
    const view = render(
      <BuildingPicker call={call} ids={[]} onChange={() => {}} />,
    );
    const building = screen.getByLabelText("搜索楼宇");
    await user.type(building, "Test 中文");
    await screen.findByRole("button", { name: "隔离真实目录楼宇" });
    expect(building).toHaveFocus();
    expect(screen.getByLabelText("搜索楼宇")).toBe(building);
    view.unmount();
    render(
      <TemplateParameters
        call={call}
        template={template}
        buildingIds={[]}
        period="2026-Q3"
        busy={false}
        onGenerate={generate}
      />,
    );
    const field = screen.getByLabelText("搜索团队成员");
    await user.type(field, "姓名");
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: "测试人" } });
    fireEvent.compositionEnd(field);
    await user.click(
      await screen.findByRole("checkbox", { name: "隔离成员 · 测试" }),
    );
    await user.click(screen.getByRole("button", { name: "生成页面" }));
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: "team-multiple", assetIds: [id] }),
    );
    expect(screen.getByLabelText("搜索团队成员")).toBe(field);
  });
  it("keeps chosen buildings and ignores a previous query's late page while the user starts a new search", async () => {
    const user = userEvent.setup();
    const oldPage = [{ id: "old", name: "甲区已选楼宇" }];
    const newPage = [{ id: "new", name: "乙区候选楼宇" }];
    let resolveOld!: (response: { items: { id: string; name: string }[]; next: null }) => void;
    let obsoleteSignal: AbortSignal | undefined;
    const call = vi.fn(async (input: Record<string, unknown>, _write?: boolean, _path?: string, signal?: AbortSignal) => {
      if (input.q === "甲区" && input.offset === 30) {
        obsoleteSignal = signal;
        return new Promise(resolve => { resolveOld = resolve; });
      }
      if (input.q === "甲区") return { items: oldPage, next: 30 };
      if (input.q === "乙区") return { items: newPage, next: null };
      return { items: [], next: null };
    });
    function Selection() {
      const [ids, setIds] = React.useState<string[]>([]);
      return <BuildingPicker call={call as unknown as Call} ids={ids} onChange={setIds} />;
    }
    render(<Selection />);
    const search = screen.getByLabelText("搜索楼宇");
    fireEvent.change(search, { target: { value: "甲区" } });
    await user.click(await screen.findByRole("button", { name: "甲区已选楼宇" }));
    fireEvent.change(search, { target: { value: "临时关键词" } });
    fireEvent.change(search, { target: { value: "甲区" } });
    expect(screen.queryByRole("button", { name: "更多楼宇" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "更多楼宇" }));
    expect(screen.getByRole("button", { name: "正在读取更多楼宇…" })).toBeDisabled();
    expect(call.mock.calls.filter(([input]) => input.offset === 30)).toHaveLength(1);

    search.focus();
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: "yiqu" } });
    fireEvent.change(search, { target: { value: "乙区" } });
    fireEvent.compositionEnd(search, { data: "乙区" });
    expect(screen.queryByRole("button", { name: "更多楼宇" })).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "乙区候选楼宇" });
    expect(obsoleteSignal?.aborted).toBe(true);
    await act(async () => resolveOld({ items: [{ id: "late", name: "甲区迟到结果" }], next: null }));
    expect(screen.queryByRole("button", { name: "甲区迟到结果" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除甲区已选楼宇" })).toBeInTheDocument();
    expect(search).toHaveFocus();
    expect(call.mock.calls.some(([input]) => input.q === "yiqu")).toBe(false);
  });

  it("retries a failed next page without clearing existing results or repeating buildings", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const first = { id, name: "当前候选楼宇" };
    const call = vi.fn(async (input: Record<string, unknown>) => {
      if (input.offset === undefined) return { items: [first], next: 30 };
      if (attempts++ === 0) throw new Error("分页网络中断");
      return { items: [first, { id: "new", name: "下一页楼宇" }], next: null };
    });
    render(<BuildingPicker call={call as unknown as Call} ids={[]} onChange={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "更多楼宇" }));
    await screen.findByText("分页网络中断");
    expect(screen.getByRole("button", { name: "当前候选楼宇" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试读取更多楼宇" }));
    await screen.findByRole("button", { name: "下一页楼宇" });
    expect(screen.getAllByRole("button", { name: "当前候选楼宇" })).toHaveLength(1);
    expect(call.mock.calls.filter(([input]) => input.offset === 30).map(([input]) => input.q)).toEqual(["", ""]);
  });
  it("accepts editable quarter and submarket text without resetting partially typed values or separators", async () => {
    const user = userEvent.setup(),
      generate = vi.fn(async () => {});
    render(
      <TemplateParameters
        call={requests()}
        template={{
          id: "rent-trend",
          name: "租金趋势",
          kind: "dynamic",
          description: "",
        }}
        buildingIds={[]}
        period="2026-Q3"
        busy={false}
        onGenerate={generate}
      />,
    );
    const quarter = screen.getByLabelText("起始季度");
    await user.clear(quarter);
    await user.type(quarter, "2025-Q2");
    expect(quarter).toHaveFocus();
    expect(quarter).toHaveValue("2025-Q2");
    const submarket = screen.getByLabelText("子市场（可选，逗号分隔）");
    await user.type(submarket, "CBD，");
    expect(submarket).toHaveValue("CBD，");
    await user.type(submarket, "中关村");
    fireEvent.compositionStart(submarket);
    fireEvent.compositionEnd(submarket);
    await user.click(screen.getByRole("button", { name: "生成页面" }));
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          start: { year: 2025, quarter: 2 },
          submarkets: ["CBD", "中关村"],
        }),
      }),
    );
  });
  it("exports only selected indices and exposes success only after a ready receipt with downloadable bytes", async () => {
    const user = userEvent.setup(),
      commands: Record<string, unknown>[] = [];
    let status = "pending";
    const call: Call = async <T,>(input: Record<string, unknown>) => {
      commands.push(input);
      return (
        input.action === "export_status"
          ? {
              state: status,
              progress: status === "ready" ? 100 : 30,
              filename: "测试.pptx",
            }
          : input.action === "download"
            ? new Blob(["synthetic file"])
            : { exportId: id }
      ) as T;
    };
    const detail = {
      project: { id, title: "隔离 Pitch" },
      slides: [{ id: "a" }, { id: "b" }, { id: "c" }],
      exports: [],
    } as unknown as WorkspaceDetail;
    render(
      <ExportPanel
        call={call}
        detail={detail}
        active="a"
        selected={["b", "c"]}
        flush={async () => detail}
        canClient={false}
        disabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "导出" }));
    await user.selectOptions(screen.getByLabelText("页面范围"), "selected");
    await user.click(screen.getByRole("button", { name: "生成文件" }));
    await waitFor(() =>
      expect(
        commands.some(
          (c) =>
            c.action === "export_start" && JSON.stringify(c.pages) === "[1,2]",
        ),
      ).toBe(true),
    );
    expect(
      screen.queryByRole("button", { name: "下载已生成文件" }),
    ).not.toBeInTheDocument();
    status = "ready";
    await screen.findByRole(
      "button",
      { name: "下载已生成文件" },
      { timeout: 3000 },
    );
  });
});
