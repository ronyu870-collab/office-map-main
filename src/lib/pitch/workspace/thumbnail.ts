import { pitchRpc, type PitchContext } from "../data/store";
import { layoutFixture } from "../fixtures/layouts";
import { DYNAMIC_CAPABILITIES } from "../business/recipes";
import { recipeSchema } from "../business/protocol";
import { layoutSlides } from "../layout/engine";
import { STUDIO_THEME, VERIFICATION_THEME } from "../design/theme";
import { inspectMedia } from "../render/media";
import { renderSceneSvg } from "../render/svg";
import type { LayoutId } from "../contracts/scene";
// Bounded process cache contains synthetic layout examples only, never enterprise data.
const cache = new Map<string, Promise<string>>();
export async function templateThumbnail(
  ctx: PitchContext,
  id: string,
  themeName: "default" | "alternate",
) {
  await pitchRpc(ctx, { action: "catalog" });
  const dynamic = DYNAMIC_CAPABILITIES.find(
    (r) => r.id === id && r.status === "available",
  );
  const recipe = dynamic
    ? undefined
    : recipeSchema.parse(
        await pitchRpc(ctx, { action: "business_recipe", templateId: id }),
      );
  if (!recipe && !dynamic) throw new Error("PITCH_INVALID");
  const key = id + ":" + (recipe?.revision ?? 1) + ":" + themeName;
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  if (!cache.has(key))
    cache.set(
      key,
      (async () => {
        const layout: LayoutId =
          recipe?.layoutId ??
          (id.includes("trend") ||
          id.includes("distribution") ||
          ["rent-comparison", "vacancy-comparison"].includes(id)
            ? "chart-insight"
            : "data-table");
        const content = layoutFixture(layout);
        content.title = recipe?.names.zh ?? dynamic!.name;
        const theme =
          themeName === "default" ? STUDIO_THEME : VERIFICATION_THEME;
        const { Resvg } = await import("@resvg/resvg-js");
        const bytes = new Resvg(
          '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#E7EBEE"/><path d="M160 540V180h240v360M460 540V100h300v440" fill="#84979A"/></svg>',
        )
          .render()
          .asPng();
        const media = await inspectMedia([
          {
            id: "66666666-6666-4666-8666-666666666666",
            version: 1,
            mime: "image/png",
            bytes,
          },
        ]);
        return renderSceneSvg(
          (await layoutSlides(content, theme, layout))[0],
          theme,
          media,
        );
      })().catch((error) => {
        cache.delete(key);
        throw error;
      }),
    );
  return { svg: await cache.get(key), example: true };
}
