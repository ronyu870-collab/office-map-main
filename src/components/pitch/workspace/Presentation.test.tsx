import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Presentation } from "./Presentation";

afterEach(cleanup);

it("presents from the selected slide, jumps by keyboard or selector, and exits without editing", () => {
  render(<Presentation active="second" onRetry={vi.fn()} slides={[
    { id: "first", title: "封面", image: "data:image/svg+xml,cover" },
    { id: "second", title: "市场", image: "data:image/svg+xml,market" },
  ]} />);
  fireEvent.click(screen.getByRole("button", { name: "演示" }));
  const dialog = screen.getByRole("dialog", { name: "演示文稿" });
  const stage = within(dialog).getByRole("region", { name: "演示画布" });
  expect(within(stage).getByRole("img", { name: "市场" })).toBeInTheDocument();
  fireEvent.keyDown(within(dialog).getByRole("button", { name: "退出演示" }), { key: "Home" });
  expect(within(stage).getByRole("img", { name: "封面" })).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("跳到页面"), { target: { value: "second" } });
  expect(within(stage).getByRole("img", { name: "市场" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "退出演示" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
