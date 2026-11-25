import { createOfficePresentation } from '@/src/lib/intelligence/query/officePresentation';
import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';
import { slideSceneSchema, type SlideScene } from '../contracts/scene';
import { designThemeSchema, type DesignTheme } from '../design/theme';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export type SceneMedia = { id: string; version: number; mime: string; bytes: Uint8Array };
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069\uFFFE\uFFFF]/g, ' ');
/** No URLs, file system paths, XML, scripts, callbacks or model-generated code.
 * Native text boxes remain editable; media bytes are already authorized/digested. */
export async function renderPitchPptx(title: string, pages: { scene: SlideScene; theme: DesignTheme }[], media: SceneMedia[]): Promise<Uint8Array> {
  if (!pages.length || pages.length > 50) throw new Error('PITCH_PAGE_LIMIT');
  const deck = await createOfficePresentation({ author: 'Colliers Pitch Studio', title: clean(title), subject: 'Pitch Studio', font: pages[0].theme.fonts.zh });
  for (const [i, page] of pages.entries()) {
    const scene = slideSceneSchema.parse(page.scene), theme = designThemeSchema.parse(page.theme);
    if (scene.themeId !== theme.id || scene.themeVersion !== theme.version) throw new Error('PITCH_THEME_MISMATCH');
    const slide = deck.addSlide(); slide.background = { color: theme.colors.background };
    for (const element of scene.elements) {
      const { x, y, w, h } = element;
      if (element.kind === 'text') slide.addText(clean(element.text), { x, y, w, h, margin: 0, valign: 'top',
        fontFace: /\p{Script=Han}/u.test(element.text) ? theme.fonts.zh : theme.fonts.en,
        fontSize: theme.typography[element.role], color: element.role === 'title' ? theme.colors.primary : theme.colors.text,
        bold: element.bold, breakLine: false, lang: 'zh-CN', lineSpacingMultiple: 1.15 });
      else {
        const image = media.find(m => m.id === element.mediaAssetId && m.version === element.mediaVersion);
        if (!image || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime)) throw new Error('PITCH_MEDIA_UNAVAILABLE');
        slide.addImage({ data: image.mime + ';base64,' + Buffer.from(image.bytes).toString('base64'), x, y, w, h, altText: clean(element.alt) });
      }
    }
    if (theme.logo.enabled) slide.addImage({ data: COLLIERS_LOGO_DATA_URI, x: theme.width - theme.margin - 1, y: theme.margin, w: 1, h: .562 });
    if (theme.footer.enabled) slide.addText(clean(theme.footer.label + (theme.footer.pageNumber ? ` · ${i + 1}` : '')), {
      x: theme.margin, y: 6.85, w: theme.width - 2 * theme.margin, h: .35, margin: 0,
      fontSize: theme.typography.body, fontFace: theme.fonts.zh, color: theme.colors.muted,
    });
  }
  const bytes = new Uint8Array(await deck.write({ outputType: 'uint8array', compression: true }) as Uint8Array);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('PITCH_EXPORT_LIMIT');
  return bytes;
}
