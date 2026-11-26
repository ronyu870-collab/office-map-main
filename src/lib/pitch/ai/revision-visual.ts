import type { SlideContent } from "../contracts/content";
import type { DesignTheme } from "../design/theme";
import type { PitchContext } from "../data/store";
import { studioRegistry } from "../data/renderWorkflow";
import { layoutSlides } from "../layout/engine";
import { normalizationPlan } from "../library/normalize";
import { assertSceneQuality } from "../layout/quality";
import { renderSceneSvg } from "../render/svg";
import { sceneMediaReferences } from "../render/media";

export async function renderRevisionLayout(original: SlideContent, draft: SlideContent,
  getTheme: () => Promise<DesignTheme>, signal: AbortSignal) {
  // This read-only preview uses the default material theme, not the user's
  // existing slide. Never remove an image or truncate a page to simulate fidelity.
  if (original.blocks.length > 10 || original.blocks.some(block =>
    block.kind === "image" || block.kind === "map" ||
    (block.kind === "team" && block.members.some(member => member.mediaAssetId)))) return null;
  try {
    const theme = await getTheme();
    const plan = async (content: SlideContent) => {
      const parts = await normalizationPlan(content, theme);
      if (parts.some(part => part.changes.length)) return null;
      const scenes = (await Promise.all(parts.map(part =>
        layoutSlides(part.content, theme, part.layoutId, part.variant),
      ))).flat();
      if (scenes.length > 3 || sceneMediaReferences(scenes).length) return null;
      const images: string[] = [];
      for (const scene of scenes) {
        signal.throwIfAborted();
        await assertSceneQuality(scene, theme, []);
        images.push(await renderSceneSvg(scene, theme, []));
      }
      return images;
    };
    const before = await plan(original), after = before && await plan(draft);
    if (!before || !after || Buffer.byteLength([...before, ...after].join("")) > 600_000) return null;
    return { before, after };
  } catch {
    // Do not weaken validation or pretend a partial layout is a full preview.
    signal.throwIfAborted();
    return null;
  }
}


export async function previewRevisionLayout(ctx: PitchContext, original: SlideContent, draft: SlideContent) {
  return renderRevisionLayout(original, draft,
    async () => (await studioRegistry(ctx, "colliers-default-v1", 2)).theme.definition, ctx.signal);
}
