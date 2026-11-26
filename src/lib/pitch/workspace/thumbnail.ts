import { pitchRpc, type PitchContext } from "../data/store";
import { templateExample } from "../fixtures/business";
import { DYNAMIC_CAPABILITIES } from "../business/recipes";
import { recipeSchema } from "../business/protocol";
import { layoutSlides } from "../layout/engine";
import { STUDIO_THEME, VERIFICATION_THEME } from "../design/theme";
import { inspectMedia } from "../render/media";
import { renderSceneSvg } from "../render/svg";
import { authorizeExample } from "./examples";
// Bounded process cache contains synthetic layout examples only, never enterprise data.
const cache = new Map<string, Promise<string>>();
export async function templateThumbnail(
  ctx: PitchContext,
  id: string,
  themeName: "default" | "alternate",
) {
  await pitchRpc(ctx, { action: "catalog" });
  await authorizeExample(ctx,id);
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
  if (cache.size > 128) cache.delete(cache.keys().next().value!);
  if (!cache.has(key))
    cache.set(
      key,
      (async () => {
        const examples=templateExample(id,'zh','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666');
        const {content,layoutId:layout,variant}=examples[0];
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
          (await layoutSlides(content, theme, layout, variant))[0],
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
