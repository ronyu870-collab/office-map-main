import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit, { type Font } from '@pdf-lib/fontkit';

let fontPromise: Promise<Font> | undefined;
export function sceneFont() {
  return fontPromise ??= readFile(path.join(process.cwd(), 'private/chart-fonts/NotoSansSC-Regular.otf')).then(bytes => fontkit.create(bytes));
}
export class LayoutError extends Error {
  constructor(public readonly code: string, public readonly detail: string) { super(code); }
}
export function assertText(value: string, font: Font) {
  if (/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u202A-\u202E\u2066-\u2069]/u.test(value)) throw new LayoutError('PITCH_TEXT_ENCODING', '文字包含乱码替换符或不可见控制字符。');
  for (const c of value.replace(/[\n\r\t]/g, '')) if (!font.hasGlyphForCodePoint(c.codePointAt(0)!)) throw new LayoutError('PITCH_GLYPH_UNAVAILABLE', `当前字体不支持字符 ${c}，请换用受支持文字。`);
}
export function textWidth(value: string, size: number, font: Font) {
  return font.layout(value).positions.reduce((s, p) => s + p.xAdvance, 0) / font.unitsPerEm * size / 72;
}
const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });

/** Explicit line breaks shared by Office and SVG; no font shrinking or truncation. */
export function wrapText(value: string, width: number, size: number, font: Font): string[] {
  assertText(value, font);
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
    if (textWidth(paragraph, size, font) <= width - .04) {
      lines.push(paragraph);
      continue;
    }
    let line = '';
    // Segment words, CJK characters and punctuation. A long token may wrap at a
    // grapheme boundary; existing hard line breaks remain meaningful.
    const segments = Array.from(graphemes.segment(paragraph), s => s.segment);
    for (const c of segments) {
      if (textWidth(line + c, size, font) > width - .04 && line) {
        const boundary = line.lastIndexOf(' ');
        if (boundary > 0 && textWidth(line.slice(0, boundary), size, font) > width * .5) {
          lines.push(line.slice(0, boundary)); line = line.slice(boundary + 1);
        } else {
          // Chinese closing punctuation must stay with a preceding character;
          // an opening bracket must move with the following text.
          const chars = Array.from(line), closing = /^[，。！？；：、）》】」』]$/u.test(c);
          let carry = '';
          if (closing || /[（《【「『]$/u.test(line)) {
            carry = chars.pop() ?? '';
            while (chars.length && /^[，。！？；：、）》】」』]/u.test(carry)) carry = chars.pop() + carry;
          }
          const before = chars.join('');
          if (!before) throw new LayoutError('PITCH_TEXT_CAPACITY', '文字区域过窄，无法保持标点与正文的合理换行。');
          lines.push(before); line = carry;
        }
      }
      if (textWidth(c, size, font) > width) throw new LayoutError('PITCH_TEXT_CAPACITY', '文字区域过窄，请更换布局。');
      line += c;
    }
    lines.push(line);
  }
  return lines;
}
export const lineHeight = (size: number) => size / 72 * 1.32;
