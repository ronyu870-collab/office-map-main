import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  authorizePitch,
  pitchRpc,
  type PitchContext,
  type PitchDependencies,
} from "../data/store";
import { readQueryBody } from "@/src/lib/intelligence/query/httpBody";
import { isQuerySameOrigin } from "@/src/lib/intelligence/query/sameOrigin";
import { aiCommandSchema } from "./protocol";
import {
  startAiBatch,
  runAiBatch,
  adoptUnderstanding,
  previewRevision,
  operationsSummary,
} from "./workflow";
import { recommendAssets, preparePitch, suggestOutline } from "./routing";
import type { PreviewProposalQuarter } from "./proposal-revision-runtime";
import type { ProposalExecution } from "./proposal-workflow";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization, x-colliers-impersonate-user",
  "X-Content-Type-Options": "nosniff",
};
const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers });
export async function handleAiRequest(
  request: Request,
  deps: PitchDependencies,
  schedule?: (work: () => Promise<void>) => void,
  previewProposalQuarter?: PreviewProposalQuarter,
  proposalExecution?: (ctx: PitchContext) => ProposalExecution,
) {
  let ctx: Awaited<ReturnType<typeof authorizePitch>> | undefined;
  try {
    ctx = await authorizePitch(request, deps);
    if (request.method !== "POST" || !isQuerySameOrigin(request))
      return reply({ error: "请求来源或方法不受支持。" }, 403);
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") ?? "",
      )
    )
      return reply({ error: "需要 JSON 请求。" }, 415);
    const body = await readQueryBody(request, randomBytes(32));
    if (body.rejection) return reply({ error: "输入过大或传输中断。" }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(body.text ?? "");
    } catch {
      return reply({ error: "输入格式不正确。" }, 400);
    }
    const c = aiCommandSchema.parse(raw);
    if (
      c.action === "start" ||
      c.action === "resume" ||
      c.action === "status"
    ) {
      if (!schedule) throw new Error("PITCH_WORKER_UNAVAILABLE");
      if (c.action === "start") await startAiBatch(ctx, c);
      else if (c.action === "resume")
        await pitchRpc(ctx, { ...c, action: "ai_resume" });
      const tasks = await pitchRpc(ctx, {
        action: "ai_status",
        batchId: c.batchId,
      });
      const worker = { ...ctx, signal: AbortSignal.timeout(30000) };
      schedule(() => runAiBatch(worker, c.batchId));
      return reply(
        { batchId: c.batchId, tasks },
        c.action === "start" ? 202 : 200,
      );
    }
    if (c.action === "recommend")
      return reply(await recommendAssets(ctx, c.query));
    if (c.action === "prepare") return reply(await preparePitch(ctx, c.input));
    if (c.action === "proposal_plan") {
      const { prepareProposal } = await import("./proposal-runtime");
      const { authorizedProposalModel } = await import("./proposal-model");
      return reply(await prepareProposal(ctx, c.input, await authorizedProposalModel(ctx, c.input), proposalExecution?.(ctx).director));
    }
    if (c.action === "proposal_generate") {
      if (proposalExecution) {
        const { director, workflow } = proposalExecution(ctx);
        const { submitConfirmedProposal } = await import("./proposal-workflow");
        const { authorizedProposalModel } = await import("./proposal-model");
        const actor = ctx;
        return reply(await submitConfirmedProposal(c.confirmation, director, workflow, actor.signal,
          () => authorizedProposalModel(actor, c.confirmation.request)));
      }
      const { generateConfirmedProposal } = await import("./proposal-generation-runtime");
      return reply(await generateConfirmedProposal(ctx, c.confirmation));
    }
    if (c.action === "proposal_revision") {
      const { planProposalRevision } = await import("./proposal-revision-runtime");
      return reply(await planProposalRevision(ctx, c.input, previewProposalQuarter));
    }
    if (c.action === "outline")
      return reply(await suggestOutline(ctx, c.query, c.projectId));
    if (c.action === "revision_preview") return reply(await previewRevision(ctx, c.taskId, c));
    if (c.action === "materialize" || c.action === "candidate_materialize")
      return reply(await adoptUnderstanding(ctx, c));
    const result = await pitchRpc(ctx, { ...c, action: "ai_" + c.action });
    if (c.action === "operations") {
      const rows = z
        .object({ tasks: z.array(z.unknown()) })
        .passthrough()
        .parse(result);
      return reply({
        ...rows,
        summary: operationsSummary(rows.tasks.slice(0, 100)),
        next: rows.tasks.length > 100 ? c.offset + 100 : null,
      });
    }
    return reply(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["PITCH_DENIED", "QUERY_DENIED"].includes(code)) {
      // A rejected transaction cannot carry its own audit insert. Record a
      // separate content-free event, with failure surfaced rather than ignored.
      if (ctx)
        try {
          await pitchRpc(
            { ...ctx, signal: AbortSignal.timeout(8000) },
            {
              action: "ai_feedback",
              eventId: crypto.randomUUID(),
              event: "permission_block",
            },
          );
        } catch {
          return reply({ error: "授权及审计服务暂不可用。" }, 503);
        }
      return reply(
        {
          code: "PITCH_DENIED",
          error: "当前资料、模型处理或管理权限未获批准；确定性功能仍可使用。",
        },
        403,
      );
    }
    if (code === "QUERY_UNAUTHENTICATED")
      return reply({ error: "登录状态已变化，请重新进入。" }, 401);
    if (code === "PITCH_AI_PREVIEW_REQUIRED")
      return reply({ code, error: "请重新查看修改前后对照，再确认保存草稿。" }, 409);
    if (code === "PITCH_PROPOSAL_REVIEW_REQUIRED") return reply({ code, error: "来源或范围已变化，请重新审阅提案。" }, 409);
    if (code === "PITCH_PROPOSAL_GENERATION_UNAVAILABLE") return reply({ code, error: "当前提案暂无可提交的生成路径，请查看审阅缺项。" }, 409);
    if (code === "PITCH_CONFLICT")
      return reply({ error: "版本已更新，请重新读取后再保存。" }, 409);
    if (
      error instanceof z.ZodError ||
      code.startsWith("PITCH_AI_") ||
      code === "PITCH_INVALID"
    )
      return reply(
        { error: "输入或模型结果未通过校验，原资料与页面已保留。" },
        422,
      );
    return reply({ error: "操作未完成，请查看任务状态并重试。" }, 503);
  }
}
