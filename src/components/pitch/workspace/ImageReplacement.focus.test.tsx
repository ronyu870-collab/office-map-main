import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ImageReplacement } from "./ImageReplacement";
import type { Call } from "./client";

afterEach(cleanup);

it("keeps the published image search focused and ignores stale replies before selecting a version", async () => {
  const original = { id: "11111111-1111-4111-8111-111111111111", version: 1, alt: "原外景" };
  const candidate = { id: "22222222-2222-4222-8222-222222222222", version: 3, alt: "新版外景" };
  const stale = { id: "33333333-3333-4333-8333-333333333333", version: 1, alt: "旧搜索结果" };
  type Reply = { items: typeof candidate[] };
  let resolveInitial!: (reply: Reply) => void;
  let resolveSearch!: (reply: Reply) => void;
  const initial = new Promise<Reply>(resolve => { resolveInitial = resolve; });
  const searched = new Promise<Reply>(resolve => { resolveSearch = resolve; });
  const call = vi.fn((command: { q: string }) => command.q ? searched : initial);
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<ImageReplacement call={call as unknown as Call} originals={[original]}
    selectedIndex={0} disabled={false} onChange={onChange} />);

  const search = screen.getByRole("searchbox", { name: "搜索已发布图片" }) as HTMLInputElement;
  expect(search).toHaveFocus();
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  await user.type(search, "外景");
  await waitFor(() => expect(call).toHaveBeenLastCalledWith(
    { action: "search", kind: "media", state: "published", validity: "valid", q: "外景" },
    false, "library", expect.any(AbortSignal),
  ));
  search.setSelectionRange(1, 1);
  await act(async () => resolveSearch({ items: [candidate] }));
  await act(async () => resolveInitial({ items: [stale] }));

  expect(search).toHaveFocus();
  expect(search.selectionStart).toBe(1);
  expect(search).toHaveValue("外景");
  const picker = screen.getByRole("combobox", { name: "所选图片 · 原外景" });
  expect(within(picker).queryByRole("option", { name: "旧搜索结果" })).not.toBeInTheDocument();
  await user.selectOptions(picker, within(picker).getByRole("option", { name: "新版外景" }));
  expect(onChange).toHaveBeenCalledWith([candidate]);
});
