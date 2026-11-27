import type { PitchDependencies } from "../data/store";
import { getBuildingPhotoChoices, loadBuildingPhotoMedia } from "../visual-data/photos";
import { commitPayload } from "../workspace/workflow";
import { readProposalPageMedia } from "./proposal-canvas-services";
import { createWorkspacePhotoServices } from "./proposal-photo-revision";
import { workspaceCommandSchema } from "../workspace/protocol";
import type { ReviewProposalHandoff } from "./proposal-competitor-revision";
import type { PreviewProposalQuarter, ProposalRevisionServices } from "./proposal-revision-runtime";

type WorkspaceReview = Parameters<PreviewProposalQuarter>[1] | Parameters<ReviewProposalHandoff>[1];
const forwardedHeaders = ["authorization", "origin", "host", "x-colliers-impersonate-user"] as const;
const workspaceStatus = new Map([
  [401, "QUERY_UNAUTHENTICATED"], [403, "PITCH_DENIED"], [409, "PITCH_CONFLICT"], [422, "PITCH_INVALID"],
]);

const photo = createWorkspacePhotoServices({
  async readChoices(ctx, buildingId, category, hashes) {
    const [photos] = await getBuildingPhotoChoices(ctx, { buildingIds: [buildingId], use: "profile", usedHashes: [...hashes] });
    return [photos?.primary, ...(photos?.alternatives ?? [])].flatMap(item =>
      item && (category === "any" || item.category === category) ? [{ category: item.category, source: item.source }] : []);
  },
  async resolve(ctx, pinnedSource) {
    if (pinnedSource.visual?.kind !== "photo") throw new Error("PITCH_INVALID");
    const { reference } = await loadBuildingPhotoMedia(ctx, pinnedSource.visual, false);
    const source = reference.source;
    const alt = reference.caption?.trim().slice(0, 300) || source.label;
    return { source, cropAllowed: reference.rights.cropAllowed, image: { kind: "image", mediaAssetId: reference.id, mediaVersion: reference.version, alt, sourceIds: [source.id] } };
  },
  readPageMedia: readProposalPageMedia,
  commitPayload,
});

export function installedWorkspaceReviewServices(request: Request, deps: PitchDependencies): ProposalRevisionServices {
  const supports = (action: WorkspaceReview["action"]) =>
    workspaceCommandSchema.options.some(option => option.shape.action.safeParse(action).success);
  const hasQuarter = supports("preview_data_refresh");
  const hasHandoff = supports("review_handoff");
  if (!hasQuarter && !hasHandoff) return { photo };

  const headers = new Headers({ "content-type": "application/json" });
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const url = new URL("workspace", request.url);
  async function review(command: WorkspaceReview, signal: AbortSignal) {
    signal.throwIfAborted();
    if (command.action !== "preview_data_refresh" && command.action !== "review_handoff") throw new Error("PITCH_INVALID");
    workspaceCommandSchema.parse(command);
    const { handleWorkspaceRequest } = await import("../workspace/http");
    signal.throwIfAborted();
    // Run the existing read-only handler in-process with the original request
    // identity and cancellation. Applying a revision uses its own transaction.
    const response = await handleWorkspaceRequest(new Request(url, { method: "POST", headers, signal, body: JSON.stringify(command) }), deps);
    if (!response.ok) throw new Error(workspaceStatus.get(response.status) ?? "PITCH_WORKSPACE_REVIEW_UNAVAILABLE");
    const result: unknown = await response.json();
    signal.throwIfAborted();
    return result;
  }

  const services: ProposalRevisionServices = { photo };
  if (hasQuarter) services.previewQuarter = (ctx, command) => review(command, ctx.signal);
  if (hasHandoff) services.reviewHandoff = (ctx, command) => review(command, ctx.signal);
  return services;
}
