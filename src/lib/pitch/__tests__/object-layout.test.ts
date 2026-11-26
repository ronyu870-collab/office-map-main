import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Resvg } from "@resvg/resvg-js";
import { checkScene } from "../layout/quality";
import { STUDIO_THEME } from "../design/theme";
import { layoutSlides } from "../layout/engine";
import { layoutFixture } from "../fixtures/layouts";
import { renderPitchPptx } from "../render/pptx";
import { renderSceneSvg } from "../render/svg";
import { applyObjectMoves, applyObjectTexts, constrainedPosition, constrainedScale, objectId, textAnchors } from "../workspace/object-layout";
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

  it("scales visible graphic objects proportionally in saved scenes, SVG and native PPTX", async () => {
    const element = { kind: "shape", x: 2, y: 3, w: 4, h: 2, fill: "primary", background: false, shape: "rect" } as const;
    const scene = { ...await page(), elements: [element] };
    const index = 0, id = objectId(element, index);
    const scale = .75;
    expect(constrainedScale(scene, element, element, scale)).toBe(scale);
    const resized = applyObjectMoves(scene, [{ id, x: element.x, y: element.y, scale }]);
    expect(resized.elements[index]).toEqual({ ...element, editorId: id, w: element.w * scale, h: element.h * scale });
    const layers = await renderSceneSvg(resized, STUDIO_THEME, [], true);
    expect(layers).toContain(`data-pitch-object="${id}"`);
    const deck = await JSZip.loadAsync(await renderPitchPptx("图形缩放", [{ scene: resized, theme: STUDIO_THEME }], []));
    const xml = await deck.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain(`cx="${Math.round(element.w * scale * 914400)}" cy="${Math.round(element.h * scale * 914400)}"`);
    expect(xml).toContain("<a:prstGeom");
  });

  it("rotates real shape and image DrawingML objects, and checks visual page bounds", async () => {
    const id = "b913b0b9-9512-4c5c-8456-f615edc4bc02";
    const base = await page();
    const shape = { kind: "shape", shape: "rect", fill: "primary", background: false, x: 2, y: 3, w: 4, h: 1 } as const;
    const image = { kind: "image", mediaAssetId: id, mediaVersion: 1, alt: "隔离图片", fit: "contain", x: 9, y: 3, w: 2, h: 2 } as const;
    const scene = { ...base, elements: [shape, image] };
    const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="blue"/></svg>').render().asPng();
    const media = [{ id, version: 1, mime: "image/png" as const, bytes: png }];
    const edited = applyObjectMoves(scene, [
      { id: "object-1", x: shape.x, y: shape.y, rotation: 90 },
      { id: "object-2", x: image.x, y: image.y, rotation: 30 },
    ]);
    const rendered = await renderSceneSvg(edited, STUDIO_THEME, media);
    expect(rendered).toContain("rotate(90 384 336)");
    expect(rendered).toContain("rotate(30 960 384)");
    const deck = await JSZip.loadAsync(await renderPitchPptx("原生旋转验证", [{ scene: edited, theme: STUDIO_THEME }], media));
    const xml = await deck.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toMatch(/<p:sp>[\s\S]*?rot="5400000"[\s\S]*?<\/p:sp>/);
    expect(xml).toMatch(/<p:pic>[\s\S]*?rot="1800000"[\s\S]*?<\/p:pic>/);
    expect(() => applyObjectMoves(scene, [{ id: "object-1", x: 2, y: 0, rotation: 90 }])).toThrow("PITCH_OBJECT_LAYOUT_INVALID");
    const neighbor = { ...shape, x: 3.8, y: 1.7, w: .5, h: .4 };
    expect(await checkScene({ ...edited, elements: [edited.elements[0], neighbor] }, STUDIO_THEME))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "ELEMENT_OVERLAP" })]));
  });

  it("updates canonical content and native text together without touching ambiguous or managed content", async () => {
    const baseline = layoutFixture("executive-summary");
    const scene = await page();
    const anchors = textAnchors(scene, baseline);
    const id = [...anchors.entries()].find(([, anchor]) => anchor.kind === "title")?.[0];
    expect(id).toBeDefined();
    const changed = applyObjectTexts(scene, baseline, [{ id: id!, text: "改稿已核对" }]);
    expect(changed.content.title).toBe("改稿已核对");
    expect(baseline.title).not.toBe(changed.content.title);
    expect(changed.content.blocks).toEqual(baseline.blocks);
    expect(changed.scene.elements.find(element => element.editorId === id)).toMatchObject({ text: "改稿已核对" });
    const deck = await JSZip.loadAsync(await renderPitchPptx("对象文本验证", [{ scene: changed.scene, theme: STUDIO_THEME }], []));
    expect(await deck.file("ppt/slides/slide1.xml")!.async("string")).toContain("<a:t>改稿已核对</a:t>");
    const source = scene.elements.findIndex(element => element.kind === "text" && element.purpose === "source");
    expect(() => applyObjectTexts(scene, baseline, [{ id: objectId(scene.elements[source], source), text: "不可" }])).toThrow("PITCH_OBJECT_TEXT_INVALID");
    expect(textAnchors({ ...scene, pagination: { index: 0, count: 2 } }, baseline).size).toBe(0);
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
      [{ id, x: 0, y: 0, scale: .8 }],
      [{ id, x: 0, y: 0 }, { id, x: 0, y: 0 }],
    ]) expect(() => applyObjectMoves(scene, moves)).toThrow("PITCH_OBJECT_LAYOUT_INVALID");
    expect(constrainedPosition(scene, scene.elements[idx], -2, -1)).toEqual({ x: 0, y: 0 });
    expect(pageEditSchema.safeParse({ id: "11111111-1111-4111-8111-111111111111", scene }).success).toBe(false);
  });
});
