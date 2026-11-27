import { createHash, webcrypto } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { loadStoredBuildingPhoto } from "@/src/services/buildingPhotosClient";
import { ProposalPreview } from "./ProposalPreview";
import type { Call } from "./client";

vi.mock("@/src/services/buildingPhotosClient", () => ({ loadStoredBuildingPhoto: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const buildingId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const firstId = "33333333-3333-4333-8333-333333333333";
const secondId = "44444444-4444-4444-8444-444444444444";
const sourceId = "55555555-5555-4555-8555-555555555555";
const storedBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 65, 66, 67]);
const sha256 = createHash("sha256").update(storedBytes).digest("hex");
const versionHash = "e".repeat(64);
const storage = "https://isolated.supabase.co";

function photo(photoId: string, caption: string, contentHash: string, version: string) {
  const visual = {
    kind: "photo", id: photoId, version: 1, versionHash: version, contentHash, buildingIds: [buildingId],
    origin: { type: "building-photo", buildingId, photoId },
  };
  return {
    ...visual, caption, source: {
      id: sourceId, kind: "record", sha256: contentHash, version, recordId: photoId, label: "获权实景来源", visual,
    },
  };
}

it.each([false, true])("reads one pinned original at a time and requires a new plan when a reviewed photo changes (auto open: %s)", async (autoOpen) => {
  const user = userEvent.setup();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", storage);
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pitch-test-photo");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.mocked(loadStoredBuildingPhoto).mockClear();
  vi.mocked(loadStoredBuildingPhoto).mockImplementation(async (_id, photoId) => ({
    url: storage + "/storage/v1/object/sign/building-sales-materials/building-photos/v1/" + buildingId + "/" + photoId + "/photo.png",
    can_download: true, is_preview: false, source_url: "https://example.org", source_name: "隔离照片",
  }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(storedBytes)));
  const exterior = photo(firstId, "楼宇外立面", sha256, versionHash);
  const interior = photo(secondId, "楼宇大堂", "a".repeat(64), "b".repeat(64));
  const invalid = { ...exterior, caption: "错配来源", source: { ...exterior.source, recordId: secondId } };
  const call = vi.fn(async () => ({
    status: "ready", selection: "explicit",
    plan: { id, title: "楼宇推介", version: 1, contextFingerprint: "f".repeat(64), gaps: [],
      slides: [
        { id: firstId, title: "项目封面", visuals: [exterior, invalid, interior] },
        { id: secondId, title: "项目简介", visuals: [exterior] },
      ] },
    brief: { city: "北京", submarkets: ["CBD"], period: "2026-Q3", scenario: "building-promotion", buildingIds: [buildingId] },
  })) as unknown as Call;
  render(<ProposalPreview call={call} projectId={id} projectVersion={1} city="北京" question="制作楼宇推介"
    buildingIds={[buildingId]} period="2026-Q3" language="zh" onGenerated={vi.fn()} disabled={false}
    onPromotionPeriod={autoOpen ? vi.fn() : undefined} />);
  await user.click(screen.getByRole("button", { name: "规划正式提案" }));
  const photos = await screen.findByText("已选楼宇照片（2）");
  if (!autoOpen) {
    expect(loadStoredBuildingPhoto).not.toHaveBeenCalled();
    await user.click(photos);
  }
  expect(await screen.findByRole("img", { name: "楼宇外立面" })).toBeInTheDocument();
  expect(screen.getByText("获权实景来源")).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "错配来源" })).not.toBeInTheDocument();
  expect(loadStoredBuildingPhoto).toHaveBeenCalledExactlyOnceWith(buildingId, firstId, expect.any(AbortSignal), "original");

  await user.selectOptions(screen.getByLabelText("照片"), "1");
  await screen.findByText("照片版本已更新，请重新规划正式提案。");
  expect(screen.queryByRole("button", { name: "确认并生成 Pitch" })).not.toBeInTheDocument();
  expect(revoke).toHaveBeenCalledWith("blob:pitch-test-photo");
  expect(loadStoredBuildingPhoto).toHaveBeenLastCalledWith(buildingId, secondId, expect.any(AbortSignal), "original");
  expect(call).toHaveBeenCalledOnce();
});
