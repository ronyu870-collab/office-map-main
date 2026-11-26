import { z } from 'zod';
import type { PitchScope } from '../contracts/content';
import { recipeSchema } from '../business/protocol';
import { createSample } from '../data/workflow';
import { randomUUID } from 'node:crypto';
import { studioRegistry, loadMedia } from '../data/renderWorkflow';
import { slideContentSchema } from '../contracts/content';
import { mediaRowSchema, digest } from '../data/store';
import { layoutSlides } from '../layout/engine';
import { assertSceneQuality } from '../layout/quality';
import { numberDeckPages } from '../layout/pagination';
import { pitchRpc, type PitchContext } from '../data/store';
import { templateExample } from '../fixtures/business';
import { DECK_KIT_BY_ID } from '../templates/deckKits';
import { examplePartSchema } from './protocol';
export async function authorizeExample(ctx: PitchContext, id: string) {
    const dynamic = z.object({ allowedDynamic: z.array(z.string()) }).parse(await pitchRpc(ctx, { action: 'workspace_capabilities' }));
    if (dynamic.allowedDynamic.includes(id))
        return;
    const recipe = recipeSchema.parse(await pitchRpc(ctx, { action: 'business_recipe', templateId: id }));
    if (!recipe.enabled)
        throw new Error('PITCH_TEMPLATE_UNAVAILABLE');
}
/** A real workspace worker executes this bounded job. Sample originals stay
 * private drafts; generated copies are private internal artifacts; existing source/media permission checks also guard exports. */
export async function generateExampleProject(ctx: PitchContext, input: {
    projectId: string;
    requestId: string;
    title: string;
    scope: PitchScope;
    language: 'zh' | 'en';
    themeId: string;
    themeVersion: number;
    part: z.infer<typeof examplePartSchema>;
}) {
    const part = examplePartSchema.parse(input.part);
    if (part.kit) {
        const kit = DECK_KIT_BY_ID.get(part.kit.id);
        if (!kit || kit.version !== part.kit.version || part.templateIds.some(id => !kit.sections.some(s => s.templateId === id)))
            throw new Error('PITCH_INVALID');
    }
    const generated = [], slides = [], recipes = [];
    const theme = (await studioRegistry(ctx, input.themeId, input.themeVersion)).theme.definition;
    for (const templateId of part.templateIds) {
        await authorizeExample(ctx, templateId);
        if (!templateId.startsWith('lease-')) {
            const candidate = (await pitchRpc(ctx, { action: 'business_catalog' })) as {
                recipes: unknown[];
            };
            const recipe = candidate.recipes.map(r => recipeSchema.parse(r)).find(r => r.id === templateId);
            if (recipe)
                recipes.push({ id: recipe.id, revision: recipe.revision });
        }
        const pages = templateExample(templateId, input.language, '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666');
        for (const [page, example] of pages.entries()) {
            const sample = z.object({ assetId: z.uuid() }).parse(await createSample(ctx, input.requestId, input.scope, undefined, input.language, { templateId, page }));
            const stored = z.object({ version: z.object({ content: slideContentSchema }), media: z.array(mediaRowSchema) }).parse(await pitchRpc(ctx, { action: 'get_asset', assetId: sample.assetId }));
            const content = stored.version.content, id = randomUUID(), scenes = await layoutSlides(content, theme, example.layoutId, example.variant), media = await loadMedia(ctx, stored.media, scenes);
            generated.push({ id, content, sha256: digest(new TextEncoder().encode(JSON.stringify(content))) });
            for (const scene of scenes) {
                await assertSceneQuality(scene, theme, media);
                slides.push({ slideId: randomUUID(), assetId: id, assetVersion: 1, content, scene, theme });
            }
            if (slides.length > 50)
                throw new Error('PITCH_PAGE_LIMIT');
        }
    }
    // Reuse the existing generated-artifact transaction. Originals stay draft;
    // only private generated copies become usable within this owner's workspace.
    // Their test flag, document/media provenance and no-client/no-AI permissions
    // are enforced by the same business commit and export guards as other pages.
    return pitchRpc(ctx, { action: 'business_generate_commit', projectId: input.projectId, title: input.title, scope: input.scope, themeId: input.themeId, themeVersion: input.themeVersion, language: input.language, parts: [part], requestKey: digest(new TextEncoder().encode(JSON.stringify(input))), bindings: [], snapshots: [], recipes, changes: [], generated, slides: numberDeckPages(slides).map(({ slideId, assetId, assetVersion, content, scene }) => ({ slideId, assetId, assetVersion, content, scene })) });
}
