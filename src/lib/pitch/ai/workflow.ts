import { z } from "zod";
import { createModelRuntime } from "@/src/lib/intelligence/agent/modelRuntime";
import { modelAvailability } from "@/src/lib/intelligence/agent/modelRuntime";
import { ModelProviderError } from "@/src/lib/intelligence/agent/modelProvider";
import { bindScopedRuntimeControl } from "@/src/lib/intelligence/control/runtimeControl";
import type {
  ModelAdapter,
  ProviderId,
} from "@/src/lib/intelligence/agent/modelProtocol";
import { summarizeModelOperations } from "@/src/lib/intelligence/agent/modelOperationsView";
import { documentTokens } from "@/src/lib/intelligence/knowledge/parser";
import { digest, pitchRpc, type PitchContext } from "../data/store";
import { slideContentSchema, assetInputSchema } from "../contracts/content";
import { stableId } from "../library/extract";
import {
  AI_VERSION,
  configSchema,
  taskRowSchema,
  understandingSchema,
  type AiCommand,
  type Understanding,
} from "./protocol";
import {
  contentEvidence,
  deterministicUnderstanding,
  taskRoute,
  understandingPrompt,
  validateUnderstanding,
} from "./understanding";

export const hash = (v: unknown) =>
  digest(new TextEncoder().encode(JSON.stringify(v)));
type Adapters = Partial<Record<ProviderId, ModelAdapter>>;
export async function startAiBatch(
  ctx: PitchContext,
  c: Extract<AiCommand, { action: "start" }>,
) {
  return pitchRpc(ctx, {
    ...c,
    action: "ai_start",
    requestHash: hash(c.tasks),
    tasks: c.tasks.map((task, i) => ({
      ...task,
      id: stableId(`${ctx.identity.actorId}:${c.batchId}:${i}`),
    })),
  });
}
export async function runAiBatch(
  ctx: PitchContext,
  batchId: string,
  adapters?: Adapters,
) {
  const deadline = Date.now() + 25000;
  for (let step = 0; step < 10 && Date.now() < deadline; step++) {
    ctx.signal.throwIfAborted();
    const raw = await pitchRpc(ctx, { action: "ai_claim", batchId });
    if (!raw) return;
    const task = taskRowSchema.extend({ token: z.uuid() }).parse(raw);
    const base = { taskId: task.id, token: task.token };
    const rpc = (action: string, value: Record<string, unknown> = {}) =>
      pitchRpc(ctx, { ...base, action, ...value });
    try {
      const initial = z
        .object({
          content: slideContentSchema,
          hash: z.string(),
          config: configSchema,
        })
        .parse(await rpc("ai_context"));
      let evidence = contentEvidence(initial.content),
        config = initial.config,
        policyRevision: number | null = null,
        profile = null,
        mode = "deterministic";
      let authorization: Record<string, unknown> | undefined;
      if (taskRoute(task.request.task, initial.content) === "dedicated")
        throw new Error("PITCH_AI_TASK_ROUTE");
      if (taskRoute(task.request.task, initial.content) === "model") {
        const authorized = z
          .object({
            policyRevision: z.number(),
            configRevision: z.number(),
            mode: z.enum(["approved_provider", "redacted_external"]),
            approvedText: z.string(),
            profile: configSchema.shape.default.unwrap(),
            config: configSchema,
          })
          .parse(await rpc("ai_model_authorize"));
        config = authorized.config;
        policyRevision = authorized.policyRevision;
        profile = authorized.profile;
        mode = authorized.mode;
        authorization = {
          policyRevision,
          configRevision: authorized.configRevision,
          mode,
          profile,
        };
        // Redaction is explicit curated text, never a best-effort regex applied to a private document.
        if (mode === "redacted_external")
          evidence = [
            {
              ref: "approved:0",
              text: authorized.approvedText,
              sourceIds: [],
              kind: "paragraph",
            },
          ];
      }
      const payloadBytes = Buffer.byteLength(JSON.stringify(evidence));
      if (profile && payloadBytes > config.maxInputBytes)
        throw new Error("PITCH_AI_CONTEXT_LIMIT");
      const cacheKey = hash({
        protocol: AI_VERSION,
        actor: ctx.identity.actorId,
        asset: task.asset_id,
        version: task.asset_version,
        source: initial.hash,
        request: task.request,
        authorization,
        evidenceHash: hash(evidence),
        parser: "pitch-structure/1",
      });
      const cached = await rpc("ai_cache", { cacheKey });
      if (cached && typeof cached === "object" && "pending" in cached)
        throw new Error("PITCH_AI_DUPLICATE_PENDING");
      if (cached) {
        await rpc("ai_complete", {
          result: understandingSchema.parse(cached),
          cached: true,
        });
        continue;
      }
      let result: Understanding;
      if (!profile) result = deterministicUnderstanding(initial.content);
      else {
        if (
          !adapters?.[profile.provider] &&
          !modelAvailability(ctx.identity.actorId, profile)[profile.provider]
        )
          throw new ModelProviderError("not_configured");
        const revalidate = async () => {
          await rpc("ai_model_authorize");
        };
        const runtime = createModelRuntime({
          actorId: ctx.identity.actorId,
          question: "Pitch Studio authorized " + task.request.task,
          mode: "quick",
          scopedProfile: profile,
          adapters,
          control: await bindScopedRuntimeControl(
            ctx.client,
            ctx.identity,
            ctx.signal,
            task.id,
          ),
          revalidate,
          onReserve: async (r) => {
            const receipt = z
              .object({ allowed: z.boolean() })
              .parse(await rpc("ai_reserve", r));
            if (!receipt.allowed)
              throw new ModelProviderError(
                "budget_exceeded",
                "account_admission",
              );
          },
          onAttempt: async (record) => {
            await pitchRpc(
              { ...ctx, signal: AbortSignal.timeout(8000) },
              { ...base, action: "ai_attempt", record },
            );
          },
        });
        const completed = await runtime.invoke(
          understandingPrompt(
            task.request.task,
            task.request.language,
            task.request.length,
            evidence,
          ),
          ctx.signal,
          undefined,
          "synthesis",
        );
        if (completed.message.calls?.length || !completed.message.content)
          throw new ModelProviderError("invalid_response");
        let parsed: unknown;
        try {
          parsed = JSON.parse(completed.message.content);
        } catch {
          throw new ModelProviderError("invalid_response");
        }
        result = validateUnderstanding(parsed, evidence);
        if (task.request.task === "revise-text") {
          const required = evidence.filter((e) =>
            ["title", "paragraph"].includes(e.kind),
          );
          if (
            !required.length ||
            required.some((e) => !result.revisions.some((r) => r.ref === e.ref))
          )
            throw new Error("PITCH_AI_REVISION");
          if (
            task.request.language === "en" &&
            result.revisions.some((r) => !/[A-Za-z]/.test(r.text))
          )
            throw new Error("PITCH_AI_LANGUAGE");
        }
      }
      await rpc("ai_complete", { result, cached: false });
    } catch (error) {
      const code =
        error instanceof ModelProviderError
          ? error.code
          : ctx.signal.aborted
            ? "cancelled"
            : error instanceof z.ZodError
              ? "invalid_response"
              : error instanceof Error &&
                  ["PITCH_DENIED", "QUERY_DENIED"].includes(error.message)
                ? "authorization_denied"
                : error instanceof Error &&
                    /^PITCH_AI_[A-Z_]+$/.test(error.message)
                  ? error.message
                  : "processing_failed";
      // Never persist provider messages or document fragments as an error.
      await pitchRpc(
        { ...ctx, signal: AbortSignal.timeout(8000) },
        { ...base, action: "ai_fail", errorCode: code },
      );
    }
  }
}
export async function adoptUnderstanding(
  ctx: PitchContext,
  c: Extract<AiCommand, { action: "materialize" | "candidate_materialize" }>,
) {
  let sourceId: string, sourceVersion: number, content;
  if (c.action === "materialize") {
    const task = taskRowSchema.parse(
      await pitchRpc(ctx, { action: "ai_result", taskId: c.taskId }),
    );
    if (!task.result) throw new Error("PITCH_INVALID");
    const stored = z
      .object({ version: z.object({ content: slideContentSchema }) })
      .parse(
        await pitchRpc(ctx, { action: "get_asset", assetId: task.asset_id }),
      );
    const original = stored.version.content;
    const result = understandingSchema.parse(task.result);
    // Original evidence, tables and charts remain intact. Generated opinions are
    // explicitly tagged and stay private/internal until the existing review flow.
    content = slideContentSchema.parse({
      ...original,
      title: original.title,
      disclosure: "internal",
      blocks: [
        ...original.blocks,
        ...result.summaries.map((s) => ({
          kind: "insight",
          claim: s.text,
          basis: "AI 辅助建议，待核对。\n资料日期：" + original.dataAsOf,
          limitations: ["建议不属于已核验业务事实"],
          sourceIds: original.sources.map((s) => s.id),
        })),
      ],
    });
    if (task.request.task === "revise-text") {
      if (!result.revisions.length) throw new Error("PITCH_AI_REVISION");
      if (result.revisions.some((r) => r.ref === "approved:0")) {
        // A redacted authorization does not imply permission to translate the
        // rest of the private page. Explicitly scoped standalone revision.
        content = slideContentSchema.parse({
          ...original,
          locale: task.request.language,
          disclosure: "internal",
          title:
            task.request.language === "en"
              ? "Reviewed material"
              : original.title,
          subtitle:
            task.request.language === "en"
              ? "Revision of approved text; full material retained at source"
              : "仅修订获批脱敏文字；完整内容保留在来源",
          blocks: result.revisions.map((r) => ({
            kind: "paragraph",
            text: r.text,
            sourceIds: original.sources.map((s) => s.id),
          })),
        });
      } else {
        const revisions = new Map(result.revisions.map((r) => [r.ref, r.text]));
        content = slideContentSchema.parse({
          ...original,
          locale: task.request.language,
          disclosure: "internal",
          title: revisions.get("title") ?? original.title,
          blocks: original.blocks.map((b, i) =>
            b.kind === "paragraph"
              ? { ...b, text: revisions.get(`block:${i}`) ?? b.text }
              : b,
          ),
        });
      }
    }
    sourceId = task.asset_id;
    sourceVersion = task.asset_version;
  } else {
    const candidate = z
      .object({
        asset_id: z.uuid(),
        asset_version: z.number(),
        content: slideContentSchema,
        scope: z.unknown(),
      })
      .parse(
        await pitchRpc(ctx, {
          action: "ai_candidate_context",
          candidateId: c.candidateId,
        }),
      );
    if (
      JSON.stringify(candidate.scope) !== JSON.stringify(c.scope) &&
      hash(candidate.scope) !== hash(c.scope)
    ) {
      const same = Object.entries(c.scope).every(
        ([k, v]) => (candidate.scope as Record<string, string>)[k] === v,
      );
      if (!same) throw new Error("PITCH_DENIED");
    }
    content = { ...candidate.content, disclosure: "internal" as const };
    sourceId = candidate.asset_id;
    sourceVersion = candidate.asset_version;
  }
  const asset = assetInputSchema.parse({
    scope: c.scope,
    categoryId: c.categoryId,
    tags: ["待核对"],
    names: { [content.locale]: content.title },
    content,
    state: "draft",
    visibility: "private",
    allowInternalGeneration: true,
    allowClientExport: false,
    allowExternalAi: false,
    validFrom: null,
    validUntil: null,
  });
  return pitchRpc(ctx, {
    action: "ai_adopt",
    ...("taskId" in c ? { taskId: c.taskId } : { candidateId: c.candidateId }),
    assetId: c.assetId,
    asset,
    sha256: hash(content),
    tokens: documentTokens(JSON.stringify(content)),
    sourceId,
    sourceVersion,
  });
}
export function operationsSummary(rows: unknown[]) {
  const parsed = z
    .array(
      z.object({
        state: z.string(),
        cached: z.boolean(),
        task: z.string(),
        error_code: z.string().nullable(),
        created_at: z.string(),
        updated_at: z.string(),
        attempts_log: z.array(z.unknown()),
      }),
    )
    .parse(rows);
  const documents = parsed.flatMap((r) =>
    r.attempts_log.map((record) => ({ content: record })),
  );
  const latency = (values: number[]) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return {
      averageMs: sorted.length
        ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length
        : null,
      p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    };
  };
  const attemptDurations = documents.flatMap(({ content }) => {
    const record = z
      .object({
        protocol: z.literal("agent-model-attempt/1"),
        durationMs: z.number().nonnegative(),
      })
      .safeParse(content);
    return record.success ? [record.data.durationMs] : [];
  });
  return {
    models: summarizeModelOperations(documents),
    count: parsed.length,
    completed: parsed.filter((t) => t.state === "completed").length,
    cacheHits: parsed.filter((t) => t.cached).length,
    queued: parsed.filter((t) => ["queued", "paused"].includes(t.state)).length,
    budgetPauses: parsed.filter((t) => t.error_code === "budget_exceeded")
      .length,
    modelLatency: latency(attemptDurations),
    taskLatency: latency(
      parsed
        .filter((r) => ["completed", "failed", "cancelled"].includes(r.state))
        .map((r) =>
          Math.max(0, Date.parse(r.updated_at) - Date.parse(r.created_at)),
        ),
    ),
    taskCosts: [...new Set(parsed.map((r) => r.task))].map((task) => ({
      task,
      count: parsed.filter((r) => r.task === task).length,
      completed: parsed.filter(
        (r) => r.task === task && r.state === "completed",
      ).length,
      ...summarizeModelOperations(
        parsed
          .filter((r) => r.task === task)
          .flatMap((r) =>
            r.attempts_log.map((record) => ({ content: record })),
          ),
      ),
    })),
    permissionBlocks: parsed.filter(
      (r) => r.error_code === "authorization_denied",
    ).length,
  };
}
