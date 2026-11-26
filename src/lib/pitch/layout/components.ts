import type { Font } from '@pdf-lib/fontkit';
import type { SlideContent } from '../contracts/content';
import type { SceneElement } from '../contracts/scene';
import { textSize, type DesignTheme } from '../design/theme';
import { LayoutError, wrapText, lineHeight } from './metrics';
type SceneText = Extract<SceneElement, { kind: 'text' }>;
type SceneImage = Extract<SceneElement, { kind: 'image' }>;
type ImageBlock = Extract<SlideContent['blocks'][number], { kind: 'image' }>;

/** Theme-aware primitives shared by all layout compositions. Coordinates are inches. */
export function sceneComponents(font: Font, theme: DesignTheme) {
  const text = (value: string, x: number, y: number, w: number, h: number, role: 'title' | 'body' = 'body', bold = false, purpose?: 'source' | 'footer', semantic?: SceneText['semantic']): SceneText => {
    const size = textSize(theme, role, semantic);
    const lines = wrapText(value, w, size, font);
    if (lines.length * lineHeight(size) > h + .015) throw new LayoutError(role === 'title' ? 'PITCH_TITLE_CAPACITY' : 'PITCH_TEXT_CAPACITY', '完整文字无法放入当前区域，请选择更宽布局或分成多页。');
    return { kind: 'text', x, y, w, h, text: lines.join('\n'), role, bold, ...(purpose ? { purpose } : {}), ...(semantic ? { semantic } : {}) };
  };
  const lines = (value: string, w: number) => wrapText(value, w, theme.typography.body, font);
  const image = (b: ImageBlock, x: number, y: number, w: number, h: number, fit: 'contain' | 'cover' = 'contain'): SceneImage => {
    fit = b.fit ?? fit;
    return { kind: 'image', x, y, w, h, mediaAssetId: b.mediaAssetId, mediaVersion: b.mediaVersion, alt: b.alt, fit, ...(fit === 'cover' && b.focus ? { focus: b.focus } : {}) };
  };
  const imageWithCredit = (b: ImageBlock, x: number, y: number, w: number, h: number): SceneElement[] => {
    if (!b.caption && !b.credit) return [image(b, x, y, w, h)];
    const label = [b.caption ?? b.alt, b.credit].filter(Boolean).join(' · ');
    const size = textSize(theme, 'body', 'caption');
    const labelHeight = wrapText(label, w, size, font).length * lineHeight(size) + .012;
    if (h - labelHeight < .95) throw new LayoutError('PITCH_IMAGE_CAPTION_CAPACITY', '照片说明与署名需要更多空间，请选择更大的图像区域。');
    return [image(b, x, y, w, h - labelHeight - .11), text(label, x, y + h - labelHeight, w, labelHeight, 'body', false, undefined, 'caption')];
  };
  return { text, lines, image, imageWithCredit, font, theme, lh: lineHeight(theme.typography.body) };
}
