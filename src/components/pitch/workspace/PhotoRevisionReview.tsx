import { z } from "zod";
import { workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { objectId } from "@/src/lib/pitch/workspace/object-layout";
import { PhotoPreviewImage } from "./PhotoPreviewImage";
import styles from "./workspace.module.css";

const id = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().positive();
const objectKey = z.string().trim().min(1).max(160);
const photoPin = z.object({
  id, version, versionHash: digest, contentHash: digest, kind: z.literal("photo"), buildingIds: z.tuple([id]),
  origin: z.object({ type: z.literal("building-photo"), buildingId: id, photoId: id }),
}).refine(pin => pin.buildingIds[0] === pin.origin.buildingId);
export type PhotoPin = z.infer<typeof photoPin>;
const boundSource = z.object({ id, kind: z.literal("record"), sha256: digest, version: digest, recordId: id, visual: photoPin });
export const plannedPhotoSchema = photoPin.safeExtend({
  caption: z.string().min(1).max(300),
  source: boundSource.extend({ label: z.string().min(1).max(300) }),
}).refine(photo => photo.source.visual.id === photo.id &&
  photo.source.visual.version === photo.version && photo.source.visual.versionHash === photo.versionHash &&
  photo.source.visual.contentHash === photo.contentHash && photo.source.visual.origin.buildingId === photo.origin.buildingId &&
  photo.source.visual.origin.photoId === photo.origin.photoId &&
  photo.source.sha256 === photo.contentHash && photo.source.version === photo.versionHash && photo.source.recordId === photo.origin.photoId
).transform(({ caption, source }) => ({ caption, label: source.label, pin: source.visual }));
const inputSchema = z.strictObject({
  projectId: id, expectedVersion: version, question: z.string().trim().min(1).max(1000), currentPageId: id.optional(),
  competitorBuildingId: id.optional(), pageIds: z.array(id).max(50), objectIds: z.array(objectKey).max(30),
});
export type PhotoRevisionInput = z.infer<typeof inputSchema>;

export const photoReviewSchema = z.object({
  status: z.literal("photo-review"), projectId: id, projectVersion: version, fingerprint: digest,
  changes: z.array(z.object({ pageId: id, pageVersion: version, objectId: objectKey, buildingId: id,
    before: z.object({ caption: z.string(), pin: photoPin }),
    after: z.object({ caption: z.string(), pin: photoPin, category: z.string(), sourceLabel: z.string() }),
  })).min(1).max(50),
  command: z.strictObject({ action: z.literal("proposal_apply_photo"), confirmation: z.strictObject({ input: inputSchema, fingerprint: digest }) }),
});
export type PhotoReview = z.infer<typeof photoReviewSchema>;
export const appliedPhotoSchema = z.object({ status: z.literal("photo-applied"), workspace: workspaceDetailSchema });

type Slide = WorkspaceDetail["slides"][number];

export function pinnedBuildingPhoto(slide: Slide, selected: string) {
  const object = slide.scene.elements.find((element, index) => objectId(element, index) === selected);
  if (object?.kind !== "image") return undefined;
  const matches = (item: { mediaAssetId: string; mediaVersion: number }) =>
    item.mediaAssetId === object.mediaAssetId && item.mediaVersion === object.mediaVersion;
  const blocks = slide.content.blocks.filter(block => block.kind === "image").filter(matches);
  if (blocks.length !== 1 || slide.scene.elements.filter(element => element.kind === "image" && matches(element)).length !== 1) return undefined;
  const sources = slide.content.sources.flatMap(source => {
    const parsed = boundSource.safeParse(source);
    if (!parsed.success || !blocks[0].sourceIds.includes(parsed.data.id)) return [];
    const saved = parsed.data;
    const pin = saved.visual;
    if (pin.id !== object.mediaAssetId || pin.version !== object.mediaVersion ||
      saved.sha256 !== pin.contentHash || saved.version !== pin.versionHash || saved.recordId !== pin.origin.photoId) return [];
    return [{ pin, caption: blocks[0].alt }];
  });
  return sources.length === 1 ? sources[0] : undefined;
}

function hasPinnedPhoto(detail: WorkspaceDetail, change: PhotoReview["changes"][number], side: "before" | "after") {
  const slide = detail.slides.find(slide => slide.id === change.pageId);
  const saved = slide && pinnedBuildingPhoto(slide, change.objectId);
  return !!saved && JSON.stringify(saved) === JSON.stringify({ pin: change[side].pin, caption: change[side].caption });
}

export function matchesPhotoReview(review: PhotoReview, detail: WorkspaceDetail, input: PhotoRevisionInput) {
  const confirmation = review.command.confirmation;
  const parsed = inputSchema.safeParse(input);
  return parsed.success && review.projectId === detail.project.id && review.projectVersion === detail.project.version &&
    confirmation.fingerprint === review.fingerprint && JSON.stringify(confirmation.input) === JSON.stringify(parsed.data) &&
    new Set(review.changes.map(change => change.pageId)).size === review.changes.length &&
    review.changes.every(change => change.before.pin.origin.buildingId === change.buildingId &&
      change.after.pin.origin.buildingId === change.buildingId && change.before.pin.id !== change.after.pin.id &&
      (!input.objectIds.length || change.pageId === input.currentPageId && input.objectIds.includes(change.objectId)) &&
      hasPinnedPhoto(detail, change, "before"));
}

export function matchesAppliedPhoto(review: PhotoReview, detail: WorkspaceDetail) {
  return detail.project.id === review.projectId && detail.project.version > review.projectVersion &&
    review.changes.every(change => hasPinnedPhoto(detail, change, "after"));
}

const categories: Record<string, string> = { exterior: "外立面", lobby: "大堂", interior: "室内" };

export function PhotoRevisionReview({ review, detail, onImageStale }: {
  review: PhotoReview; detail: WorkspaceDetail; onImageStale?: () => void;
}) {
  return <>
    <p>同楼宇实景换图 · 影响 {review.changes.length} 页</p>
    <ol className={styles.handoffPages}>
      {review.changes.map(change => {
        const page = detail.slides.findIndex(slide => slide.id === change.pageId);
        return <li key={change.pageId}>
          <strong>第 {page + 1} 页 · {detail.slides[page]?.content.title}</strong>
          <div className={styles.revisionColumns}>
            <div><strong>更换前</strong>
              {onImageStale && <PhotoPreviewImage key={change.before.pin.contentHash} pin={change.before.pin} caption="原照片预览" onStale={onImageStale} />}
              <p>{change.before.caption || "原楼宇照片"}</p>
            </div>
            <div><strong>更换后</strong>
              {onImageStale && <PhotoPreviewImage key={change.after.pin.contentHash} pin={change.after.pin} caption="备选照片预览" onStale={onImageStale} />}
              <p>{change.after.caption || categories[change.after.category] || "获权楼宇照片"}</p>
              <p>{change.after.sourceLabel}</p></div>
          </div>
        </li>;
      })}
    </ol>
  </>;
}
