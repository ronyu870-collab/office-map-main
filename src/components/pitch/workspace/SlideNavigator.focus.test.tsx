import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SlideNavigator } from "./SlideNavigator";

afterEach(cleanup);

const slides = [
  { id: "cover", title: "招商提案" },
  { id: "market", title: "市场分析", section: true },
  { id: "strategy", title: "招商策略" },
];

it("searches by title or original page number without silently dropping selected pages", () => {
  const onRemove = vi.fn(), onOpen = vi.fn(), onMove = vi.fn();
  function Example() {
    const [selected, setSelected] = React.useState<string[]>([]);
    return <SlideNavigator
      slides={slides} active="market" selected={selected} disabled={false}
      onOpen={onOpen} onSelect={setSelected} onCopy={vi.fn()}
      onMove={onMove} onRemove={onRemove}
    />;
  }
  render(<Example />);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择第 1 页" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "选择第 3 页" }), { shiftKey: true });
  expect(screen.getByRole("checkbox", { name: "选择第 2 页" })).toBeChecked();

  fireEvent.change(screen.getByRole("combobox", { name: "跳转章节" }), { target: { value: "market" } });
  expect(onOpen).toHaveBeenCalledWith("market");
  onOpen.mockClear();
  const search = screen.getByRole("searchbox", { name: "搜索页面" });
  fireEvent.change(search, { target: { value: "市场" } });
  expect(screen.queryByRole("button", { name: /打开第 1 页/ })).not.toBeInTheDocument();
  const item = screen.getByRole("button", { name: "打开第 2 页：市场分析" });
  expect(item).toHaveAttribute("aria-current", "page");
  fireEvent.click(item);
  expect(onOpen).toHaveBeenCalledWith("market");
  fireEvent.keyDown(item, { key: "ArrowUp", altKey: true });
  expect(onMove).not.toHaveBeenCalled();

  fireEvent.change(search, { target: { value: "3" } });
  expect(screen.getByRole("button", { name: "打开第 3 页：招商策略" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "删除选中" }));
  expect(onRemove).toHaveBeenCalledWith(["cover", "market", "strategy"]);
});

it("keeps page search focused through empty results and Chinese input", () => {
  render(<SlideNavigator
    slides={slides} active="market" selected={[]} disabled={false}
    onOpen={vi.fn()} onSelect={vi.fn()} onCopy={vi.fn()}
    onMove={vi.fn()} onRemove={vi.fn()}
  />);
  const search = screen.getByRole("searchbox", { name: "搜索页面" });
  search.focus();
  fireEvent.change(search, { target: { value: "无对应结果" } });
  expect(screen.getByText("没有匹配的页面。")).toBeInTheDocument();
  expect(search).toHaveFocus();
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: "市" } });
  fireEvent.compositionEnd(search, { data: "市" });
  expect(search).toHaveFocus();
  expect(screen.getByRole("button", { name: "打开第 2 页：市场分析" })).toBeInTheDocument();
});
