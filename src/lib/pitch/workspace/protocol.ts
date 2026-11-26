import { z } from "zod";
import { scopeSchema, slideContentSchema } from "../contracts/content";
import {
  layoutIdSchema,
  variantSchema,
  slideSceneSchema,
} from "../contracts/scene";
import { objectMoveSchema, objectTextSchema } from "./object-layout";
import { generationPartSchema } from "../business/protocol";
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
export const preferencesSchema = z.strictObject({
  favorites: z.array(z.string().min(1).max(100)).max(100).default([]),
  recent: z.array(z.string().max(100)).max(20).default([]),
});
export const examplePartSchema = z.strictObject({
  mode:z.literal('example'), templateIds:z.array(z.string().regex(/^[a-z0-9-]+$/).max(100)).min(1).max(12).refine(v=>new Set(v).size===v.length),
  kit:z.strictObject({id:z.string().max(100),version:z.number().int().positive()}).optional(),
});
export const bundlePartSchema=z.strictObject({mode:z.literal('bundle'),kit:z.strictObject({id:z.string().max(100),version:z.number().int().positive()}),parts:z.array(generationPartSchema).min(1).max(12)});
export const workspacePartSchema=z.union([generationPartSchema,examplePartSchema,bundlePartSchema]);
export type WorkspacePart=z.infer<typeof workspacePartSchema>;
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
  z.strictObject({ action: z.literal("get"), projectId: id }),
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
    part: workspacePartSchema,
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
    action: z.literal("preferences"),
    value: preferencesSchema.optional(),
  }),
]);
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;
export const workspaceReadSchema = z.discriminatedUnion("action", [
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
