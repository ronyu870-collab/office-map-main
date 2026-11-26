import { expect, it } from "vitest";
import { prepareRevision, selectRevision } from "../ai/revision-preview";
import { layoutFixture } from "../fixtures/layouts";

it("diffs only changed titles and paragraphs and keeps numbers, original sources and tables untouched", () => {
  const original = layoutFixture("table-insight");
  const i = original.blocks.findIndex(b => b.kind === "paragraph");
  const first = original.blocks[i];
  if (first?.kind !== "paragraph") throw Error("fixture is missing its paragraph");
  const frozen = structuredClone(original);
  const ready = prepareRevision(original, [{ ref: "title", text: "客户版草案" }, { ref: "block:" + i, text: "修改后正文" }], "zh");
  expect(ready.changes).toEqual([
    { id: "title", label: "标题", before: original.title, after: "客户版草案" },
    { id: "block:" + i, label: "正文段落 1", before: first.text, after: "修改后正文" },
  ]);
  expect(ready.content.blocks.filter(b => b.kind === "table")).toEqual(original.blocks.filter(b => b.kind === "table"));
  expect(ready.content.sources).toEqual(original.sources);
  expect(ready.content.disclosure).toBe("internal");
  expect(original).toEqual(frozen);
  expect(ready.preservedBlocks).toBe(original.blocks.length - 1);
});

it("never exposes private source text when only an approved fragment was processed", () => {
  const original = layoutFixture("table-insight");
  const out = prepareRevision(original, [{ ref: "approved:0", text: "Sanitized text" }], "en");
  expect(out.changes).toEqual([{ id: "approved:0", label: "获批脱敏片段", before: null, after: "Sanitized text" }]);
  expect(out.content.blocks.map(b => b.kind)).toEqual(["paragraph"]);
  expect(out.content.title).toBe("Reviewed material");
  expect(out.content.locale).toBe("en");
  expect(() => prepareRevision(original, [{ ref: "approved:0", text: "Sanitized text" }, { ref: "title", text: "unexpected" }], "en")).toThrow("PITCH_AI_REVISION");
});

it("rejects duplicate, out-of-range and non-paragraph block references", () => {
  const original = layoutFixture("table-insight");
  const tableIndex = original.blocks.findIndex(b => b.kind === "table");
  for (const refs of [["title", "title"], ["block:1000"], ["block:" + tableIndex], ["block:00"]]) {
    expect(() => prepareRevision(original, refs.map(ref => ({ ref, text: "unexpected" })), "en")).toThrow("PITCH_AI_REVISION");
  }
});


it("applying a subset preserves every other paragraph and the original language marker", () => {
  const original = layoutFixture("table-insight");
  const index = original.blocks.findIndex(b => b.kind === "paragraph");
  const revisions = [{ ref: "title", text: "Selected English title" }, { ref: "block:" + index, text: "Not selected" }];
  const subset = selectRevision(original, revisions, "en", ["title"]);
  expect(subset.selectedRefs).toEqual(["title"]);
  expect(subset.allChanges).toHaveLength(2);
  expect(subset.content.title).toBe("Selected English title");
  expect(subset.content.locale).toBe(original.locale);
  expect(subset.content.blocks).toEqual(original.blocks);
  expect(() => selectRevision(original, revisions, "en", ["title", "title"])).toThrow("PITCH_AI_PREVIEW_REQUIRED");
  expect(() => selectRevision(original, revisions, "en", ["approved:0"])).toThrow("PITCH_AI_PREVIEW_REQUIRED");
});

it("uses the real renderer for the complete material preview; does not remove unsupported media", async () => {
  const { renderRevisionLayout } = await import("../ai/revision-visual");
  const { STUDIO_THEME } = await import("../design/theme");
  const original = layoutFixture("two-columns");
  const revised = selectRevision(original, [{ ref: "title", text: "新的版式标题" }], "zh");
  const theme = async () => STUDIO_THEME;
  const picture = await renderRevisionLayout(original, revised.content, theme, new AbortController().signal);
  expect(picture?.before.length).toBe(1);
  expect(picture?.after[0]).toMatch(/^<svg/);
  expect(picture?.before[0]).not.toBe(picture?.after[0]);
  const media = layoutFixture("image-text");
  expect(await renderRevisionLayout(media, media, theme, new AbortController().signal)).toBeNull();
});
