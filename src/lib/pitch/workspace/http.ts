import { randomBytes } from "node:crypto";
import { z } from "zod";
import { runAiBatch } from "../ai/workflow";
import {
  authorizePitch,
  pitchRpc,
  type PitchDependencies,
} from "../data/store";
import { readQueryBody } from "@/src/lib/intelligence/query/httpBody";
import { isQuerySameOrigin } from "@/src/lib/intelligence/query/sameOrigin";
import { LayoutError } from "../layout/metrics";
import { DocumentError } from "@/src/lib/intelligence/knowledge/safeArchive";
import { workspaceReadSchema, workspaceCommandSchema } from "./protocol";
import {
  getWorkspace,
  saveWorkspace,
  appendWorkspace,
  customWorkspace,
  copyWorkspace,
  restoreWorkspace,
  restoreWorkspacePage,
  reviewOutlineData,
  startCanvasText,
  previewCanvasRevision,
  applyCanvasRevision,
  startWorkspaceTask,
  runWorkspaceTask,
} from "./workflow";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization, x-colliers-impersonate-user",
  "X-Content-Type-Options": "nosniff",
};
const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers });
export async function handleWorkspaceRequest(
  request: Request,
  deps: PitchDependencies,
  schedule?: (task: () => Promise<void>) => void,
) {
  try {
    const ctx = await authorizePitch(request, deps);
    if (!isQuerySameOrigin(request))
      return reply({ error: "请求来源不受信任。" }, 403);
    if (request.method === "GET") {
      const c = workspaceReadSchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (c.action === "thumbnail")
        return reply(
          await (
            await import("./thumbnail")
          ).templateThumbnail(ctx, c.templateId, c.theme),
        );
      const value = await pitchRpc(ctx, {
        ...c,
        action: "workspace_" + c.action,
      });
      if (c.action === "list") {
        const rows = z.array(z.unknown()).parse(value);
        return reply({
          items: rows.slice(0, 30),
          next: rows.length > 30 ? c.offset + 30 : null,
        });
      }
      return reply(value);
    }
    if (request.method !== "POST")
      return reply({ error: "不支持此方法。" }, 405);
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") ?? "",
      )
    )
      return reply({ error: "需要 JSON 请求。" }, 415);
    const body = await readQueryBody(request, randomBytes(32));
    if (body.rejection)
      return reply(
        { error: "本次编辑内容过大或传输中断，请分批保存。" },
        body.rejection === "body_too_large" ? 413 : 400,
      );
    let raw: unknown;
    try {
      raw = JSON.parse(body.text ?? "");
    } catch {
      return reply({ error: "JSON 格式不合法。" }, 400);
    }
    const c = workspaceCommandSchema.parse(raw);
    if (c.action === "get") return reply(await getWorkspace(ctx, c.projectId));
    if (c.action === "start_canvas_text") {
      if (!schedule) throw new Error("PITCH_WORKER_UNAVAILABLE");
      const receipt = await startCanvasText(ctx, c);
      schedule(() => runAiBatch({ ...ctx, signal: AbortSignal.timeout(30000) }, c.batchId));
      return reply(receipt, 202);
    }
    if (c.action === "preview_canvas_revision") return reply(await previewCanvasRevision(ctx, c));
    if (c.action === "apply_canvas_revision") return reply(await applyCanvasRevision(ctx, c));
    if (c.action === "review_outline_data") return reply(await reviewOutlineData(ctx, c));
    if (c.action === "save") return reply(await saveWorkspace(ctx, c));
    if (c.action === "append") return reply(await appendWorkspace(ctx, c));
    if (c.action === "custom") return reply(await customWorkspace(ctx, c));
    if (c.action === "copy") return reply(await copyWorkspace(ctx, c));
    if (c.action === "restore") return reply(await restoreWorkspace(ctx, c));
    if (c.action === "restore_page") return reply(await restoreWorkspacePage(ctx, c));
    if (c.action === "start" || c.action === "retry") {
      if (!schedule) throw new Error("PITCH_WORKER_UNAVAILABLE");
      const receipt =
        c.action === "start"
          ? await startWorkspaceTask(ctx, c)
          : await pitchRpc(ctx, { ...c, action: "workspace_task_retry" });
      schedule(() =>
        runWorkspaceTask(
          { ...ctx, signal: AbortSignal.timeout(45000) },
          c.projectId,
          c.taskId,
        ),
      );
      return reply(receipt, 202);
    }
    if (c.action === "status" || c.action === "cancel")
      return reply(
        await pitchRpc(ctx, {
          ...c,
          action:
            c.action === "status"
              ? "workspace_task_status"
              : "workspace_task_cancel",
        }),
      );
    const result = await pitchRpc(ctx, {
      ...c,
      action: "workspace_" + c.action,
    });
    if (c.action === "create")
      return reply(await getWorkspace(ctx, c.projectId));
    return reply(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "QUERY_UNAUTHENTICATED")
      return reply({ error: "登录已变化或正在模拟身份，请重新进入。" }, 401);
    if (["PITCH_DENIED", "QUERY_DENIED"].includes(code))
      return reply(
        { error: "素材已撤回、过期或当前权限不足，请重新选择内容。" },
        403,
      );
    if (code === "PITCH_CANVAS_REVISION_PERMISSION")
      return reply({ code, error: "本素材没有仍有效的完整文字处理授权，未启动模型。" }, 403);
    if (code === "PITCH_CANVAS_REVISION_UNAVAILABLE")
      return reply({ code, error: "当前页不是原素材的未编辑单页，或无法完整预览。可以保留为私有素材草稿。" }, 422);
    if (code === "PITCH_AI_PREVIEW_REQUIRED")
      return reply({ code, error: "修订版本已变化，请重新确认已选文字。" }, 409);
    if (code === "PITCH_CONFLICT")
      return reply(
        {
          code,
          error:
            "其他窗口或后台任务已更新此 Pitch。你的编辑仍保留，请重新读取或另存副本。",
        },
        409,
      );
    if (error instanceof LayoutError || error instanceof DocumentError)
      return reply({ code: error.code, error: error.detail }, 422);
    if (
      error instanceof z.ZodError ||
      (code.startsWith("PITCH_") && !code.includes("UNAVAILABLE"))
    )
      return reply(
        {
          code,
          error:
            code === "PITCH_OUTLINE_DATA_CHANGED"
              ? "关联楼宇或季度已变化，请重新核对提纲里的正式数据。"
              : code === "PITCH_PAGINATED_EDIT"
              ? "此内容已自动分页，请修改原素材后重新生成整组页面。"
              : code === "PITCH_OBJECT_LAYOUT_RESET_REQUIRED"
                ? "此页已手动摆放对象。若要重新排版，请先明确恢复自动布局。"
              : code === "PITCH_OBJECT_HISTORY_UNAVAILABLE"
                ? "此页的原版本已不可恢复，请从项目历史核对。"
              : code === "PITCH_OBJECT_TEXT_INVALID"
                ? "这段文字不能直接修改，请检查是否为跨页或受保护的内容。"
              : code === "PITCH_OBJECT_GROUP_INVALID"
                ? "组合只能包含当前页面的可编辑对象，每个对象最多属于一个组合。"
              : code === "PITCH_OBJECT_ORDER_INVALID"
                ? "图层已变化，请重新打开页面后再调整顺序。"
              : code === "PITCH_OBJECT_LAYOUT_INVALID"
                ? "对象已变更或位置超出页面，请重试。"
              : code === "PITCH_THEME_REPAGINATION"
                ? "新设计改变了分页数量，请重新生成整组页面；旧页面已保留。"
                : "配置不完整或超过页面容量，请调整后重试。",
        },
        422,
      );
    return reply({ error: "操作未完成，已保留原页面，请重试。" }, 503);
  }
}
