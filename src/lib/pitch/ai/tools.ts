import { z } from "zod";
import { pitchRpc, type PitchContext } from "../data/store";
import { PITCH_TOOL_SCHEMAS, type PitchToolName } from "./toolSchemas";
import { workspaceCommandSchema, saveSchema } from "../workspace/protocol";
import { preparePitch, recommendAssets, suggestOutline } from "./routing";
import {
  getWorkspace,
  saveWorkspace,
  appendWorkspace,
  startWorkspaceTask,
  runWorkspaceTask,
} from "../workspace/workflow";
import {
  prepareRenderExport,
  runRenderExport,
  downloadArtifact,
} from "../data/renderWorkflow";
import { DYNAMIC_CAPABILITIES } from "../business/recipes";
import { recipeSchema } from "../business/protocol";
export async function runPitchTool(
  ctx: PitchContext,
  name: PitchToolName,
  raw: unknown,
) {
  if (process.env.PITCH_STUDIO_ENABLED !== "true")
    throw new Error("PITCH_DENIED");
  const args = PITCH_TOOL_SCHEMAS[name].parse(raw);
  await pitchRpc(ctx, { action: "catalog" });
  if (name === "pitch_list_templates") {
    const catalog = z
      .object({ recipes: z.array(recipeSchema) })
      .parse(await pitchRpc(ctx, { action: "business_catalog" }));
    const capabilities = z
      .object({ allowedDynamic: z.array(z.string()) })
      .parse(await pitchRpc(ctx, { action: "workspace_capabilities" }));
    return {
      status: "ready",
      templates: [
        ...catalog.recipes.filter((r) => r.enabled).map((r) => r.id),
        ...DYNAMIC_CAPABILITIES.filter(
          (t) =>
            t.status === "available" &&
            capabilities.allowedDynamic.includes(t.id),
        ).map((t) => t.id),
      ],
    };
  }
  if (name === "pitch_prepare_slide") {
    const plan = await preparePitch(
      ctx,
      PITCH_TOOL_SCHEMAS.pitch_prepare_slide.parse(args),
    );
    return {
      status:
        plan.status === "requires_clarification"
          ? "requires_clarification"
          : "ready",
      plan,
      workspace: "/intelligence/pitch",
    };
  }
  if (name === "pitch_search_assets" || name === "pitch_recommend_cases") {
    const query = PITCH_TOOL_SCHEMAS.pitch_search_assets.parse(args),
      found = await recommendAssets(ctx, {
        ...query,
        ...(name === "pitch_recommend_cases" ? { kind: "case" as const } : {}),
      });
    // This observation is deliberately body/title/client-name free for the ordinary Agent.
    return {
      status: "ready",
      assetIds: found.items.map((a) => a.id),
      method: found.method,
      hasMore: found.hasMore,
      workspace: "/intelligence/pitch",
    };
  }
  if (name === "pitch_suggest_outline")
    return {
      status: "ready",
      ...(await suggestOutline(
        ctx,
        PITCH_TOOL_SCHEMAS.pitch_suggest_outline.parse(args),
      )),
    };
  if (name === "pitch_export") {
    const c = PITCH_TOOL_SCHEMAS.pitch_export.parse(args),
      command = {
        ...c,
        action: "export_start" as const,
        format: "pptx" as const,
        audience: "internal" as const,
      };
    await prepareRenderExport(ctx, command);
    await runRenderExport(ctx, command);
    const file = await downloadArtifact(ctx, {
      projectId: c.projectId,
      exportId: c.exportId,
      audience: "internal",
    });
    return {
      status: "ready",
      fileGenerated: true,
      exportId: c.exportId,
      bytes: file.bytes.length,
      workspace: "/intelligence/pitch?project=" + c.projectId,
    };
  }
  if (name === "pitch_reorder_slides") {
    const c = PITCH_TOOL_SCHEMAS.pitch_reorder_slides.parse(args),
      current = await getWorkspace(ctx, c.projectId);
    if (
      c.slideIds.length !== current.slides.length ||
      new Set(c.slideIds).size !== c.slideIds.length ||
      c.slideIds.some((id) => !current.slides.some((s) => s.id === id))
    )
      throw new Error("PITCH_INVALID");
    await saveWorkspace(ctx, {
      action: "save",
      projectId: c.projectId,
      expectedVersion: c.expectedVersion,
      title: current.project.title,
      context: current.workspace.context,
      themeId: current.project.theme_id,
      themeVersion: current.project.theme_version,
      pages: c.slideIds.map((id) => ({ id })),
      activeSlide: current.workspace.active_slide,
    });
    return { status: "ready", projectId: c.projectId };
  }
  if (name === "pitch_update_slide") {
    await saveWorkspace(ctx, saveSchema.parse(args));
    return { status: "ready", saved: true };
  }
  const c = workspaceCommandSchema.parse(args);
  if (name === "pitch_create_project" && c.action === "create")
    return pitchRpc(ctx, { ...c, action: "workspace_create" }).then(() => ({
      status: "ready",
      projectId: c.projectId,
    }));
  if (name === "pitch_add_slide" && c.action === "append") {
    await appendWorkspace(ctx, c);
    return { status: "ready", projectId: c.projectId };
  }
  if (name === "pitch_generate_slide" && c.action === "start") {
    await startWorkspaceTask(ctx, c);
    await runWorkspaceTask(ctx, c.projectId, c.taskId);
    const result = z.object({ state: z.string() }).parse(
      await pitchRpc(ctx, {
        action: "workspace_task_status",
        projectId: c.projectId,
        taskId: c.taskId,
      }),
    );
    return {
      status: result.state === "completed" ? "ready" : "limited",
      state: result.state,
      projectId: c.projectId,
      workspace: "/intelligence/pitch?project=" + c.projectId,
    };
  }
  throw new Error("PITCH_INVALID");
}
