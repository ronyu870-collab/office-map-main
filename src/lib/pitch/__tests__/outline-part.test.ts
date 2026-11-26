import { expect, it } from "vitest";
import { outlineDataParameters, outlinePartSchema, workspaceCommandSchema } from "../workspace/protocol";

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

it("allows a single pinned official data section and rejects broadening, hidden research or extra data sections", () => {
  const parameters = outlineDataParameters([id, other], "2026-Q3");
  const data = { mode: "dynamic", title: "对比", parameters };
  const mixed = { ...outline, parts: [part, data], dataFingerprint: "a".repeat(64) };
  expect(outlinePartSchema.safeParse(mixed).success).toBe(true);
  expect(outlinePartSchema.safeParse({ ...mixed, parts: [data], bindings: [] }).success).toBe(true);
  for (const proposed of [
    { ...mixed, dataFingerprint: undefined },
    { ...mixed, parts: [part] },
    { ...mixed, parts: [part, data, data] },
    { ...mixed, parts: [part, { ...data, researchAssetId: other }] },
    { ...mixed, parts: [part, { ...data, parameters: { ...parameters, inventory: "all_authorized", buildingIds: [] } }] },
    { ...mixed, parts: [part, { ...data, parameters: { ...parameters, start: { year: 2025, quarter: 2 } } }] },
  ]) expect(outlinePartSchema.safeParse(proposed).success).toBe(false);
});
