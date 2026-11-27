import { z } from "zod";
import { mediaRowSchema, pitchRpc, type PitchContext } from "../data/store";
import { loadMedia, studioRegistry } from "../data/renderWorkflow";
import { assertSceneQuality } from "../layout/quality";
import type { WorkspaceDetail, WorkspaceSave } from "../workspace/protocol";
import { getWorkspace } from "../workspace/workflow";

export type RevisionPage = WorkspaceDetail["slides"][number] & { version: number };
export type RevisionWorkspace = Omit<WorkspaceDetail, "slides"> & { slides: RevisionPage[] };
type ProjectLanguage = WorkspaceSave["context"]["language"];
export type CanvasServices = {
  verifyPage(ctx: PitchContext, projectId: string, page: RevisionPage): Promise<void>;
  persist(ctx: PitchContext, current: RevisionWorkspace, pages: RevisionPage[], projectLanguage?: ProjectLanguage): Promise<WorkspaceDetail>;
};

export type CanvasBinding = {
  readPageMedia(ctx: PitchContext, projectId: string, page: RevisionPage): Promise<Parameters<typeof assertSceneQuality>[2]>;
  commitPayload(ctx: PitchContext, current: RevisionWorkspace, pages: RevisionPage[],
    settings: RevisionWorkspace["workspace"]["page_settings"], options?: Pick<WorkspaceSave, "context">): Promise<Record<string, unknown>>;
};

export function createProposalCanvasServices({ readPageMedia, commitPayload }: CanvasBinding): CanvasServices {
  return {
    async verifyPage(ctx, projectId, page) {
      const { theme } = await studioRegistry(ctx, page.scene.themeId, page.scene.themeVersion);
      await assertSceneQuality(page.scene, theme.definition, await readPageMedia(ctx, projectId, page));
    },
    async persist(ctx, current, updated, projectLanguage) {
      const replacements = new Map(updated.map(page => [page.id, page]));
      const pages = current.slides.map(page => replacements.get(page.id) ?? page);
      const settings = { ...current.workspace.page_settings };
      for (const page of updated) settings[page.id] = { ...settings[page.id], manual: true };
      const options = projectLanguage ? { context: { ...current.workspace.context, language: projectLanguage } } : undefined;
      const payload = await commitPayload(ctx, current, pages, settings, options);
      if (payload.projectId !== current.project.id || payload.expectedVersion !== current.project.version) throw new Error("PITCH_INVALID");
      ctx.signal.throwIfAborted();
      await pitchRpc(ctx, { ...payload, action: "workspace_save" });
      return getWorkspace(ctx, current.project.id);
    },
  };
}

export async function installedLanguageCanvasServices() {
  const commitPayload: unknown = Reflect.get(await import("../workspace/workflow"), "commitPayload");
  if (typeof commitPayload !== "function") return undefined;
  return createProposalCanvasServices({
    commitPayload: commitPayload as CanvasBinding["commitPayload"],
    async readPageMedia(ctx, projectId, page) {
      const usesImages = page.scene.elements.some(element => element.kind === "image");
      if (!usesImages) return [];
      const { media } = z.object({ media: z.array(mediaRowSchema) }).parse(await pitchRpc(ctx, { action: "preview_context", projectId }));
      return loadMedia(ctx, media, [page.scene]);
    },
  });
}
