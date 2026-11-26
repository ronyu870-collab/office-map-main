import type { Font } from '@pdf-lib/fontkit';
import type { SlideContent } from '../contracts/content';
import type { SceneElement } from '../contracts/scene';
import type { DesignTheme } from '../design/theme';
import { LayoutError, wrapText, lineHeight } from './metrics';
type ImageBlock = Extract<SlideContent['blocks'][number], { kind: 'image' }>;

/** Theme-aware primitives shared by all layout compositions. Coordinates are inches. */
export function sceneComponents(font: Font, theme: DesignTheme) {
  const text = (value: string, x: number, y: number, w: number, h: number, role: 'title' | 'body' = 'body', bold = false, purpose?: 'source' | 'footer'): SceneElement => {
    const lines = wrapText(value, w, theme.typography[role], font);
    if (lines.length * lineHeight(theme.typography[role]) > h + .015) throw new LayoutError(role === 'title' ? 'PITCH_TITLE_CAPACITY' : 'PITCH_TEXT_CAPACITY', '完整文字无法放入当前区域，请选择更宽布局或分成多页。');
    return { kind: 'text', x, y, w, h, text: lines.join('\n'), role, bold, ...(purpose ? { purpose } : {}) };
  };
  const lines = (value: string, w: number) => wrapText(value, w, theme.typography.body, font);
  const image = (b: ImageBlock, x: number, y: number, w: number, h: number): SceneElement => ({ kind: 'image', x, y, w, h, mediaAssetId: b.mediaAssetId, mediaVersion: b.mediaVersion, alt: b.alt, fit: 'contain' });
  return { text, lines, image, font, theme, lh: lineHeight(theme.typography.body) };
}
