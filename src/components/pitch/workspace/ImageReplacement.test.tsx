import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { ImageReplacement, libraryImagesForReplacement } from "./ImageReplacement";
import type { Call } from "./client";

afterEach(cleanup);

const first = { id: "11111111-1111-4111-8111-111111111111", version: 1, alt: "原入口" };
const second = { id: "22222222-2222-4222-8222-222222222222", version: 2, alt: "原大堂" };
const alternate = { id: "33333333-3333-4333-8333-333333333333", version: 3, alt: "新大堂" };
const source = "44444444-4444-4444-8444-444444444444";
const record = "55555555-5555-4555-8555-555555555555";

it("opens the selected slot and sends the exact published asset version with the other image intact", async () => {
  const user = userEvent.setup();
  const call = vi.fn(async () => ({ items: [alternate] }));
  const onChange = vi.fn();
  const props = { call: call as unknown as Call, selectedIndex: 1, originals: [first, second], disabled: false, onChange };
  const rendered = render(<ImageReplacement {...props} />);
  const library = screen.getByRole("combobox", { name: "所选图片 · 原大堂" });
  await screen.findByRole("option", { name: "新大堂" });
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ action: "search", state: "published", validity: "valid" }),
    false, "library", expect.any(AbortSignal));
  await user.selectOptions(library, `${alternate.id}:${alternate.version}`);
  expect(onChange).toHaveBeenLastCalledWith([first, alternate]);
  rendered.rerender(<ImageReplacement {...props} pending={[first, alternate]} />);
  await user.selectOptions(library, "original");
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});

it("only exposes whole-page library replacement when all image sources can use that save command", () => {
  const slide = { content: { blocks: [first, second].map(image => ({ kind: "image", mediaAssetId: image.id,
    mediaVersion: image.version, alt: image.alt, sourceIds: [source] })), sources: [{ id: source, kind: "document", pageId: source }] },
  scene: { elements: [] } } as unknown as WorkspaceDetail["slides"][number];
  expect(libraryImagesForReplacement(slide)).toEqual([first, second]);
  const mixed = { ...slide, content: { ...slide.content, blocks: slide.content.blocks.map((block, index) =>
    index === 1 ? { ...block, sourceIds: [record] } : block) } };
  expect(libraryImagesForReplacement(mixed)).toBeNull();
  expect(libraryImagesForReplacement({ ...slide, scene: { ...slide.scene, pagination: { index: 0, count: 2 } } })).toBeNull();
});
