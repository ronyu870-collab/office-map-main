import { createHash, webcrypto } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadStoredBuildingPhoto } from "@/src/services/buildingPhotosClient";
import { PhotoPreviewImage } from "./PhotoPreviewImage";
import type { PhotoPin } from "./PhotoRevisionReview";

vi.mock("@/src/services/buildingPhotosClient", () => ({ loadStoredBuildingPhoto: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const buildingId = "55555555-5555-4555-8555-555555555555";
const photoId = "66666666-6666-4666-8666-666666666666";
const storedBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 65, 66, 67]);
const pin: PhotoPin = {
  id: "77777777-7777-4777-8777-777777777777", kind: "photo", version: 1,
  versionHash: "e".repeat(64), contentHash: createHash("sha256").update(storedBytes).digest("hex"),
  buildingIds: [buildingId], origin: { type: "building-photo", buildingId, photoId },
};
const storage = "https://isolated.supabase.co";
const signedUrl = `${storage}/storage/v1/object/sign/building-sales-materials/building-photos/v1/${buildingId}/${photoId}/isolated.png?token=isolated`;

function setup(url = signedUrl) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", storage);
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(loadStoredBuildingPhoto).mockResolvedValue({
    url, can_download: true, is_preview: false, source_url: "https://source.example.org", source_name: "隔离照片",
  });
  const fetch = vi.fn(async () => new Response(storedBytes, { headers: { "content-type": "application/octet-stream" } }));
  vi.stubGlobal("fetch", fetch);
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:isolated-photo");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { fetch, create, revoke };
}

it("previews only the authorized signed original matching the reviewed hash and revokes its preview on close", async () => {
  const { fetch, create, revoke } = setup();
  const view = render(<PhotoPreviewImage pin={pin} caption="备选照片预览" />);
  expect(await screen.findByRole("img", { name: "备选照片预览" })).toHaveAttribute("src", "blob:isolated-photo");
  expect(loadStoredBuildingPhoto).toHaveBeenLastCalledWith(buildingId, photoId, expect.any(AbortSignal), "original");
  expect(fetch).toHaveBeenCalledWith(new URL(signedUrl), expect.objectContaining({ redirect: "error", credentials: "omit" }));
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: "image/png" }));
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:isolated-photo");
});

it("withholds stale bytes and never follows a link outside the reviewed storage scope", async () => {
  const { fetch, create } = setup();
  const onStale = vi.fn();
  const view = render(<PhotoPreviewImage pin={{ ...pin, contentHash: "a".repeat(64) }} caption="备选照片预览" onStale={onStale} />);
  expect(await screen.findByText("照片版本已更新，请重新查询备选照片。")).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  expect(onStale).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  view.unmount();

  vi.mocked(loadStoredBuildingPhoto).mockResolvedValue({
    url: "https://other.example.org/photo.png", can_download: true, is_preview: false,
    source_url: "https://source.example.org", source_name: "隔离照片",
  });
  render(<PhotoPreviewImage pin={pin} caption="备选照片预览" />);
  expect(await screen.findByText("照片原件路径无法核对。")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce();
});
