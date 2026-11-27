import { z } from "zod";
import { mediaRowSchema, pitchRpc, type PitchContext } from "../data/store";
import { loadMedia, studioRegistry } from "../data/renderWorkflow";
import { assertSceneQuality } from "../layout/quality";
import type { WorkspaceDetail, WorkspaceSave } from "../workspace/protocol";
import { resolveVisualPageMedia, type ResolvedVisualMedia } from "../visual-data/resolve";
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

const previewMedia = z.object({ media: z.array(mediaRowSchema) });

export async function readProposalPageMedia(ctx: PitchContext, projectId: string,
  page: Pick<RevisionPage, "content" | "scene">, resolvedMedia?: ResolvedVisualMedia[]) {
  if (!page.scene.elements.some(element => element.kind === "image")) return [];
  const [context, resolved] = await Promise.all([
    pitchRpc(ctx, { action: "preview_context", projectId }),
    resolvedMedia ?? resolveVisualPageMedia(ctx, [page], "internal"),
  ]);
  return loadMedia(ctx, previewMedia.parse(context).media, [page.scene], { resolved });
}

export async function installedLanguageCanvasServices() {
  const { commitPayload } = await import("../workspace/workflow");
  return createProposalCanvasServices({ commitPayload, readPageMedia: readProposalPageMedia });
}
