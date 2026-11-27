import { beforeEach, expect, it, vi } from "vitest";
import { slideContentSchema } from "../contracts/content";
import type { PitchContext, PitchDependencies } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import { layoutSlides } from "../layout/engine";
import { STUDIO_TEMPLATE } from "../templates/registry";
import { handleAiRequest } from "./http";
import type { ProposalPhotoServices } from "./proposal-photo-revision";

const fixture = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn() }));
vi.mock("../data/store", async original => ({ ...await original<typeof import("../data/store")>(),
  authorizePitch: fixture.actor, pitchRpc: fixture.rpc }));
const id = (number: number) => `540cb696-b236-4fbf-8328-${String(number).padStart(12, "0")}`;
const projectId = id(1), pageId = id(2), buildingId = id(3), otherBuildingId = id(10);
const dependency = { enabled: true } as PitchDependencies;
const ctx = { signal: new AbortController().signal } as PitchContext;
const sceneImageId = "object-106";

function photo(number: number, building: string, category: string, label: string) {
  const versionHash = number.toString(16).repeat(64), contentHash = (number + 4).toString(16).repeat(64);
  const source = { kind: "record" as const, id: id(number + 20), label, recordId: id(number + 30),
    dataAsOf: "2026-11-10", locator: "授权楼宇照片目录", version: versionHash, sha256: contentHash,
    visual: { id: id(number), version: 8, kind: "photo" as const, versionHash, contentHash, buildingIds: [building],
      origin: { type: "building-photo" as const, buildingId: building, photoId: id(number + 30) } },
  };
  const image = { kind: "image" as const, mediaAssetId: id(number), mediaVersion: 8, alt: label, sourceIds: [source.id] };
  return { category, image, source };
}

const exterior = photo(4, buildingId, "exterior", "原外立面照片");
const lobby = photo(5, buildingId, "lobby", "核验的大堂照片");
const other = photo(6, otherBuildingId, "lobby", "其他楼宇的照片");
const changed = photo(7, buildingId, "lobby", "目录中新大堂照片");
const sibling = photo(8, otherBuildingId, "exterior", "同页第二张照片");
const workSource = { id: id(80), kind: "record" as const, label: "人工编辑", locator: "授权编辑", version: "2", dataAsOf: "2026-11-10" };

async function setup(withPair = false) {
  const content = slideContentSchema.parse({
    protocol: "colliers-pitch/1", locale: "zh", title: "楼宇图文", disclosure: "internal", dataAsOf: "2026-11-10", isTestData: false,
    sources: [exterior.source, withPair ? sibling.source : workSource],
    blocks: withPair ? [exterior.image, sibling.image, { kind: "paragraph",
      text: `${exterior.image.alt} · ${sibling.image.alt}`, sourceIds: [exterior.source.id, sibling.source.id] }]
      : [exterior.image, { kind: "paragraph", text: "保留已编辑文字。", sourceIds: [workSource.id] }],
  });
  const [canvas] = await layoutSlides(content, STUDIO_THEME, withPair ? "photo-pair" : "image-text");
  canvas.elements = canvas.elements.map(element => element.kind === "image" && element.mediaAssetId === exterior.image.mediaAssetId
    ? { ...element, x: element.x + 0.03, editorId: sceneImageId }
    : element.kind === "text" && element.text.includes("保留已编辑文字")
      ? { ...element, editorId: "object-107" } : element);
  const page = { id: pageId, version: 9, asset_id: id(50), asset_version: 1, template_id: "studio-content",
    template_version: 1, content, scene: canvas };
  const workspace = {
    project: { id: projectId, title: "楼宇推介", version: 12, theme_id: STUDIO_THEME.id, theme_version: STUDIO_THEME.version,
      organization_id: "test", region: "华北", city: "北京", business_line: "office" },
    workspace: { context: { buildingIds: [buildingId] }, page_settings: { [pageId]: { manual: true } }, active_slide: pageId },
    history: [{ version: 11, created_at: "2026-11-10" }], tasks: [], exports: [], slides: [page],
  };
  fixture.rpc.mockImplementation(async (_actor, command) => {
    if (command.action === "workspace_get") return workspace;
    if (command.action === "catalog") return {};
    if (command.action === "registry") return { template: { config: STUDIO_TEMPLATE }, theme: { definition: STUDIO_THEME } };
    throw new Error("Unexpected request");
  });
  let candidates = [exterior, other, lobby];
  const services = {
    readChoices: vi.fn<ProposalPhotoServices["readChoices"]>(async () => candidates),
    resolve: vi.fn<ProposalPhotoServices["resolve"]>(async (_ctx, source) => candidates.find(item => item.source.id === source.id)!),
    verifyPage: vi.fn<ProposalPhotoServices["verifyPage"]>(async () => undefined),
    persist: vi.fn<ProposalPhotoServices["persist"]>(async (_ctx, current, pages) => ({ ...current, slides: pages })),
  } satisfies ProposalPhotoServices;
  const call = (payload: object) => handleAiRequest(new Request("https://pitch.test/api/intelligence/pitch/ai", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://pitch.test" },
    body: JSON.stringify(payload),
  }), dependency, undefined, { photo: services });
  const preview = (question = "把所选对象换用楼宇大堂照片", objectIds = [sceneImageId]) => call({
    action: "proposal_revision", input: { projectId, currentPageId: pageId, expectedVersion: 12, question, objectIds },
  });
  return { services, call, preview, page, workspace, setCandidates: (values: typeof candidates) => { candidates = values; } };
}

beforeEach(() => {
  fixture.actor.mockReset().mockResolvedValue(ctx);
  fixture.rpc.mockReset();
});

it("uses the exact building receipt, rechecks before confirmation and preserves manually positioned objects and source links", async () => {
  const { services, call, preview, page, workspace } = await setup();
  const response = await preview();
  const review = await response.json();
  expect(response.status, JSON.stringify(review)).toBe(200);
  expect(review).toMatchObject({ status: "photo-review", projectVersion: 12, changes: [{ pageId, pageVersion: 9,
    objectId: sceneImageId, buildingId, before: { pin: exterior.source.visual }, after: { pin: lobby.source.visual } }],
  });
  expect(services.readChoices).toHaveBeenCalledWith(ctx, buildingId, "lobby", [exterior.source.sha256]);
  expect(services.persist).not.toHaveBeenCalled();
  const result = await call(review.command);
  expect(result.status).toBe(200);
  expect(services.readChoices).toHaveBeenCalledTimes(2);
  expect(services.verifyPage).toHaveBeenCalledTimes(2);
  expect(services.persist).toHaveBeenCalledOnce();
  const [untouched, [updated]] = services.persist.mock.calls[0].slice(1) as
    [Parameters<ProposalPhotoServices["persist"]>[1], Parameters<ProposalPhotoServices["persist"]>[2]];
  expect(untouched.project.version).toBe(workspace.project.version);
  expect(updated.content.blocks[0]).toEqual(lobby.image);
  expect(updated.content.blocks[1]).toEqual(page.content.blocks[1]);
  expect(updated.content.sources).toEqual([workSource, lobby.source]);
  expect(updated.scene.elements.find(element => element.editorId === sceneImageId))
    .toMatchObject({ x: page.scene.elements.find(element => element.editorId === sceneImageId)!.x,
      mediaAssetId: lobby.image.mediaAssetId, fit: "contain" });
  expect(updated.scene.elements.find(element => element.editorId === "object-107"))
    .toEqual(page.scene.elements.find(element => element.editorId === "object-107"));
});

it("rejects an altered candidate or page version on confirmation without calling the transaction", async () => {
  const { services, call, preview, setCandidates, workspace } = await setup();
  const review = await (await preview()).json();
  setCandidates([changed]);
  const changedSource = await call(review.command);
  expect(changedSource.status).toBe(409);
  workspace.project.version++;
  const changedPage = await call(review.command);
  expect(changedPage.status).toBe(409);
  expect(services.persist).not.toHaveBeenCalled();
});

it("returns a clear state for missing eligible photos and keeps an unrelated object outside the change", async () => {
  const { services, preview, setCandidates } = await setup();
  expect(await (await preview(undefined, ["object-107"])).json()).toMatchObject({ status: "clarification" });
  setCandidates([exterior, other]);
  expect(await (await preview()).json()).toMatchObject({ status: "unavailable" });
  expect(services.resolve).not.toHaveBeenCalled();
  expect(services.persist).not.toHaveBeenCalled();
});

it("rewrites the deterministic shared caption while retaining the second photo and its source", async () => {
  const { services, call, preview } = await setup(true);
  const review = await (await preview()).json();
  expect(review, JSON.stringify(review)).toMatchObject({ status: "photo-review" });
  expect((await call(review.command)).status).toBe(200);
  const updated = services.persist.mock.calls[0][2][0];
  expect(updated.content.blocks).toEqual([lobby.image, sibling.image,
    { kind: "paragraph", text: `${lobby.image.alt} · ${sibling.image.alt}`, sourceIds: [lobby.source.id, sibling.source.id] }]);
  expect(updated.content.sources).toEqual([sibling.source, lobby.source]);
});
