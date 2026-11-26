import { expect, it } from "vitest";
import { outlinePartSchema, workspaceCommandSchema } from "../workspace/protocol";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const part = { mode: "static", templateId: "corporate-overview", title: "章节一",
  assetIds: [id], length: "brief", allowFallback: false, variant: "standard" } as const;
const outline = { mode: "outline", parts: [part, { ...part, title: "章节二" }], bindings: [{ id, version: 3 }] };

it("accepts a complete reviewed outline as one workspace command, pinning duplicate reuse once", () => {
  const result = workspaceCommandSchema.safeParse({
    action: "start", projectId: id, taskId: other, expectedVersion: 1, replaceIds: [], part: outline,
  });
  expect(result.success).toBe(true);
  expect(result.success && result.data.action === "start" && result.data.part).toEqual(outline);
});

it("rejects omitted or extraneous bindings, source fallback and untitled chapters", () => {
  for (const value of [
    { ...outline, bindings: [] },
    { ...outline, bindings: [{ id: other, version: 3 }] },
    { ...outline, bindings: [...outline.bindings, { id: other, version: 3 }] },
    { ...outline, bindings: [...outline.bindings, { id, version: 4 }] },
    { ...outline, parts: [{ ...part, title: "" }] },
    { ...outline, parts: [{ ...part, allowFallback: true }] },
  ]) expect(outlinePartSchema.safeParse(value).success).toBe(false);
});
