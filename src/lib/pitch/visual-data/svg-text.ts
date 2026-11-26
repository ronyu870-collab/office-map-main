import type { Font } from '@pdf-lib/fontkit';

const escapeXml = (text: string) => text.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]!);

/** Embedded glyphs keep Chinese labels legible in headless image export. */
export function svgText(font: Font) {
  return (x: number, y: number, value: unknown, size: number, color: string, weight = 400, anchor = 'start') => {
    const label = String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ');
    const run = font.layout(label);
    const scale = size / font.unitsPerEm;
    const width = run.positions.reduce((sum, position) => sum + position.xAdvance, 0) * scale;
    let cursor = x - width * (anchor === 'end' ? 1 : anchor === 'middle' ? .5 : 0);
    const paths = run.glyphs.map((glyph, index) => {
      const position = run.positions[index];
      const transform = `translate(${(cursor + position.xOffset * scale).toFixed(2)} ${(y - position.yOffset * scale).toFixed(2)}) scale(${scale} ${-scale})`;
      cursor += position.xAdvance * scale;
      return `<path d="${glyph.path.toSVG()}" transform="${transform}"/>`;
    }).join('');
    return `<g fill="${color}"${weight >= 600 ? ` stroke="${color}" stroke-width="0.35"` : ''} aria-label="${escapeXml(label)}">${paths}</g>`;
  };
}
