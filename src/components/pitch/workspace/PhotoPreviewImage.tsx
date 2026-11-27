/* eslint-disable @next/next/no-img-element -- private pinned photos use short-lived local object URLs. */
"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/src/components/ui";
import { BUILDING_PHOTO_BUCKET, isBuildingPhotoPath } from "@/src/lib/building-photos/model";
import { matchesMaterialSignature, materialMimeType } from "@/src/lib/sales-materials/model";
import { loadStoredBuildingPhoto } from "@/src/services/buildingPhotosClient";
import type { PhotoPin } from "./PhotoRevisionReview";
import styles from "./workspace.module.css";

const originalPath = "/storage/v1/object/sign/" + BUILDING_PHOTO_BUCKET + "/";
const maxBytes = 24 * 1024 * 1024;
class PhotoVersionChanged extends Error {}

async function readPhoto(pin: PhotoPin, signal: AbortSignal) {
  const { buildingId, photoId } = pin.origin;
  const asset = await loadStoredBuildingPhoto(buildingId, photoId, signal, "original");
  const storage = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!asset.can_download || asset.is_preview || !storage) throw new Error("照片原件暂不可预览。");
  const url = new URL(asset.url);
  if (url.origin !== new URL(storage).origin || url.username || url.password || !url.pathname.startsWith(originalPath) ||
    !isBuildingPhotoPath(url.pathname.slice(originalPath.length), buildingId, photoId)) {
    throw new Error("照片原件路径无法核对。");
  }
  const response = await fetch(url, { signal, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) throw new Error("照片原件暂不可预览。");
  const photo = await response.blob();
  if (!photo.size || photo.size > maxBytes) throw new Error("照片原件暂不可预览。");
  const bytes = await photo.arrayBuffer();
  const mime = materialMimeType(url.pathname, "");
  if (!mime || !matchesMaterialSignature(new Uint8Array(bytes), mime)) throw new Error("照片原件格式无法核对。");
  const hashed = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(hashed), byte => byte.toString(16).padStart(2, "0")).join("");
  signal.throwIfAborted();
  if (hash !== pin.contentHash) throw new PhotoVersionChanged("照片版本已更新，请重新查询备选照片。");
  return new Blob([bytes], { type: mime });
}

export function PhotoPreviewImage({ pin, caption, onStale }: { pin: PhotoPin; caption: string; onStale?: () => void }) {
  const [result, setResult] = useState<{ attempt: number; url: string } | { attempt: number; error: string; stale: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const notifyStale = useEffectEvent(() => onStale?.());
  useEffect(() => {
    const request = new AbortController();
    let url: string | undefined;
    void readPhoto(pin, request.signal).then(photo => {
      if (request.signal.aborted) return;
      url = URL.createObjectURL(photo);
      setResult({ attempt, url });
    }).catch((error: unknown) => {
      if (request.signal.aborted) return;
      const stale = error instanceof PhotoVersionChanged;
      if (stale) notifyStale();
      setResult({ attempt, stale, error: error instanceof TypeError || !(error instanceof Error)
        ? "照片暂不可预览。" : error.message });
    });
    return () => {
      request.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [pin, attempt]);
  const preview = result?.attempt === attempt ? result : undefined;
  if (preview && "url" in preview) return <img src={preview.url} className={styles.photoThumbnail} alt={caption} />;
  if (preview) return <div>
    <p role="status">{preview.error}</p>
    {!preview.stale && <Button variant="ghost" onClick={() => setAttempt(value => value + 1)}>重试图片预览</Button>}
  </div>;
  return <div className={styles.photoThumbnail} aria-busy="true" aria-label="正在载入照片" />;
}
