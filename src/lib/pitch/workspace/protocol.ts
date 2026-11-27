import { researchEditions } from '@/src/config/quarterlyResearch';
import { z } from "zod";
import { scopeSchema, slideContentSchema } from "../contracts/content";
import {
  layoutIdSchema,
  variantSchema,
  slideSceneSchema,
} from "../contracts/scene";
import { pageNoteSchema, pageNoteTextSchema, workspaceChartTypeSchema } from "./presentation-edits";
import { objectMoveSchema, objectTextSchema, objectOrderSchema, objectGroupsSchema } from "./object-layout";
import { dynamicParametersSchema, generationPartSchema } from "../business/protocol";
import { revisionRefs } from "../ai/protocol";
import { quarterSchema } from "@/src/lib/intelligence/query/contracts";
const id = z.uuid(),
  title = z.string().trim().min(1).max(160);
export const projectContextSchema = z.strictObject({
  buildingIds: z.array(id).max(20).default([]),
  client: z.string().max(160).default(""),
  business: z.string().max(100).default(""),
  language: z.enum(["zh", "en"]).default("zh"),
  period: z
    .string()
    .regex(/^\d{4}-Q[1-4]$/)
    .or(z.literal(""))
    .default(""),
  notes: z.string().max(2000).default(""),
});
export type ProjectContext = z.infer<typeof projectContextSchema>;
export const pageEditSchema = z.strictObject({
  id,
  duplicateOf: id.optional(),
  title: title.optional(),
  paragraphs: z.array(z.string().min(1).max(4000)).max(50).optional(),
  manualNote: pageNoteTextSchema.nullable().optional(),
  chartPresentation: z.array(z.strictObject({
    blockIndex: z.number().int().min(0).max(49), type: workspaceChartTypeSchema,
  })).min(1).max(10).optional(),
  images: z
    .array(
      z.strictObject({
        id,
        version: z.number().int().positive(),
        alt: z.string().max(400),
      }),
    )
    .max(10)
    .optional(),
  layoutId: layoutIdSchema.optional(),
  variant: variantSchema.optional(),
  objectMoves: z.array(objectMoveSchema).min(1).max(100).optional(),
  objectTexts: z.array(objectTextSchema).min(1).max(30).optional(),
  objectOrder: objectOrderSchema.optional(),
  objectGroups: objectGroupsSchema.optional(),
  resetObjectLayout: z.literal(true).optional(),
});
export const saveSchema = z.strictObject({
  action: z.literal("save"),
  projectId: id,
  expectedVersion: z.number().int().positive(),
  title,
  themeId: z.string().min(1).max(100),
  themeVersion: z.number().int().positive(),
  context: projectContextSchema,
  pages: z.array(pageEditSchema).max(50),
  activeSlide: id.nullable(),
});
export type WorkspaceSave = z.infer<typeof saveSchema>;
const documentModificationSchema = z.strictObject({
  id, projectId: id, expectedVersion: z.number().int().positive(),
  basePageVersions: z.array(z.strictObject({ id, version: z.number().int().positive() })).max(50),
  pages: saveSchema.shape.pages,
  refresh: z.strictObject({ id, version: z.number().int().positive(), contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
});
const dataRefreshOptions = {
  projectId: id, slideId: id, expectedVersion: z.number().int().positive(), period: quarterSchema.optional(),
};
export const preferencesSchema = z.strictObject({
  favorites: z.array(z.string().min(1).max(100)).max(100).default([]),
  recent: z.array(z.string().max(100)).max(20).default([]),
});
export const examplePartSchema = z.strictObject({
  mode:z.literal('example'), templateIds:z.array(z.string().regex(/^[a-z0-9-]+$/).max(100)).min(1).max(12).refine(v=>new Set(v).size===v.length),
  kit:z.strictObject({id:z.string().max(100),version:z.number().int().positive()}).optional(),
});
export const bundlePartSchema=z.strictObject({mode:z.literal('bundle'),kit:z.strictObject({id:z.string().max(100),version:z.number().int().positive()}),parts:z.array(generationPartSchema).min(1).max(12)});
export const outlineBuildingIds = z.array(id).min(1).max(5)
  .refine(ids => new Set(ids).size === ids.length);
export const outlineQuarter = z.string().regex(/^\d{4}-Q[1-4]$/).refine(value =>
  quarterSchema.safeParse({ year: Number(value.slice(0, 4)), quarter: Number(value.at(-1)) }).success);
export const outlineFingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export function outlineDataParameters(buildingIds: string[], period: string) {
  const ids = outlineBuildingIds.parse(buildingIds), key = outlineQuarter.parse(period);
  const quarter = quarterSchema.parse({ year: Number(key.slice(0, 4)), quarter: Number(key.at(-1)) });
  return dynamicParametersSchema.parse({
    templateId: ids.length === 1 ? "building-profile" : "project-comparison",
    buildingIds: ids, inventory: "tracked", submarkets: [],
    period: quarter, start: quarter, end: quarter,
    fields: ["totalArea", "vacantArea", "netEffectiveRent"],
    direction: "asc", chart: "table", from: quarter.year + "-01-01",
    to: quarter.year + "-12-31", leaseSource: "combined", measure: "count",
  });
}
export const outlinePartSchema = z.strictObject({
  mode: z.literal("outline"),
  parts: z.array(generationPartSchema).min(1).max(8),
  bindings: z.array(z.strictObject({ id, version: z.number().int().positive() })).max(80),
  dataFingerprint: outlineFingerprint.optional(),
  compareQuarters: z.literal(true).optional(),
}).superRefine((outline, ctx) => {
  const dynamic = outline.parts.filter(part => part.mode === "dynamic");
  const wanted = new Set(outline.parts.flatMap(part => part.mode === "dynamic" ? [] : part.assetIds));
  const pinned = new Set(outline.bindings.map(binding => binding.id));
  const invalidDynamic = dynamic.some(({ parameters, researchAssetId }) => {
    const { year, quarter } = parameters.period;
    if (researchAssetId || !outlineBuildingIds.safeParse(parameters.buildingIds).success) return true;
    return JSON.stringify(parameters) !== JSON.stringify(outlineDataParameters(parameters.buildingIds, year + "-Q" + quarter));
  });
  if ((outline.compareQuarters && (!dynamic.length || dynamic[0].parameters.period.year < 1901)) ||
    dynamic.length > 1 || Boolean(dynamic.length) !== Boolean(outline.dataFingerprint) || invalidDynamic ||
    outline.parts.some(part => !part.title || (part.mode !== "dynamic" &&
      (part.allowFallback || new Set(part.assetIds).size !== part.assetIds.length))) ||
    pinned.size !== outline.bindings.length || pinned.size !== wanted.size ||
    [...wanted].some(assetId => !pinned.has(assetId))) {
    ctx.addIssue({ code: "custom", message: "Outline must pin every material and the explicitly reviewed building and quarter data" });
  }
});
export type OutlinePart = z.infer<typeof outlinePartSchema>;
export const stackingSelectionSchema = z.strictObject({
  towerIds: z.array(id).min(1).max(2).refine(ids => ids.length === new Set(ids).size).optional(),
  levelRange: z.tuple([z.number().int().min(-200).max(300), z.number().int().min(-200).max(300)])
    .refine(([first, last]) => first <= last).optional(),
});
const stackingHandoffSourceSchema = z.strictObject({
  kind: z.literal("stacking-plan"), buildingId: id, selection: stackingSelectionSchema.default({}),
});
export type StackingHandoffSource = z.infer<typeof stackingHandoffSourceSchema>;

const handoffPartSchema = z.strictObject({
  mode: z.literal("handoff"), parameters: dynamicParametersSchema, language: z.enum(["zh", "en"]),
  dataVersion: outlineFingerprint, permissionRevision: z.string().min(1).max(160), policyVersion: z.string().min(1).max(160),
});
export const stackingHandoffPartSchema = z.strictObject({
  mode: z.literal("handoff"), stackingSource: stackingHandoffSourceSchema, language: z.literal("zh"),
  dataVersion: outlineFingerprint, dataAsOf: z.iso.date().nullable(), observedOn: z.iso.date().optional(),
  permissionRevision: z.string().min(1).max(160), policyVersion: z.string().min(1).max(160),
});
const editableWorkspacePartSchema = z.union([generationPartSchema, examplePartSchema, bundlePartSchema, outlinePartSchema]);
export const workspacePartSchema = z.union([editableWorkspacePartSchema, handoffPartSchema, stackingHandoffPartSchema]);
const leaseHandoffSourceSchema = z.strictObject({
  kind: z.literal("lease-search"),
  dataset: z.enum(["live", "history", "combined"]),
  from: z.iso.date(),
  to: z.iso.date(),
  buildingIds: z.array(id).max(20).default([]),
  submarkets: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  view: z.enum(["transactions", "industry-count", "industry-area"]),
  direction: z.enum(["asc", "desc"]).default("desc"),
}).superRefine((input, ctx) => {
  if (input.from > input.to || Number(input.to.slice(0, 4)) - Number(input.from.slice(0, 4)) > 20)
    ctx.addIssue({ code: "custom", path: ["to"], message: "Invalid lease period" });
  if (new Set(input.buildingIds).size !== input.buildingIds.length || new Set(input.submarkets).size !== input.submarkets.length)
    ctx.addIssue({ code: "custom", message: "Duplicate lease filter" });
});
const handoffSchema = z.strictObject({
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("buildings"), buildingIds: z.array(id).min(1).max(20).refine(ids => new Set(ids).size === ids.length) }),
    z.strictObject({ kind: z.literal("submarket"), key: z.string().trim().min(1).max(80) }),
    z.strictObject({ kind: z.literal("quarterly-research"), edition: z.enum(researchEditions) }),
    z.strictObject({ kind: z.literal("analysis-result"), id, resultId: id.optional() }),
    leaseHandoffSourceSchema,
    stackingHandoffSourceSchema,
  ]),
  projectId: id.optional(), period: outlineQuarter.optional(), language: z.enum(["zh", "en"]).optional(),
}).refine(input => !["lease-search", "stacking-plan", "quarterly-research"].includes(input.source.kind) || !input.period,
  "Dated sources retain their own periods");
export type WorkspaceHandoffInput = z.input<typeof handoffSchema>;
const handoffTargetSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("append"), expectedVersion: z.number().int().positive() }),
  z.strictObject({ mode: z.literal("create"), projectId: id, title, scope: scopeSchema,
    themeId: z.string().min(1).max(100), themeVersion: z.number().int().positive() }),
]);
export type WorkspacePart = z.infer<typeof editableWorkspacePartSchema>;
const revisionCanvasOptions = {
  projectId: id, slideId: id, taskId: id, expectedVersion: z.number().int().positive(),
  selectedRefs: revisionRefs.optional(), revisionFingerprint: outlineFingerprint,
};
export const workspaceCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    projectId: id,
    title,
    scope: scopeSchema,
    themeId: z.string().max(100),
    themeVersion: z.number().int().positive(),
    context: projectContextSchema,
  }),
  z.strictObject({
    action: z.literal("review_outline_data"), projectId: id,
    buildingIds: outlineBuildingIds, period: outlineQuarter, compareQuarters: z.literal(true).optional(),
  }),
  z.strictObject({ action: z.literal("start_canvas_text"), projectId: id, slideId: id,
    expectedVersion: z.number().int().positive(), batchId: id }),
  z.strictObject({ action: z.literal("preview_canvas_revision"), ...revisionCanvasOptions }),
  z.strictObject({ action: z.literal("apply_canvas_revision"), ...revisionCanvasOptions, canvasFingerprint: outlineFingerprint }),
  z.strictObject({ action: z.literal("get"), projectId: id }),
  z.strictObject({ action: z.literal("review_handoff"), handoff: handoffSchema }),
  z.strictObject({ action: z.literal("add_to_pitch"), handoff: handoffSchema, target: handoffTargetSchema, fingerprint: outlineFingerprint, taskId: id })
    .refine(c => Boolean(c.handoff.projectId) === (c.target.mode === "append"), "Append requires an owned Pitch ID"),
  z.strictObject({ action: z.literal("preview_data_refresh"), ...dataRefreshOptions }),
  z.strictObject({ action: z.literal("apply_data_refresh"), ...dataRefreshOptions, fingerprint: outlineFingerprint }),
  z.strictObject({
    action: z.literal("apply_modification"),
    plan: documentModificationSchema,
    scope: z.enum(["selected", "document"]).default("selected"),
    theme: z.strictObject({ id: z.string().min(1).max(100), version: z.number().int().positive() }).optional(),
  }),
  saveSchema,
  z.strictObject({
    action: z.literal("append"),
    projectId: id,
    expectedVersion: z.number().int().positive(),
    sourceProjectId: id,
  }),
  z.strictObject({
    action: z.literal("custom"),
    projectId: id,
    expectedVersion: z.number().int().positive(),
    title,
    body: z.string().trim().min(1).max(12000),
    image: z
      .strictObject({
        id,
        version: z.number().int().positive(),
        alt: z.string().max(400),
      })
      .optional(),
  }),
  z.strictObject({
    action: z.literal("start"),
    projectId: id,
    expectedVersion: z.number().int().positive(),
    taskId: id,
    part: editableWorkspacePartSchema,
    replaceIds: z.array(id).max(50).default([]),
  }),
  z.strictObject({
    action: z.enum(["status", "cancel", "retry"]),
    projectId: id,
    taskId: id,
  }),
  z.strictObject({
    action: z.literal("restore_page"),
    projectId: id,
    slideId: id,
    expectedVersion: z.number().int().positive(),
    revision: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("restore"),
    projectId: id,
    expectedVersion: z.number().int().positive(),
    revision: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("copy"),
    projectId: id,
    newProjectId: id,
    title,
    revision: z.number().int().positive().optional(),
  }),
  z.strictObject({
    action: z.literal("lifecycle"),
    projectId: id,
    expectedVersion: z.number().int().positive(),
    state: z.enum(["draft", "archived", "deleted"]),
  }),
  z.strictObject({
    action: z.literal("share_create"), projectId: id, shareId: id, expectedVersion: z.number().int().positive(),
    recipientId: id, expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    slideIds: z.array(id).min(1).max(50).refine(ids => new Set(ids).size === ids.length).optional(),
  }),
  z.strictObject({ action: z.literal("share_revoke"), projectId: id, shareId: id }),
  z.strictObject({
    action: z.literal("preferences"),
    value: preferencesSchema.optional(),
  }),
]);
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;
export const workspaceReadSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("shares"), projectId: id }),
  z.strictObject({ action: z.literal("shared_presentation"), shareId: id }),
  z.strictObject({ action: z.literal("shared_slide"), shareId: id, slideId: id }),
  z.strictObject({ action: z.literal("document_bindings"), projectId: id }),
  z.strictObject({
    action: z.literal("list"),
    q: z.string().max(120).default(""),
    filter: z.enum(["active", "archived", "deleted"]).default("active"),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  }),
  z.strictObject({ action: z.literal("preferences") }),
  z.strictObject({
    action: z.literal("thumbnail"),
    templateId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100),
    theme: z.enum(["default", "alternate"]).default("default"),
  }),
  z.strictObject({ action: z.literal("capabilities") }),
  z.strictObject({
    action: z.literal("admin"),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  }),
]);

const settingSchema = z
  .object({
    manual: z.boolean().optional(),
    note: pageNoteSchema.optional(),
    origin: z.enum(["asset", "data", "user"]).optional(),
    part: z.unknown().optional(),
  })
  .passthrough();
export const workspaceDetailSchema = z.object({
  project: z
    .object({
      id: z.uuid(),
      title: z.string(),
      version: z.number(),
      theme_id: z.string(),
      theme_version: z.number(),
      organization_id: z.string(),
      region: z.string(),
      city: z.string(),
      business_line: z.string(),
    })
    .passthrough(),
  slides: z.array(
    z.object({
      id: z.uuid(),
      version: z.number().int().positive().optional(),
      asset_id: z.uuid(),
      asset_version: z.number(),
      template_id: z.string(),
      template_version: z.number(),
      content: slideContentSchema,
      scene: slideSceneSchema,
    }),
  ),
  workspace: z.object({
    context: projectContextSchema,
    page_settings: z.record(z.string(), settingSchema),
    active_slide: z.string().nullable(),
  }),
  history: z.array(z.object({ version: z.number(), created_at: z.string() })),
  tasks: z.array(z.record(z.string(), z.unknown())),
  exports: z.array(z.record(z.string(), z.unknown())),
});
export type WorkspaceDetail = z.infer<typeof workspaceDetailSchema>;
