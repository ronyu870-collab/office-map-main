import { randomUUID } from "node:crypto";
import { z } from "zod";
import { slideContentSchema, type SlideContent } from "../contracts/content";
import { type LayoutId } from "../contracts/scene";
import { pitchRpc, digest, type PitchContext } from "../data/store";
import { loadMedia, studioRegistry } from "../data/renderWorkflow";
import { layoutSlides, sceneSourceLine } from "../layout/engine";
import { numberDeckPages } from "../layout/pagination";
import { sceneComponents } from "../layout/components";
import { sceneFont } from "../layout/metrics";
import { assertSceneQuality } from "../layout/quality";
import { generateBusinessProject } from "../business/workflow";
import { generationSchema } from "../business/protocol";
import { workspacePartSchema, type WorkspaceCommand, type WorkspaceSave } from "./protocol";
import { workspaceDetailSchema, type WorkspaceDetail } from "./protocol";
import { applyObjectMoves, applyObjectTexts, applyObjectOrder, applyObjectGroups } from "./object-layout";
type Page = WorkspaceDetail["slides"][number];
type Settings = WorkspaceDetail["workspace"]["page_settings"];
export async function getWorkspace(ctx: PitchContext, id: string) {
  return workspaceDetailSchema.parse(
    await pitchRpc(ctx, { action: "workspace_get", projectId: id }),
  );
}
function checkVersion(current: WorkspaceDetail, expected: number) {
  if (current.project.version !== expected) throw new Error("PITCH_CONFLICT");
}
async function commitPayload(
  ctx: PitchContext,
  current: WorkspaceDetail,
  pages: Page[],
  settings: Settings,
  options?: Partial<
    Pick<
      WorkspaceSave,
      "title" | "themeId" | "themeVersion" | "context" | "activeSlide"
    >
  >,
) {
  if (pages.length > 50) throw new Error("PITCH_PAGE_LIMIT");
  const themes = await Promise.all(
    [
      ...new Set(
        pages.map((p) => p.scene.themeId + ":" + p.scene.themeVersion),
      ),
    ].map(async (key) => {
      const page = pages.find(
        (p) => p.scene.themeId + ":" + p.scene.themeVersion === key,
      )!;
      return (
        await studioRegistry(ctx, page.scene.themeId, page.scene.themeVersion)
      ).theme.definition;
    }),
  );
  const numbered = numberDeckPages(
    pages.map((p) => ({
      ...p,
      theme: themes.find(
        (t) => t.id === p.scene.themeId && t.version === p.scene.themeVersion,
      )!,
    })),
  );
  const liveIds = new Set(pages.map((p) => p.id));
  return {
    projectId: current.project.id,
    expectedVersion: current.project.version,
    title: options?.title ?? current.project.title,
    themeId: options?.themeId ?? current.project.theme_id,
    themeVersion: options?.themeVersion ?? current.project.theme_version,
    context: options?.context ?? current.workspace.context,
    activeSlide: liveIds.has(
      options?.activeSlide ?? current.workspace.active_slide ?? "",
    )
      ? (options?.activeSlide ?? current.workspace.active_slide)
      : (pages[0]?.id ?? null),
    settings: Object.fromEntries(
      Object.entries(settings).filter(([id]) => liveIds.has(id)),
    ),
    slides: numbered.map((p) => ({
      id: p.id,
      assetId: p.asset_id,
      assetVersion: p.asset_version,
      templateId: p.template_id,
      templateVersion: p.template_version,
      content: p.content,
      scene: p.scene,
    })),
  };
}
export async function saveWorkspace(ctx: PitchContext, command: WorkspaceSave) {
  const current = await getWorkspace(ctx, command.projectId);
  checkVersion(current, command.expectedVersion);
  if (new Set(command.pages.map((p) => p.id)).size !== command.pages.length)
    throw new Error("PITCH_INVALID");
  const theme = (
    await studioRegistry(ctx, command.themeId, command.themeVersion)
  ).theme.definition;
  const pages: Page[] = [],
    settings: Settings = { ...current.workspace.page_settings };
  const mediaContext = z
    .object({ media: z.array((await import("../data/store")).mediaRowSchema) })
    .parse(
      await pitchRpc(ctx, {
        action: "preview_context",
        projectId: command.projectId,
      }),
    );
  for (const edit of command.pages) {
    const original = current.slides.find(
      (p) => p.id === (edit.duplicateOf ?? edit.id),
    );
    if (
      !original ||
      (edit.duplicateOf && current.slides.some((p) => p.id === edit.id))
    )
      throw new Error("PITCH_INVALID");
    const prior = settings[original.id] ?? {};
    let content: SlideContent = structuredClone(original.content);
    if (edit.title) content.title = edit.title;
    if (edit.paragraphs) {
      if ((original.scene.pagination?.count ?? 1) > 1)
        throw new Error("PITCH_PAGINATED_EDIT");
      const count = content.blocks.filter((b) => b.kind === "paragraph").length;
      if (count !== edit.paragraphs.length) throw new Error("PITCH_INVALID");
      let n = 0;
      content.blocks = content.blocks.map((b) =>
        b.kind === "paragraph" ? { ...b, text: edit.paragraphs![n++] } : b,
      );
    }
    if (edit.images) {
      if (
        edit.images.length !==
        content.blocks.filter((b) => b.kind === "image").length
      )
        throw new Error("PITCH_INVALID");
      let imageIndex = 0;
      content.blocks = content.blocks.map((b) => {
        if (b.kind !== "image") return b;
        const image = edit.images![imageIndex++];
        return {
          ...b,
          mediaAssetId: image.id,
          mediaVersion: image.version,
          alt: image.alt,
        };
      });
      for (const image of edit.images) {
        mediaContext.media.push(
          (await import("../data/store")).mediaRowSchema.parse(
            await pitchRpc(ctx, {
              action: "library_media_file",
              mediaId: image.id,
              version: image.version,
            }),
          ),
        );
        const provenance = await mediaProvenance(
            ctx,
            image.id,
            image.version,
            content.dataAsOf,
          ),
          source = provenance.source;
        content.isTestData = content.isTestData || provenance.isTestData;
        content.sources.push(source);
        content.blocks = content.blocks.map((b) =>
          b.kind === "image" && b.mediaAssetId === image.id
            ? { ...b, sourceIds: [source.id] }
            : b,
        );
      }
    }
    const relayoutRequested = JSON.stringify(content) !== JSON.stringify(original.content) ||
      original.scene.themeId !== theme.id || original.scene.themeVersion !== theme.version ||
      (edit.layoutId && edit.layoutId !== original.scene.layoutId) ||
      (edit.variant && edit.variant !== original.scene.variant);
    const objectEdit = !!(edit.objectMoves || edit.objectTexts || edit.objectOrder || edit.objectGroups);
    const hasObjectLayout = original.scene.elements.some(element => element.editorId);
    if ((objectEdit && (relayoutRequested || edit.resetObjectLayout)) ||
      (relayoutRequested && hasObjectLayout && !edit.resetObjectLayout))
      throw new Error("PITCH_OBJECT_LAYOUT_RESET_REQUIRED");
    const textChange = edit.objectTexts ? applyObjectTexts(original.scene, content, edit.objectTexts, prior.origin !== "data") : null;
    if (textChange) content = textChange.content;
    const manual =
      prior.manual ||
      !!textChange ||
      edit.images !== undefined ||
      edit.paragraphs !== undefined ||
      content.title !== original.content.title;
    if (
      textChange ||
      edit.paragraphs ||
      edit.images ||
      content.title !== original.content.title
    ) {
      const sourceId =
        content.sources.find(
          (s) => s.recordId === "workspace:" + command.projectId,
        )?.id ?? randomUUID();
      content.sources = content.sources.filter((s) => s.id !== sourceId);
      content.sources.push({
        id: sourceId,
        kind: "record",
        label: "用户输入 · 未经业务数据核验",
        recordId: "workspace:" + command.projectId,
        locator: "页面正文编辑",
        version: String(command.expectedVersion + 1),
        dataAsOf: content.dataAsOf,
      });
      if (edit.paragraphs || textChange?.changedBlocks.size)
        content.blocks = content.blocks.map((b, index) =>
          b.kind === "paragraph" && (edit.paragraphs || textChange?.changedBlocks.has(index))
            ? { ...b, sourceIds: [sourceId] } : b,
        );
      if (content.disclosure !== "restricted") content.disclosure = "internal";
    }
    const changed = relayoutRequested || (!textChange && JSON.stringify(content) !== JSON.stringify(original.content));
    let scenes = [original.scene];
    if (changed || edit.resetObjectLayout) {
      scenes = await layoutSlides(
        slideContentSchema.parse(content),
        theme,
        edit.layoutId ?? (original.scene.layoutId as LayoutId),
        edit.variant ?? original.scene.variant,
      );
      const oldCount = original.scene.pagination?.count ?? 1;
      if (oldCount > 1) {
        if (scenes.length !== oldCount)
          throw new Error("PITCH_THEME_REPAGINATION");
        scenes = [scenes[original.scene.pagination!.index]];
      }
      const media = await loadMedia(ctx, mediaContext.media, scenes);
      for (const scene of scenes) await assertSceneQuality(scene, theme, media);
    }
    if (objectEdit) {
      let textScene = original.scene;
      if (textChange) {
        const formatter = sceneComponents(await sceneFont(), theme);
        const editedIds = new Set(edit.objectTexts?.map(item => item.id));
        textScene = { ...textChange.scene, elements: textChange.scene.elements.map(element => {
          if (element.kind !== "text" || (element.purpose !== "source" && !editedIds.has(element.editorId ?? ""))) return element;
          const value = element.purpose === "source" ? sceneSourceLine(content) : element.text;
          const rendered = formatter.text(value, element.x, element.y, element.w, element.h, element.role, element.bold);
          if (rendered.kind !== "text") return element;
          return { ...element, text: rendered.text };
        }) };
      }
      content = slideContentSchema.parse(content);
      const positioned = edit.objectMoves ? applyObjectMoves(textScene, edit.objectMoves) : textScene;
      const ordered = edit.objectOrder ? applyObjectOrder(positioned, edit.objectOrder) : positioned;
      const scene = edit.objectGroups ? applyObjectGroups(ordered, edit.objectGroups) : ordered;
      const media = await loadMedia(ctx, mediaContext.media, [scene]);
      await assertSceneQuality(scene, theme, media);
      scenes = [scene];
    }
    for (const [index, scene] of scenes.entries()) {
      const id = index === 0 ? edit.id : randomUUID();
      pages.push({ ...original, id, content, scene });
      settings[id] = {
        ...prior,
        manual: !!manual,
        origin:
          prior.origin ??
          (original.content.sources.some((s) =>
            s.recordId?.startsWith("workspace:"),
          )
            ? "user"
            : "asset"),
      };
    }
  }
  await pitchRpc(ctx, {
    action: "workspace_save",
    ...(await commitPayload(ctx, current, pages, settings, command)),
  });
  return getWorkspace(ctx, command.projectId);
}
export async function appendWorkspace(
  ctx: PitchContext,
  c: Extract<WorkspaceCommand, { action: "append" }>,
) {
  if (c.projectId === c.sourceProjectId) throw new Error("PITCH_INVALID");
  const current = await getWorkspace(ctx, c.projectId);
  checkVersion(current, c.expectedVersion);
  const source = await getWorkspace(ctx, c.sourceProjectId),
    settings = { ...current.workspace.page_settings };
  const pages = source.slides.map((p) => {
    const id = randomUUID();
    settings[id] = {
      ...(source.workspace.page_settings[p.id] ?? {}),
      origin: source.workspace.page_settings[p.id]?.origin ?? "asset",
      copiedFrom: p.id,
    };
    return { ...p, id };
  });
  await pitchRpc(ctx, {
    action: "workspace_save",
    ...(await commitPayload(
      ctx,
      current,
      [...current.slides, ...pages],
      settings,
      { activeSlide: pages[0]?.id },
    )),
  });
  return getWorkspace(ctx, c.projectId);
}
async function mediaProvenance(
  ctx: PitchContext,
  id: string,
  version: number,
  dataAsOf: string,
) {
  const raw = z
    .object({ source_page_id: z.uuid() })
    .passthrough()
    .parse(
      await pitchRpc(ctx, {
        action: "library_media_file",
        mediaId: id,
        version,
      }),
    );
  const origin = z
    .object({
      page: z.object({
        id: z.uuid(),
        document_id: z.uuid(),
        locator: z.string(),
      }),
      document: z.object({
        filename: z.string(),
        version: z.number(),
        sha256: z.string(),
        data_as_of: z.string().nullable(),
        is_test_data: z.boolean(),
      }),
    })
    .parse(
      await pitchRpc(ctx, {
        action: "library_page",
        pageId: raw.source_page_id,
      }),
    );
  return {
    isTestData: origin.document.is_test_data,
    source: {
      id: randomUUID(),
      kind: "document" as const,
      label: origin.document.filename,
      documentId: origin.page.document_id,
      pageId: origin.page.id,
      locator: origin.page.locator,
      version: String(origin.document.version),
      sha256: origin.document.sha256,
      dataAsOf: origin.document.data_as_of ?? dataAsOf,
    },
  };
}
export async function customWorkspace(
  ctx: PitchContext,
  c: Extract<WorkspaceCommand, { action: "custom" }>,
) {
  const current = await getWorkspace(ctx, c.projectId);
  checkVersion(current, c.expectedVersion);
  const sourceId = randomUUID(),
    assetId = randomUUID(),
    date = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
    }).format(new Date());
  const content = slideContentSchema.parse({
    protocol: "colliers-pitch/1",
    locale: current.workspace.context.language,
    title: c.title,
    blocks: [
      ...(c.body.match(/[\s\S]{1,3900}/g) ?? []).map((text) => ({
        kind: "paragraph",
        text,
        sourceIds: [sourceId],
      })),
      ...(c.image
        ? [
            {
              kind: "image",
              mediaAssetId: c.image.id,
              mediaVersion: c.image.version,
              alt: c.image.alt,
              sourceIds: [sourceId],
            },
          ]
        : []),
    ],
    sources: [
      {
        id: sourceId,
        kind: "record",
        label: "用户输入 · 未经业务数据核验",
        recordId: "workspace:" + c.projectId,
        locator: "自定义图文",
        version: "1",
        dataAsOf: date,
      },
    ],
    dataAsOf: date,
    disclosure: "internal",
    isTestData: false,
  });
  if (c.image) {
    const provenance = await mediaProvenance(
        ctx,
        c.image.id,
        c.image.version,
        content.dataAsOf,
      ),
      source = provenance.source;
    content.isTestData = content.isTestData || provenance.isTestData;
    content.sources.push(source);
    content.blocks = content.blocks.map((b) =>
      b.kind === "image" ? { ...b, sourceIds: [source.id] } : b,
    );
  }
  const theme = (
    await studioRegistry(
      ctx,
      current.project.theme_id,
      current.project.theme_version,
    )
  ).theme.definition;
  const scenes = await layoutSlides(
    content,
    theme,
    c.image ? "image-text" : "two-columns",
  );
  // Media context is resolved by ID through the existing permission-controlled library RPC.
  const rows = [];
  if (c.image) {
    const media = (await import("../data/store")).mediaRowSchema.parse(
      await pitchRpc(ctx, {
        action: "library_media_file",
        mediaId: c.image.id,
        version: c.image.version,
      }),
    );
    rows.push(media);
  }
  const media = await loadMedia(ctx, rows, scenes);
  for (const scene of scenes) await assertSceneQuality(scene, theme, media);
  await pitchRpc(ctx, {
    action: "workspace_custom",
    projectId: c.projectId,
    assetId,
    content,
    sha256: digest(new TextEncoder().encode(JSON.stringify(content))),
  });
  const settings = { ...current.workspace.page_settings },
    pages = scenes.map((scene) => {
      const id = randomUUID();
      settings[id] = { manual: true, origin: "user" };
      return {
        id,
        asset_id: assetId,
        asset_version: 1,
        template_id: "studio-content",
        template_version: 1,
        content,
        scene,
      };
    });
  await pitchRpc(ctx, {
    action: "workspace_save",
    ...(await commitPayload(
      ctx,
      current,
      [...current.slides, ...pages],
      settings,
      { activeSlide: pages[0]?.id },
    )),
  });
  return getWorkspace(ctx, c.projectId);
}
async function readWorkspaceRevision(ctx: PitchContext, projectId: string, revision: number) {
  return z
    .object({
      project: workspaceDetailSchema.shape.project,
      workspace: workspaceDetailSchema.shape.workspace,
      slides: workspaceDetailSchema.shape.slides,
    })
    .parse(
      await pitchRpc(ctx, {
        action: "workspace_revision",
        projectId,
        revision,
      }),
    );
}

export async function restoreWorkspace(
  ctx: PitchContext,
  c: Extract<WorkspaceCommand, { action: "restore" }>,
) {
  const current = await getWorkspace(ctx, c.projectId);
  checkVersion(current, c.expectedVersion);
  const snapshot = await readWorkspaceRevision(ctx, c.projectId, c.revision);
  await pitchRpc(ctx, {
    action: "workspace_save",
    ...(await commitPayload(
      ctx,
      current,
      snapshot.slides,
      snapshot.workspace.page_settings,
      {
        title: snapshot.project.title,
        themeId: snapshot.project.theme_id,
        themeVersion: snapshot.project.theme_version,
        context: snapshot.workspace.context,
        activeSlide: snapshot.workspace.active_slide,
      },
    )),
  });
  return getWorkspace(ctx, c.projectId);
}
/** Restore only one page from an owned historical revision without rolling back the rest of the deck. */
export async function restoreWorkspacePage(
  ctx: PitchContext,
  c: Extract<WorkspaceCommand, { action: "restore_page" }>,
) {
  const current = await getWorkspace(ctx, c.projectId);
  checkVersion(current, c.expectedVersion);
  const live = current.slides.find(page => page.id === c.slideId);
  if (!live || c.revision >= current.project.version ||
    !current.history.some(revision => revision.version === c.revision))
    throw new Error("PITCH_OBJECT_HISTORY_UNAVAILABLE");
  const snapshot = await readWorkspaceRevision(ctx, c.projectId, c.revision);
  const restored = snapshot.slides.find(page => page.id === c.slideId);
  if (!restored || live.asset_id !== restored.asset_id || live.asset_version !== restored.asset_version ||
    live.template_id !== restored.template_id || live.template_version !== restored.template_version ||
    live.scene.themeId !== restored.scene.themeId || live.scene.themeVersion !== restored.scene.themeVersion)
    throw new Error("PITCH_OBJECT_HISTORY_UNAVAILABLE");
  const settings = { ...current.workspace.page_settings };
  if (snapshot.workspace.page_settings[c.slideId]) settings[c.slideId] = snapshot.workspace.page_settings[c.slideId];
  else delete settings[c.slideId];
  await pitchRpc(ctx, {
    action: "workspace_save",
    ...(await commitPayload(ctx, current, current.slides.map(page => page.id === c.slideId ? restored : page), settings)),
  });
  return getWorkspace(ctx, c.projectId);
}

export async function copyWorkspace(
  ctx: PitchContext,
  c: Extract<WorkspaceCommand, { action: "copy" }>,
) {
  const latest = await getWorkspace(ctx, c.projectId);
  const source =
    c.revision && c.revision !== latest.project.version
      ? z
          .object({
            project: workspaceDetailSchema.shape.project,
            workspace: workspaceDetailSchema.shape.workspace,
            slides: workspaceDetailSchema.shape.slides,
          })
          .parse(
            await pitchRpc(ctx, {
              action: "workspace_revision",
              projectId: c.projectId,
              revision: c.revision,
            }),
          )
      : latest;
  const p = source.project;
  await pitchRpc(ctx, {
    action: "workspace_create",
    projectId: c.newProjectId,
    title: c.title,
    scope: {
      organizationId: p.organization_id,
      region: p.region,
      city: p.city,
      businessLine: p.business_line,
    },
    context: source.workspace.context,
    themeId: p.theme_id,
    themeVersion: p.theme_version,
  });
  const current = await getWorkspace(ctx, c.newProjectId),
    settings: Settings = {};
  const pages = source.slides.map((p) => {
    const id = randomUUID();
    settings[id] = {
      ...source.workspace.page_settings[p.id],
      copiedFrom: p.id,
    };
    return { ...p, id };
  });
  await pitchRpc(ctx, {
    action: "workspace_save",
    ...(await commitPayload(ctx, current, pages, settings)),
  });
  return getWorkspace(ctx, c.newProjectId);
}
export async function startWorkspaceTask(
  ctx: PitchContext,
  c: Extract<WorkspaceCommand, { action: "start" }>,
) {
  const current = await getWorkspace(ctx, c.projectId);
  checkVersion(current, c.expectedVersion);
  if (c.replaceIds.some((id) => !current.slides.some((p) => p.id === id)))
    throw new Error("PITCH_INVALID");
  return pitchRpc(ctx, {
    action: "workspace_task_start",
    projectId: c.projectId,
    expectedVersion: c.expectedVersion,
    taskId: c.taskId,
    sourceProjectId: randomUUID(),
    command: { part: c.part, replaceIds: c.replaceIds },
  });
}
export async function runWorkspaceTask(
  ctx: PitchContext,
  projectId: string,
  taskId: string,
) {
  const token = randomUUID(),
    args = { projectId, taskId, token };
  try {
    const receipt = z
      .object({
        claimed: z.boolean(),
        task: z
          .object({
            source_project_id: z.uuid(),
            expected_version: z.number(),
            command: z.object({
              part: z.unknown(),
              replaceIds: z.array(z.uuid()),
            }),
          })
          .optional(),
      })
      .parse(await pitchRpc(ctx, { action: "workspace_task_claim", ...args }));
    if (!receipt.claimed || !receipt.task) return;
    const current = await getWorkspace(ctx, projectId),
      p = current.project;
    checkVersion(current, receipt.task.expected_version);
    const part = workspacePartSchema.parse(receipt.task.command.part);
    const command = part.mode === "example" ? undefined : generationSchema.parse({
      action: "generate",
      projectId: receipt.task.source_project_id,
      title: p.title,
      scope: {
        organizationId: p.organization_id,
        region: p.region,
        city: p.city,
        businessLine: p.business_line,
      },
      language: current.workspace.context.language,
      themeId: p.theme_id,
      themeVersion: p.theme_version,
      parts: part.mode==='bundle'?part.parts:[part],
    });
    if(part.mode==='bundle'){
      const kit=(await import('../templates/deckKits')).DECK_KIT_BY_ID.get(part.kit.id);
      if(!kit||kit.version!==part.kit.version||part.parts.some(p=>p.mode==='dynamic'||!kit.sections.some(s=>s.templateId===p.templateId)))throw new Error('PITCH_INVALID');
    }
    if(part.mode==='example') {
      await (await import('./examples')).generateExampleProject(ctx,{
        projectId:receipt.task.source_project_id,requestId:taskId,title:p.title,
        scope:{organizationId:p.organization_id,region:p.region,city:p.city,businessLine:p.business_line},
        language:current.workspace.context.language,themeId:p.theme_id,themeVersion:p.theme_version,part,
      });
    } else await generateBusinessProject(ctx, command!);
    await pitchRpc(ctx, { action: "workspace_task_check", ...args });
    const source = await getWorkspace(ctx, receipt.task.source_project_id),
      settings = { ...current.workspace.page_settings };
    const pages = source.slides.map((p) => {
      const id = randomUUID();
      settings[id] = {
        manual: false,
        origin: part.mode === "dynamic" ? "data" : "asset",
        part,
        ...(part.mode === "example" ? {example:true,kit:part.kit} : part.mode==='bundle'?{kit:part.kit}:{}),
      };
      return { ...p, id };
    });
    const replaces = new Set(receipt.task.command.replaceIds),
      first = current.slides.findIndex((p) => replaces.has(p.id));
    const kept = current.slides.filter((p) => !replaces.has(p.id));
    kept.splice(first < 0 ? kept.length : first, 0, ...pages);
    await pitchRpc(ctx, {
      action: "workspace_task_complete",
      ...args,
      save: await commitPayload(ctx, current, kept, settings, {
        activeSlide: pages[0]?.id,
      }),
    });
  } catch (error) {
    try {
      await pitchRpc(ctx, {
        action: "workspace_task_fail",
        ...args,
        errorCode:
          error instanceof Error ? error.message : "PITCH_GENERATION_FAILED",
      });
    } catch {
      /* A cancelled/revoked receipt cannot be committed; status expires a lost lease. */
    }
  }
}
