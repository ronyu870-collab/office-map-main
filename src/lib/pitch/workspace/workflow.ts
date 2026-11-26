import { getReviewedCanvasText, hash, startAiBatch } from "../ai/workflow";
import { stableId } from "../library/extract";
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
import { runPitchDataAdapter } from "../business/adapter";
import { reviewedBuildingData } from "../business/outline-data";
import { outlineDataParameters, workspacePartSchema, type WorkspaceCommand, type WorkspaceSave } from "./protocol";
import { workspaceDetailSchema, type WorkspaceDetail } from "./protocol";
import { applyObjectMoves, applyObjectTexts, applyObjectOrder, applyObjectGroups } from "./object-layout";
import { captureKey, readCaptures, usesBusinessEvidence } from "./bindingStore";
import type { DocumentModificationPlan } from "../integration-contracts";
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
export async function commitPayload(
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
  return saveCurrentWorkspace(ctx, current, command);
}
async function saveCurrentWorkspace(ctx: PitchContext, current: WorkspaceDetail, command: WorkspaceSave) {
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
  const bindings = command.pages.some(edit => edit.paragraphs || edit.objectTexts)
    ? await readCaptures(ctx, command.projectId, command.expectedVersion) : undefined;
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
    const binding = bindings?.get(captureKey(original.asset_id, original.asset_version));
    const changedParagraphs = new Set<number>();
    let content: SlideContent = structuredClone(original.content);
    if (edit.title) content.title = edit.title;
    if (edit.paragraphs) {
      if ((original.scene.pagination?.count ?? 1) > 1)
        throw new Error("PITCH_PAGINATED_EDIT");
      const count = content.blocks.filter((b) => b.kind === "paragraph").length;
      if (count !== edit.paragraphs.length) throw new Error("PITCH_INVALID");
      let n = 0;
      content.blocks = content.blocks.map((block, index) => {
        if (block.kind !== "paragraph") return block;
        const text = edit.paragraphs![n++];
        if (text === block.text) return block;
        if (binding && usesBusinessEvidence(block, binding.content)) throw new Error("PITCH_BOUND_VALUE_EDIT");
        changedParagraphs.add(index);
        return { ...block, text };
      });
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
    const textChange = edit.objectTexts ? applyObjectTexts(original.scene, content, edit.objectTexts, prior.origin !== "data" || Boolean(binding)) : null;
    if (binding && textChange && [...textChange.changedBlocks].some(index => usesBusinessEvidence(original.content.blocks[index], binding.content)))
      throw new Error("PITCH_BOUND_VALUE_EDIT");
    if (textChange) content = textChange.content;
    const manual =
      prior.manual ||
      !!textChange ||
      edit.images !== undefined ||
      changedParagraphs.size > 0 ||
      content.title !== original.content.title;
    if (
      textChange ||
      changedParagraphs.size > 0 ||
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
      if (changedParagraphs.size || textChange?.changedBlocks.size)
        content.blocks = content.blocks.map((b, index) =>
          b.kind === "paragraph" && (changedParagraphs.has(index) || textChange?.changedBlocks.has(index))
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
export async function applyDocumentModification(
  ctx: PitchContext,
  command: Extract<WorkspaceCommand, { action: "apply_modification" }>,
) {
  const plan: DocumentModificationPlan = command.plan;
  if (plan.refresh) throw new Error("PITCH_DATA_REFRESH_REVIEW_REQUIRED");
  const current = await getWorkspace(ctx, plan.projectId);
  checkVersion(current, plan.expectedVersion);
  const live = new Map(current.slides.map(page => [page.id, page.version]));
  const base = new Map(plan.basePageVersions.map(page => [page.id, page.version]));
  const edit = new Map(plan.pages.map(page => [page.id, page]));
  if (base.size !== plan.basePageVersions.length || edit.size !== plan.pages.length)
    throw new Error("PITCH_INVALID");
  for (const [id, version] of base)
    if (live.get(id) !== version) throw new Error("PITCH_CONFLICT");
  if (command.scope === "document" && base.size !== live.size ||
    plan.pages.some(page => !base.has(page.duplicateOf ?? page.id)))
    throw new Error("PITCH_CONFLICT");
  if (command.scope === "selected" && plan.pages.some(page => page.duplicateOf || !live.has(page.id)))
    throw new Error("PITCH_INVALID");
  const pages = command.scope === "document" ? plan.pages : current.slides.map(page => edit.get(page.id) ?? { id: page.id });
  return saveCurrentWorkspace(ctx, current, {
    action: "save",
    projectId: plan.projectId,
    expectedVersion: plan.expectedVersion,
    title: current.project.title,
    themeId: command.theme?.id ?? current.project.theme_id,
    themeVersion: command.theme?.version ?? current.project.theme_version,
    context: current.workspace.context,
    activeSlide: current.workspace.active_slide,
    pages,
  });
}
function editableCanvasPage(current: WorkspaceDetail, slideId: string) {
  const page = current.slides.find(candidate => candidate.id === slideId);
  const setting = current.workspace.page_settings[slideId] ?? {};
  if (!page || page.content.disclosure !== "internal" || setting.manual || setting.origin === "data" || setting.example ||
    page.scene.elements.some(element => element.editorId) || (page.scene.pagination?.count ?? 1) > 1)
    throw new Error("PITCH_CANVAS_REVISION_UNAVAILABLE");
  return { page, setting };
}
export async function startCanvasText(ctx: PitchContext, command: Extract<WorkspaceCommand, { action: "start_canvas_text" }>) {
  const current = await getWorkspace(ctx, command.projectId);
  checkVersion(current, command.expectedVersion);
  const { page } = editableCanvasPage(current, command.slideId);
  const source = z.object({
    asset: z.object({ organization_id: z.string(), region: z.string(), city: z.string(), business_line: z.string(),
      allow_external_ai: z.boolean(), allow_client_export: z.boolean() }),
    version: z.object({ version: z.number(), content: slideContentSchema }),
  }).parse(await pitchRpc(ctx, { action: "get_asset", assetId: page.asset_id }));
  const project = current.project;
  if (page.asset_version !== source.version.version || hash(page.content) !== hash(source.version.content) ||
    source.asset.organization_id !== project.organization_id || source.asset.region !== project.region ||
    source.asset.city !== project.city || source.asset.business_line !== project.business_line ||
    source.asset.allow_client_export || !source.asset.allow_external_ai)
    throw new Error("PITCH_CANVAS_REVISION_UNAVAILABLE");
  const policies = z.array(z.object({ asset_version: z.number(), mode: z.string(), expires_at: z.string() }))
    .parse(await pitchRpc(ctx, { action: "ai_policies", assetId: page.asset_id }));
  if (!policies.some(policy => policy.asset_version === page.asset_version && policy.mode === "approved_provider" &&
      Date.parse(policy.expires_at) > Date.now())) throw new Error("PITCH_CANVAS_REVISION_PERMISSION");
  await startAiBatch(ctx, { action: "start", batchId: command.batchId, tasks: [{
    assetId: page.asset_id, version: page.asset_version, task: "revise-text", canvasOnly: true,
    language: page.content.locale.startsWith("en") ? "en" : "zh", length: "brief",
  }] });
  return { batchId: command.batchId, tasks: await pitchRpc(ctx, { action: "ai_status", batchId: command.batchId }) };
}
type CanvasRevision = Extract<WorkspaceCommand, { action: "preview_canvas_revision" | "apply_canvas_revision" }>;
async function buildCanvasRevision(ctx: PitchContext, c: CanvasRevision) {
  const current = await getWorkspace(ctx, c.projectId);
  checkVersion(current, c.expectedVersion);
  const { page, setting } = editableCanvasPage(current, c.slideId);
  const reviewed = await getReviewedCanvasText(ctx, c.taskId, c.revisionFingerprint, c.selectedRefs);
  if (page.asset_id !== reviewed.assetId || page.asset_version !== reviewed.assetVersion ||
    reviewed.original.disclosure !== "internal" ||
    hash(slideContentSchema.parse(page.content)) !== hash(reviewed.original) ||
    reviewed.scope.organizationId !== current.project.organization_id || reviewed.scope.region !== current.project.region ||
    reviewed.scope.city !== current.project.city || reviewed.scope.businessLine !== current.project.business_line)
    throw new Error("PITCH_CANVAS_REVISION_UNAVAILABLE");

  // Preserve existing content and sources; only the chosen text and an internal
  // AI revision attribution can change. Server renders the existing slide layout.
  const sourceId = stableId([c.projectId, c.slideId, c.expectedVersion, c.taskId, c.revisionFingerprint].join(":"));
  const blocks = new Set(reviewed.selectedRefs.filter(ref => ref.startsWith("block:")).map(ref => Number(ref.slice(6))));
  const content = slideContentSchema.parse({
    ...reviewed.content,
    blocks: reviewed.content.blocks.map((block, index) => blocks.has(index)
      ? { ...block, sourceIds: [...block.sourceIds, sourceId] } : block),
    sources: [...reviewed.content.sources, {
      id: sourceId, kind: "record", recordId: "pitch-ai:" + c.taskId, label: "AI 修订 · 未核验",
      locator: "用户确认的画布文字", version: String(c.expectedVersion + 1), dataAsOf: reviewed.content.dataAsOf,
    }],
  });
  const theme = (await studioRegistry(ctx, page.scene.themeId, page.scene.themeVersion)).theme.definition;
  const scenes = await layoutSlides(content, theme, page.scene.layoutId, page.scene.variant);
  if (scenes.length !== 1) throw new Error("PITCH_CANVAS_REVISION_UNAVAILABLE");
  const { mediaRowSchema } = await import("../data/store");
  const { media: rows } = z.object({ media: z.array(mediaRowSchema) }).parse(await pitchRpc(ctx, {
    action: "preview_context", projectId: c.projectId,
  }));
  const media = await loadMedia(ctx, rows, [page.scene, ...scenes]);
  await assertSceneQuality(scenes[0], theme, media);
  const scene = numberDeckPages([{ scene: scenes[0], theme }], current.slides.indexOf(page))[0].scene;
  const fingerprint = hash([c.projectId, page.id, c.expectedVersion, c.revisionFingerprint, content, scene]);
  return { current, page, updated: { ...page, content, scene }, setting, fingerprint, theme, media };
}
export async function previewCanvasRevision(ctx: PitchContext, c: Extract<CanvasRevision, { action: "preview_canvas_revision" }>) {
  const prepared = await buildCanvasRevision(ctx, c);
  const { renderSceneSvg } = await import("../render/svg");
  const [before, after] = await Promise.all([
    renderSceneSvg(prepared.page.scene, prepared.theme, prepared.media),
    renderSceneSvg(prepared.updated.scene, prepared.theme, prepared.media),
  ]);
  if (Buffer.byteLength(before) + Buffer.byteLength(after) > 2_000_000)
    throw new Error("PITCH_CANVAS_REVISION_UNAVAILABLE");
  checkVersion(await getWorkspace(ctx, c.projectId), c.expectedVersion);
  await pitchRpc(ctx, { action: "ai_result", taskId: c.taskId });
  return { canvasFingerprint: prepared.fingerprint, before, after };
}
export async function applyCanvasRevision(ctx: PitchContext, c: Extract<CanvasRevision, { action: "apply_canvas_revision" }>) {
  const prepared = await buildCanvasRevision(ctx, c);
  if (prepared.fingerprint !== c.canvasFingerprint) throw new Error("PITCH_CONFLICT");
  const { current, updated } = prepared;
  const settings = { ...current.workspace.page_settings, [updated.id]: { ...prepared.setting, manual: true } };
  const save = await commitPayload(ctx, current, current.slides.map(page => page.id === updated.id ? updated : page), settings);
  await pitchRpc(ctx, { action: "workspace_ai_revision_apply", projectId: c.projectId, slideId: c.slideId,
    taskId: c.taskId, expectedVersion: c.expectedVersion, save });
  return getWorkspace(ctx, c.projectId);
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
export async function reviewOutlineData(
  ctx: PitchContext,
  c: Extract<WorkspaceCommand, { action: "review_outline_data" }>,
) {
  const current = await getWorkspace(ctx, c.projectId);
  const parameters = outlineDataParameters(c.buildingIds, c.period);
  const language = current.workspace.context.language;
  if (c.compareQuarters && parameters.period.year < 1901) throw new Error("PITCH_INVALID");
  const snapshot = await runPitchDataAdapter(ctx, parameters, language, c.compareQuarters);
  return { ...reviewedBuildingData(snapshot, language), parameters };
}
function assertOutlineDataContext(current: WorkspaceDetail, part: z.infer<typeof workspacePartSchema>) {
  if (part.mode !== "outline" || !part.dataFingerprint) return;
  const data = part.parts.find(section => section.mode === "dynamic");
  if (!data) throw new Error("PITCH_INVALID");
  const { period, buildingIds } = current.workspace.context;
  if (!period || period !== data.parameters.period.year + "-Q" + data.parameters.period.quarter ||
    buildingIds.length !== data.parameters.buildingIds.length ||
    JSON.stringify([...buildingIds].sort()) !== JSON.stringify([...data.parameters.buildingIds].sort()))
    throw new Error("PITCH_OUTLINE_DATA_CHANGED");
}
export async function startWorkspaceTask(
  ctx: PitchContext,
  c: Extract<WorkspaceCommand, { action: "start" }>,
) {
  const current = await getWorkspace(ctx, c.projectId);
  // The database checks the original command before comparing the current
  // project version. A completed task can be replayed with its old version.
  if (current.project.version === c.expectedVersion && !current.tasks.some(task => task.id === c.taskId)) {
    assertOutlineDataContext(current, c.part);
    if ((c.part.mode === "outline" && c.replaceIds.length > 0) ||
      c.replaceIds.some((id) => !current.slides.some((p) => p.id === id)))
      throw new Error("PITCH_INVALID");
  }
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
        sourceReady: z.boolean().optional(),
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
    assertOutlineDataContext(current, part);
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
      language: part.mode === 'handoff' ? part.language : current.workspace.context.language,
      themeId: p.theme_id,
      themeVersion: p.theme_version,
      parts: part.mode === 'bundle' || part.mode === 'outline' ? part.parts :
        part.mode === 'handoff' ? [{ mode: 'dynamic', parameters: part.parameters }] : [part],
    });
    if(part.mode==='bundle'){
      const kit=(await import('../templates/deckKits')).DECK_KIT_BY_ID.get(part.kit.id);
      if(!kit||kit.version!==part.kit.version||part.parts.some(p=>p.mode==='dynamic'||!kit.sections.some(s=>s.templateId===p.templateId)))throw new Error('PITCH_INVALID');
    }
    if (!receipt.sourceReady && part.mode === "example") {
      await (await import('./examples')).generateExampleProject(ctx,{
        projectId:receipt.task.source_project_id,requestId:taskId,title:p.title,
        scope:{organizationId:p.organization_id,region:p.region,city:p.city,businessLine:p.business_line},
        language:current.workspace.context.language,themeId:p.theme_id,themeVersion:p.theme_version,part,
      });
    } else if (part.mode === "outline" || part.mode === "handoff" || !receipt.sourceReady) await generateBusinessProject(ctx, command!, part.mode === 'outline'
      ? new Map(part.bindings.map(binding => [binding.id, binding.version])) : undefined,
      part.mode === "outline" ? part.dataFingerprint : undefined,
      part.mode === "outline" && part.compareQuarters,
      part.mode === "handoff" ? { ...part, domain: part.parameters.templateId.startsWith("lease-") ? "lease" : "quarter" } : undefined);
    await pitchRpc(ctx, { action: "workspace_task_check", ...args });
    const source = await getWorkspace(ctx, receipt.task.source_project_id),
      settings = { ...current.workspace.page_settings };
    const pages = source.slides.map((p) => {
      const id = randomUUID();
      settings[id] = {
        manual: false,
        // Keep every page in a mixed deck inside formal-data editing controls.
        origin: part.mode === "dynamic" || part.mode === "handoff" || (part.mode === "outline" && part.dataFingerprint) ? "data" : "asset",
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
          error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code : error instanceof Error ? error.message : "PITCH_GENERATION_FAILED",
      });
    } catch {
      /* A cancelled/revoked receipt cannot be committed; status expires a lost lease. */
    }
  }
}
