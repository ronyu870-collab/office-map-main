import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { STUDIO_THEME } from "../design/theme";
import { layoutSlides } from "../layout/engine";
import { layoutFixture } from "../fixtures/layouts";
import { renderPitchPptx } from "../render/pptx";
import { renderSceneSvg } from "../render/svg";
import { applyObjectMoves, constrainedPosition, objectId } from "../workspace/object-layout";
import { pageEditSchema } from "../workspace/protocol";

const page = async () => (await layoutSlides(layoutFixture("executive-summary"), STUDIO_THEME, "executive-summary"))[0];

describe("editable scene positions", () => {
  it("keeps moved objects native in PPTX, sets stable IDs, and renders identical positions in SVG", async () => {
    const original = await page();
    const index = original.elements.findIndex(element => element.kind === "text" && element.role === "title" && !element.purpose);
    const title = original.elements[index];
    expect(title.kind).toBe("text");
    const id = objectId(title, index), x = title.x - .05;
    const revised = applyObjectMoves(original, [{ id, x, y: title.y }]);
    expect(revised.elements[index]).toEqual({ ...title, editorId: id, x });
    expect(original.elements[index].editorId).toBeUndefined();
    const reopened = JSON.parse(JSON.stringify(revised));
    const later = applyObjectMoves(reopened, [{ id, x: title.x, y: title.y }]);
    expect(later.elements[index].editorId).toBe(id);

    const layers = await renderSceneSvg(revised, STUDIO_THEME, [], true);
    expect(layers).toContain(`data-pitch-object="${id}"`);
    expect(await renderSceneSvg(revised, STUDIO_THEME, [])).not.toContain("data-pitch-object");
    const bytes = await renderPitchPptx("对象位置验证", [{ scene: revised, theme: STUDIO_THEME }], []);
    const deck = await JSZip.loadAsync(bytes);
    const xml = await deck.file("ppt/slides/slide1.xml")!.async("string");
    const shape = Array.from(xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)).find(match => match[0].includes(title.kind === "text" ? title.text : ""))?.[0];
    expect(shape).toContain("<a:t>");
    expect(shape).toContain(`x="${Math.round(x * 914400)}"`);
    expect(deck.file("ppt/slides/slide2.xml")).toBeNull();
  });

  it("rejects unknown, repeated, managed and out-of-bounds objects and arbitrary replacement scene data", async () => {
    const scene = await page();
    const idx = scene.elements.findIndex(e => e.kind === "text" && e.role === "title" && !e.purpose);
    const id = objectId(scene.elements[idx], idx);
    const locked = scene.elements.findIndex(e => e.kind === "brand" || e.kind === "text" && e.purpose === "footer");
    expect(locked).toBeGreaterThanOrEqual(0);
    for (const moves of [
      [{ id: "object-999", x: 0, y: 0 }],
      [{ id: objectId(scene.elements[locked], locked), x: 0, y: 0 }],
      [{ id, x: 13, y: 0 }],
      [{ id, x: 0, y: 0 }, { id, x: 0, y: 0 }],
    ]) expect(() => applyObjectMoves(scene, moves)).toThrow("PITCH_OBJECT_LAYOUT_INVALID");
    expect(constrainedPosition(scene, scene.elements[idx], -2, -1)).toEqual({ x: 0, y: 0 });
    expect(pageEditSchema.safeParse({ id: "11111111-1111-4111-8111-111111111111", scene }).success).toBe(false);
  });
});
