import { useEffect, useState } from "react";
import { z } from "zod";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { WorkspaceError, type Call } from "./client";
import { dataRefreshPeriodSchema } from "./DataRefreshReview";

const queryReceiptSchema = z.object({
  sourceId: z.uuid(), receiptId: z.string(), resultId: z.uuid(),
  binding: z.object({ dataAsOf: z.iso.date().nullable() }),
  query: z.object({ fields: z.array(z.string()) }),
});
const mediaReferenceSchema = z.object({ id: z.uuid(), version: z.number().int().positive() });
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const datedMaterial = { sha256: digestSchema, dataAsOf: z.iso.date().nullable() };
const materialSchema = z.object({
  asset: mediaReferenceSchema,
  documents: z.array(z.object({ ...datedMaterial, sourceId: z.uuid(), documentId: z.uuid(), pageId: z.uuid().nullable(),
    version: z.number().int().positive() })),
  media: z.array(mediaReferenceSchema.extend({ ...datedMaterial, documentId: z.uuid(), pageId: z.uuid(),
    documentVersion: z.number().int().positive() })),
  visuals: z.array(mediaReferenceSchema.extend({ ...datedMaterial, sourceId: z.uuid(),
    kind: z.enum(["photo", "map", "stacking-plan"]), versionHash: digestSchema, sourceDate: z.iso.date(),
    buildingIds: z.array(z.uuid()).min(1).max(1000) })),
});
type MaterialMedia = z.infer<typeof mediaReferenceSchema>;
const bindingObjectSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.string(),
  sourceIds: z.array(z.uuid()),
  valueOrigin: z.enum(["manual", "asset", "business"]),
  binding: z.object({ domain: z.enum(["quarter", "lease", "business"]) }).optional(),
  query: z.object({ period: dataRefreshPeriodSchema.optional() }).optional(),
  receipts: z.array(queryReceiptSchema).optional(),
  mediaRefs: z.unknown().optional().transform(value => z.array(mediaReferenceSchema).safeParse(value).data),
});
const bindingsSchema = z.object({
  projectVersion: z.number().int(),
  pages: z.array(z.object({ id: z.uuid(), objects: z.array(bindingObjectSchema),
    materials: z.unknown().optional().transform(value => materialSchema.safeParse(value).data) })),
});
type Bindings = z.infer<typeof bindingsSchema>;
type BindingResult = { status: "ready"; data: Bindings } | { status: "unsupported" } | { status: "error"; message: string };
export type DocumentBindings = (BindingResult | { status: "loading" }) & { retry: () => void };

export function materialMediaKey({ id, version }: MaterialMedia) { return `${id}:${version}`; }

export function readMaterialEvidence(bindings: DocumentBindings, page: WorkspaceDetail["slides"][number] | undefined) {
  if (!page || bindings.status !== "ready") return null;
  const bound = bindings.data.pages.find(item => item.id === page.id);
  const receipt = bound?.materials;
  if (!bound || !receipt || receipt.asset.id !== page.asset_id || receipt.asset.version !== page.asset_version) return null;
  const sources = new Map(page.content.sources.map(source => [source.id, source]));
  const imageLabels = new Map<string, string>();
  for (const [index, block] of page.content.blocks.entries()) {
    const entry = bound.objects[index];
    if (entry?.index !== index || entry.kind !== block.kind || entry.sourceIds.join() !== block.sourceIds.join()) continue;
    const images = block.kind === "image" ? [{ id: block.mediaAssetId, version: block.mediaVersion, label: block.alt }]
      : block.kind === "team" ? block.members.flatMap(member => member.mediaAssetId && member.mediaVersion
        ? [{ id: member.mediaAssetId, version: member.mediaVersion, label: member.name }] : []) : [];
    const references = new Set(entry.mediaRefs?.map(materialMediaKey));
    for (const image of images) if (references.has(materialMediaKey(image))) imageLabels.set(materialMediaKey(image), image.label);
  }
  const documents = receipt.documents.flatMap(document => {
    const source = sources.get(document.sourceId);
    return source?.kind === "document" && source.documentId === document.documentId && (source.pageId ?? null) === document.pageId &&
      source.version === String(document.version) && source.sha256 === document.sha256
      ? [{ ...document, label: source.label, locator: source.locator }] : [];
  });
  const media = receipt.media.flatMap(image => {
    const label = imageLabels.get(materialMediaKey(image));
    return label ? [{ ...image, label, document: documents.find(document => document.documentId === image.documentId &&
      document.version === image.documentVersion && document.pageId === image.pageId) }] : [];
  });
  const visuals = receipt.visuals.flatMap(visual => {
    const source = sources.get(visual.sourceId);
    if (source?.kind !== "record" || source.version !== visual.versionHash || source.sha256 !== visual.sha256 || source.dataAsOf !== visual.sourceDate)
      return [];
    const image = page.content.blocks.find(block => block.sourceIds.includes(visual.sourceId) &&
      ((block.kind === "image" && block.mediaAssetId === visual.id && block.mediaVersion === visual.version && imageLabels.has(materialMediaKey(visual))) ||
      (visual.kind === "map" && block.kind === "map" && block.mapId === visual.id && block.snapshotVersion === visual.versionHash)));
    return image ? [{ ...visual, label: image.kind === "image" ? image.alt : source.label, sourceLabel: source.label, locator: source.locator }] : [];
  });
  return documents.length || media.length || visuals.length ? { documents, media, visuals } : null;
}

export type MaterialEvidence = NonNullable<ReturnType<typeof readMaterialEvidence>>;

export function useDocumentBindings(call: Call, project: WorkspaceDetail["project"] | undefined, enabled: boolean): DocumentBindings {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; value: BindingResult }>();
  const projectId = project?.id;
  const version = project?.version;
  const key = `${projectId}:${version}:${attempt}`;
  const current = result?.key === key ? result.value : undefined;

  useEffect(() => {
    if (!enabled || !projectId || current) return;
    const request = new AbortController();
    void call({ action: "document_bindings", projectId }, false, "workspace", request.signal)
      .then(bindingsSchema.parse)
      .then(data => {
        if (request.signal.aborted) return;
        setResult({ key, value: data.projectVersion === version ? { status: "ready", data }
          : { status: "error", message: "项目版本已变化，请重新打开项目检查数据绑定。" } });
      })
      .catch((cause: unknown) => {
        if (request.signal.aborted) return;
        const value: BindingResult = cause instanceof WorkspaceError && [400, 404].includes(cause.status)
          ? { status: "unsupported" }
          : { status: "error", message: cause instanceof Error && !(cause instanceof z.ZodError)
            ? cause.message : "数据绑定暂时无法读取。" };
        setResult({ key, value });
      });
    return () => request.abort();
  }, [call, current, enabled, key, projectId, version]);

  const retry = () => setAttempt(value => value + 1);
  return current ? { ...current, retry } : { status: "loading", retry };
}

export function paragraphBindingAccess(bindings: DocumentBindings, slide: WorkspaceDetail["slides"][number] | undefined,
  legacyDataPage: boolean) {
  const locked = new Set<number>();
  const objects = slide && bindings.status === "ready"
    ? bindings.data.pages.find(page => page.id === slide.id)?.objects : undefined;
  const legacy = bindings.status === "unsupported";
  const matched = !!objects && !!slide && objects.length === slide.content.blocks.length && objects.every((object, index) => {
    const block = slide.content.blocks[index];
    return object.index === index && object.kind === block.kind && object.sourceIds.join() === block.sourceIds.join();
  });
  for (const [index, block] of (slide?.content.blocks ?? []).entries()) {
    if (block.kind !== "paragraph") continue;
    if (slide?.content.disclosure === "restricted" || (!matched && (!legacy || legacyDataPage)) ||
      objects?.[index]?.valueOrigin === "business" || objects?.[index]?.receipts?.length) locked.add(index);
  }
  return {
    locked,
    // Saved data pages expose paragraph anchors only through a captured quarter or lease group.
    allowCanvasParagraphs: !legacyDataPage || !!objects?.some(object => object.binding?.domain === "quarter" || object.binding?.domain === "lease"),
    current: matched || legacy,
  };
}
