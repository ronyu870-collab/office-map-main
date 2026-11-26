import { z } from "zod";
import { nlSchema, recommendationSchema } from "./protocol";
import { workspaceCommandSchema, saveSchema, pageEditSchema } from "../workspace/protocol";
const command = <T extends string>(action: T) =>
  workspaceCommandSchema.options.find(
    (s) =>
      s.shape.action instanceof z.ZodLiteral && s.shape.action.value === action,
  )!;
export const PITCH_TOOL_SCHEMAS = {
  pitch_list_templates: z.strictObject({}),
  pitch_search_assets: recommendationSchema,
  pitch_recommend_cases: recommendationSchema,
  pitch_create_project: command("create"),
  pitch_prepare_slide: nlSchema,
  pitch_generate_slide: command("start"),
  pitch_update_slide: saveSchema.extend({
    pages: z.array(pageEditSchema.omit({ objectMoves: true, objectTexts: true, resetObjectLayout: true })).max(50),
  }),
  pitch_add_slide: command("append"),
  pitch_reorder_slides: z.strictObject({
    projectId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    slideIds: z.array(z.uuid()).min(1).max(50),
  }),
  pitch_export: z.strictObject({
    projectId: z.uuid(),
    exportId: z.uuid(),
    pages: z.array(z.number().int().min(0).max(49)).min(1).max(50).optional(),
  }),
  pitch_suggest_outline: recommendationSchema,
};
export type PitchToolName = keyof typeof PITCH_TOOL_SCHEMAS;
export const PITCH_TOOL_NAMES = new Set<string>(
  Object.keys(PITCH_TOOL_SCHEMAS),
);
// Construct JSON schemas only for an explicit Pitch request, never at ordinary
// Agent module initialization. Mutating tools remain server-registered and are
// not advertised to a preparation-only request.
export const pitchPreparationTools = () =>
  Object.entries(PITCH_TOOL_SCHEMAS)
    .filter(([name]) =>
      [
        "pitch_list_templates",
        "pitch_prepare_slide",
        "pitch_recommend_cases",
        "pitch_suggest_outline",
      ].includes(name),
    )
    .map(([name, schema]) => ({
      type: "function" as const,
      function: {
        name,
        description:
          (
            {
              pitch_list_templates: "列出已发布可用 Pitch 模板。",
              pitch_prepare_slide:
                "将明确单页需求转成待确认模板参数；不生成、不修改文件。未匹配条件需要澄清。",
              pitch_recommend_cases:
                "在已发布且获权案例中推荐，不发送素材正文。",
              pitch_search_assets: "检索获权企业资产，模型只获ID。",
              pitch_suggest_outline: "推荐待用户确认的有限提纲，不自动生成。",
              pitch_export:
                "为获权现有项目生成真实可编辑PPTX；成功以服务端文件回读为准。",
            } as Record<string, string>
          )[name] ??
          "仅在用户明确要求此操作及给出当前项目和版本时使用；服务端重新授权，有界执行。",
        parameters: z.toJSONSchema(schema),
      },
    }));
