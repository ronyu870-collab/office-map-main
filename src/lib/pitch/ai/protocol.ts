import { z } from "zod";
import { scopedModelProfileSchema } from "@/src/lib/intelligence/agent/modelProfile";
import { layoutIdSchema } from "../contracts/scene";
import { scopeSchema } from "../contracts/content";
import { generationPartSchema } from "../business/protocol";

export const AI_VERSION = "pitch-ai/1";
export const taskIds = [
  "classify",
  "extract",
  "summarize",
  "understand-case",
  "match-template",
  "recommend-layout",
  "semantic-search",
  "recommend-cases",
  "market-insight",
  "natural-language",
  "suggest-outline",
  "revise-text",
] as const;
export const taskSchema = z.enum(taskIds);
export type AiTask = z.infer<typeof taskSchema>;
export const TASK_LABELS: Record<AiTask, string> = {
  classify: "内容分类",
  extract: "结构化提取",
  summarize: "内容摘要",
  "understand-case": "案例理解",
  "match-template": "模板匹配",
  "recommend-layout": "布局推荐",
  "semantic-search": "相关内容检索",
  "recommend-cases": "案例推荐",
  "market-insight": "研究观点",
  "natural-language": "自然语言配置",
  "suggest-outline": "提案结构",
  "revise-text": "文字修订",
};
const id = z.uuid(),
  digest = z.string().regex(/^[a-f0-9]{64}$/);
export const configSchema = z.strictObject({
  enabled: z.boolean(),
  revision: z.number().int().positive(),
  default: scopedModelProfileSchema.nullable(),
  extraction: scopedModelProfileSchema.nullable(),
  analysis: scopedModelProfileSchema.nullable(),
  enabledTasks: z.array(taskSchema).max(12),
  maxInputBytes: z.number().int().min(512).max(24000),
  retries: z.number().int().min(0).max(2),
  concurrency: z.number().int().min(1).max(3),
  batchUsd: z.number().min(0.000001).max(10),
  dailyUsd: z.number().min(0.000001).max(100),
  monthlyUsd: z.number().min(0.000001).max(1000),
  fallback: z.literal("none"),
  vision: z.literal(false),
  embedding: z.literal(false),
});
export type AiConfig = z.infer<typeof configSchema>;
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  revision: 1,
  default: null,
  extraction: null,
  analysis: null,
  enabledTasks: [],
  maxInputBytes: 12000,
  retries: 0,
  concurrency: 1,
  batchUsd: 0.25,
  dailyUsd: 1,
  monthlyUsd: 10,
  fallback: "none",
  vision: false,
  embedding: false,
};
export const processingPolicySchema = z
  .strictObject({
    action: z.literal("policy_save"),
    assetId: id,
    version: z.number().int().positive(),
    expectedRevision: z.number().int().nonnegative(),
    mode: z.enum([
      "deterministic_only",
      "controlled_internal_ai",
      "redacted_external",
      "approved_provider",
    ]),
    provider: z.enum(["deepseek", "openai"]).nullable(),
    model: z.string().trim().min(1).max(100).nullable(),
    approvedText: z.string().max(24000),
    reason: z.string().trim().min(1).max(300),
    expiresAt: z.iso.datetime(),
  })
  .superRefine((v, c) => {
    const external = ["redacted_external", "approved_provider"].includes(
      v.mode,
    );
    if (external && (!v.provider || !v.model))
      c.addIssue({ code: "custom", message: "指定供应商及模型" });
    if (v.mode === "redacted_external" && !v.approvedText.trim())
      c.addIssue({ code: "custom", message: "需管理员核对的脱敏文本" });
    if (v.mode !== "redacted_external" && v.approvedText)
      c.addIssue({ code: "custom", message: "此模式不接收脱敏正文" });
  });
export const taskRequestSchema = z.strictObject({
  task: taskSchema,
  assetId: id,
  version: z.number().int().positive(),
  language: z.enum(["zh", "en"]),
  length: z.enum(["brief", "detailed"]).default("brief"),
});
export type TaskRequest = z.infer<typeof taskRequestSchema>;
export const understandingSchema = z.strictObject({
  protocol: z.literal("pitch-understanding/1"),
  purpose: z.string().min(1).max(300),
  category: z.enum([
    "company",
    "team",
    "case",
    "macro",
    "market",
    "building",
    "competition",
    "service",
    "marketing",
    "leasing",
    "implementation",
    "unknown",
  ]),
  facts: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(1000),
        ref: z.string().min(1).max(80),
        quote: z.string().min(1).max(1500),
        kind: z.literal("source_fact"),
      }),
    )
    .max(20),
  summaries: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(1000),
        refs: z.array(z.string().min(1).max(80)).min(1).max(20),
        kind: z.enum(["ai_summary", "ai_suggestion"]),
      }),
    )
    .max(10),
  revisions: z
    .array(
      z.strictObject({
        ref: z.string().min(1).max(80),
        text: z.string().min(1).max(4000),
      }),
    )
    .max(30)
    .default([]),
  unknowns: z.array(z.string().min(1).max(300)).max(10),
  sensitive: z
    .array(
      z.enum([
        "client",
        "personal",
        "commercial",
        "strategy",
        "unpublished",
        "unknown",
      ]),
    )
    .max(6),
  layout: layoutIdSchema,
  templateId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(100)
    .nullable(),
  reusable: z
    .array(
      z.enum([
        "knowledge",
        "page",
        "expression",
        "method",
        "template-candidate",
      ]),
    )
    .max(5),
  temporal: z.enum(["historical", "current-unverified", "forecast", "unknown"]),
});
export type Understanding = z.infer<typeof understandingSchema>;
export const recommendationSchema = z.strictObject({
  q: z.string().trim().max(120).default(""),
  kind: z.enum(["corporate", "team", "case", "research", "custom"]).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  service: z.string().max(100).optional(),
  property: z.string().max(100).optional(),
  submarket: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  objective: z.string().max(200).optional(),
  stage: z.string().max(100).optional(),
  scale: z.number().finite().nonnegative().optional(),
  since: z.iso.date().optional(),
  language: z.enum(["zh", "en"]).default("zh"),
  client: z.boolean().default(false),
  limit: z.number().int().min(1).max(10).default(5),
});
export type Recommendation = z.infer<typeof recommendationSchema>;
export const nlSchema = z.strictObject({
  question: z.string().trim().min(1).max(1000),
  projectId: id.optional(),
  buildingIds: z.array(id).max(20).default([]),
  assetIds: z.array(id).max(30).default([]),
  period: z
    .string()
    .regex(/^20\d{2}-Q[1-4]$/)
    .optional(),
  language: z.enum(["zh", "en"]).default("zh"),
});
export type NlInput = z.infer<typeof nlSchema>;
export const outlineSchema = z.strictObject({
  id,
  title: z.string().min(1).max(160),
  part: generationPartSchema,
});
export const aiCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("config") }),
  z.strictObject({ action: z.literal("config_save"), config: configSchema }),
  processingPolicySchema,
  z.strictObject({ action: z.literal("policies"), assetId: id }),
  z.strictObject({
    action: z.literal("start"),
    batchId: id,
    tasks: z.array(taskRequestSchema).min(1).max(10),
  }),
  z.strictObject({
    action: z.enum(["status", "cancel", "resume"]),
    batchId: id,
  }),
  z.strictObject({
    action: z.literal("recommend"),
    query: recommendationSchema,
  }),
  z.strictObject({ action: z.literal("prepare"), input: nlSchema }),
  z.strictObject({ action: z.literal("outline"), query: recommendationSchema }),
  z.strictObject({
    action: z.literal("feedback"),
    eventId: id,
    event: z.enum([
      "selected",
      "accepted",
      "ignored",
      "corrected",
      "mismatch",
      "failed",
      "layout",
      "combination",
    ]),
    templateId: z.string().max(100).optional(),
    assetId: id.optional(),
    projectId: id.optional(),
    taskId: id.optional(),
    layout: layoutIdSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("submit_candidate"),
    projectId: id,
    slideId: id,
    expectedVersion: z.number().int().positive(),
    candidateId: id,
  }),
  z.strictObject({
    action: z.literal("candidate_preview"),
    candidateId: id,
  }),
  z.strictObject({
    action: z.literal("candidate_review"),
    candidateId: id,
    state: z.enum(["accepted", "rejected", "withdrawn"]),
  }),
  z.strictObject({
    action: z.literal("candidate_materialize"),
    candidateId: id,
    assetId: id,
    categoryId: id,
    scope: scopeSchema,
  }),
  z.strictObject({
    action: z.literal("materialize"),
    taskId: id,
    assetId: id,
    categoryId: id,
    scope: scopeSchema,
  }),
  z.strictObject({
    action: z.literal("operations"),
    offset: z.number().int().min(0).max(10000).default(0),
    task: taskSchema.optional(),
    model: z.string().max(100).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  }),
]);
export type AiCommand = z.infer<typeof aiCommandSchema>;
export const taskRowSchema = z.object({
  id,
  batch_id: id,
  asset_id: id,
  asset_version: z.number().int(),
  request: taskRequestSchema,
  state: z.enum([
    "queued",
    "processing",
    "completed",
    "failed",
    "cancelled",
    "paused",
  ]),
  attempts: z.number().int(),
  cache_key: digest.nullable(),
  result: understandingSchema.nullable(),
  error_code: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
