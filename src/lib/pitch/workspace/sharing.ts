import { z } from "zod";
import { slideSceneSchema } from "../contracts/scene";
import { loadMedia } from "../data/renderWorkflow";
import { mediaRowSchema, pitchRpc, type PitchContext } from "../data/store";
import { designThemeSchema } from "../design/theme";

const sharedSlideSchema = z.object({
  id: z.uuid(),
  scene: slideSceneSchema,
  theme: designThemeSchema,
  media: z.array(mediaRowSchema),
});

export async function renderSharedSlide(ctx: PitchContext, input: { shareId: string; slideId: string }) {
  const page = sharedSlideSchema.parse(await pitchRpc(ctx, {
    action: "workspace_shared_slide", shareId: input.shareId, slideId: input.slideId,
  }));
  const media = await loadMedia(ctx, page.media, [page.scene]);
  const { renderSceneSvg } = await import("../render/svg");
  const svg = await renderSceneSvg(page.scene, page.theme, media);
  // The owner can revoke access while media is loading or the slide is rendering.
  await pitchRpc(ctx, { action: "workspace_share_verify", shareId: input.shareId });
  return { id: page.id, svg };
}
