import { Resvg } from '@resvg/resvg-js';
import path from 'node:path';
import type { ParsedPage, ExtractedMedia } from './protocol';
const escape = (v: string) => v.replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' })[c]!);
/** Source-structure reconstruction, explicitly not a screenshot of Office. */
export function sourceThumbnail(page: ParsedPage, media: ExtractedMedia[]) {
  const width = 960, height = Math.max(400, Math.min(1350, page.size ? width * page.size.height / page.size.width : 540));
  const sx = page.size ? width / page.size.width : 1, sy = page.size ? height / page.size.height : 1;
  const images = page.images.map(img => {
    const file = media.find(m => m.key === img.key); if (!file) return '';
    const b = img.box && !img.groups.length ? { x: img.box.x * sx, y: img.box.y * sy, w: img.box.w * sx, h: img.box.h * sy } : { x: width * .6, y: 100, w: width * .35, h: height * .5 };
    return `<image x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="xMidYMid meet" href="data:${file.mime};base64,${Buffer.from(file.bytes).toString('base64')}"/>`;
  }).join('');
  let offset = 50;
  const text = page.texts.map(t => {
    const b = t.box && !t.groups.length ? { x: Math.max(10,t.box.x*sx), y: Math.max(22,t.box.y*sy+20), w: Math.max(80,t.box.w*sx) } : { x: 28, y: offset, w: 520 };
    const lines = t.text.match(new RegExp(`[\\s\\S]{1,${Math.max(5, Math.floor(b.w / 15))}}`, 'g')) ?? []; offset += Math.min(8,lines.length)*26+16;
    return lines.slice(0,8).map((line,i) => `<text x="${b.x}" y="${b.y+i*26}" font-size="20" fill="#243044">${escape(line)}</text>`).join('');
  }).join('');
  const summary = page.tables.length || page.charts.length ? `<text x="28" y="${height-45}" font-size="20">表格 ${page.tables.length} · 图表 ${page.charts.length}（完整数据见结构详情）</text>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#faf9f6"/>${images}${text}${summary}<rect y="${height-30}" width="100%" height="30" fill="#e5e8eb"/><text x="16" y="${height-9}" font-size="16">结构提取预览 · 非原始页面截图${page.hidden ? ' · 隐藏页' : ''}</text></svg>`;
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: 'width', value: 480 }, font: { fontFiles: [path.join(process.cwd(),'private/chart-fonts/NotoSansSC-Regular.otf')], loadSystemFonts: false, defaultFontFamily:'Noto Sans SC' } }).render().asPng());
}
