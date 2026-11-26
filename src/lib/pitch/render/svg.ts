import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';
import { slideSceneSchema, type SlideScene, type SceneElement } from '../contracts/scene';
import { designThemeSchema, type DesignTheme } from '../design/theme';
import { sceneFont, wrapText, lineHeight } from '../layout/metrics';
import { assertSceneQuality } from '../layout/quality';
import { chartScale, mapGeometry } from './geometry';
import { cellText } from './format';
import { inspectMedia, type SceneMedia } from './media';
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const px = (n: number) => n * 96;

/** Fixed SVG serializer; no caller SVG, URLs, HTML, metadata or hidden data.
 * Glyph outlines use the same bundled metrics as layout, avoiding browser SVG
 * font-loading races. Office retains native text with the declared font. */
export async function renderSceneSvg(raw: SlideScene, rawTheme: DesignTheme, rawMedia: SceneMedia[]) {
  const scene = slideSceneSchema.parse(raw), theme = designThemeSchema.parse(rawTheme), media = await inspectMedia(rawMedia), font = await sceneFont();
  await assertSceneQuality(scene, theme, media);
  const parts: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => `<rect x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}" fill="#${fill}"${stroke ? ` stroke="#${stroke}"` : ''}/>`;
  const text = (value: string, x: number, y: number, w: number, size = theme.typography.body, bold = false, color = theme.colors.text) => {
    const lines = wrapText(value, w, size, font), scale = size / 72 * 96 / font.unitsPerEm;
    const fragments = lines.map((line, index) => {
      const run = font.layout(line); let dx = 0;
      return run.glyphs.map((g, i) => { const p = run.positions[i], at = dx; dx += p.xAdvance;
        return `<path d="${g.path.toSVG()}" transform="translate(${px(x) + (at + p.xOffset) * scale} ${px(y) + size / 72 * 96 * 1.03 + index * px(lineHeight(size)) - p.yOffset * scale}) scale(${scale} ${-scale})"${bold ? ' stroke="currentColor" stroke-width="9"' : ''}/>`;
      }).join('');
    }).join('');
    return `<g fill="#${color}" color="#${color}" role="img" aria-label="${xml(value)}"><title>${xml(value)}</title>${fragments}</g>`;
  };
  const line = (x: number, y: number, x2: number, y2: number, color = theme.table.border) => `<line x1="${px(x)}" y1="${px(y)}" x2="${px(x2)}" y2="${px(y2)}" stroke="#${color}" stroke-width="1.3"/>`;
  const chartSvg = (el: Extract<SceneElement, { kind: 'chart' }>) => {
    let svg = '', cursor = el.x;
    for (const [i, s] of el.series.entries()) { const label = `${s.name}${s.unit ? ` (${s.unit})` : ''}`; svg += rect(cursor, el.y + .1, .12, .12, theme.chartColors[i % theme.chartColors.length]) + text(label, cursor + .2, el.y, el.w / el.series.length - .22); cursor += el.w / el.series.length; }
    const { min, max } = chartScale(el), x = el.x + 1.0, y = el.y + .65, w = el.w - 1.2, h = el.h - 1.5;
    if (el.chartType === 'pie') {
      const values = el.series[0].values as number[], total = values.reduce((a, b) => a + b, 0), cx = x + w * .32, cy = y + h / 2, r = Math.min(w * .3, h / 2); let angle = -Math.PI / 2;
      values.forEach((v, i) => { const delta = v / total * Math.PI * 2, next = angle + delta;
        if (delta >= Math.PI * 2 - 1e-9) svg += `<circle cx="${px(cx)}" cy="${px(cy)}" r="${px(r)}" fill="#${theme.chartColors[i % theme.chartColors.length]}"/>`;
        else if (v > 0) svg += `<path d="M${px(cx)} ${px(cy)} L${px(cx + r * Math.cos(angle))} ${px(cy + r * Math.sin(angle))} A${px(r)} ${px(r)} 0 ${delta > Math.PI ? 1 : 0} 1 ${px(cx + r * Math.cos(next))} ${px(cy + r * Math.sin(next))}Z" fill="#${theme.chartColors[i % theme.chartColors.length]}"/>`;
        svg += text(`${el.categories[i]}: ${cellText(v)}`, x + w * .67, y + i * .4, w * .33); angle = next;
      }); return svg;
    }
    const sy = (v: number) => y + h - (v - min) / (max - min) * h, sx = (v: number) => x + (v - min) / (max - min) * w;
    const horizontal = el.chartType === 'bar';
    svg += line(x, y, x, y + h) + line(x, y + h, x + w, y + h);
    for (let i = 0; i <= 4; i++) { const v = min + (max - min) * i / 4; svg += horizontal ? text(cellText(v), x + w * i / 4 - .2, y + h + .12, .9) : text(cellText(v), el.x, sy(v) - .12, .9); }
    const n = el.categories.length;
    el.categories.forEach((c, i) => { svg += horizontal ? text(c, el.x, y + h * (i + .25) / n, .9) : text(c, x + w * i / n, y + h + .15, w / n); });
    el.series.forEach((s, si) => {
      const color = theme.chartColors[si % theme.chartColors.length]; let previous: [number, number] | undefined;
      s.values.forEach((v, i) => {
        if (v === null) { previous = undefined; return; }
        if (el.chartType === 'line' || el.chartType === 'combo' && si === 1) {
          const point: [number, number] = [x + w * (i + .5) / n, sy(v)];
          if (previous) svg += line(previous[0], previous[1], point[0], point[1], color);
          svg += `<circle cx="${px(point[0])}" cy="${px(point[1])}" r="3" fill="#${color}"/>`; previous = point;
        } else if (horizontal) {
          const bh = h / n * .65 / el.series.length, yy = y + h * i / n + si * bh;
          svg += rect(Math.min(sx(0), sx(v)), yy, Math.max(.002, Math.abs(sx(v) - sx(0))), bh, color);
        } else {
          const count = el.chartType === 'combo' ? 1 : el.series.length, bw = w / n * .65 / count, xx = x + w * (i + .18) / n + si * bw;
          svg += rect(xx, Math.min(sy(0), sy(v)), bw, Math.max(.002, Math.abs(sy(v) - sy(0))), color);
        }
      });
    }); return svg;
  };
  parts.push(rect(0, 0, scene.width, scene.height, theme.colors.background));
  for (const el of scene.elements) {
    if (el.kind === 'text') parts.push(text(el.text, el.x, el.y, el.w, theme.typography[el.role], el.bold, el.purpose ? theme.colors.muted : el.role === 'title' ? theme.colors.primary : theme.colors.text));
    else if (el.kind === 'image') {
      const image = media.find(m => m.id === el.mediaAssetId && m.version === el.mediaVersion)!;
      parts.push(`<image x="${px(el.x)}" y="${px(el.y)}" width="${px(el.w)}" height="${px(el.h)}" preserveAspectRatio="xMidYMid meet" href="data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}"><title>${xml(el.alt)}</title></image>`);
    } else if (el.kind === 'brand') {
      parts.push(`<image x="${px(el.x)}" y="${px(el.y)}" width="${px(el.w)}" height="${px(el.h)}" preserveAspectRatio="xMidYMid meet" href="${COLLIERS_LOGO_DATA_URI}"/>`);
    } else if (el.kind === 'shape') {
      const fill = theme.colors[el.fill];
      parts.push(`<g opacity="${el.opacity??1}">`);
      if (el.shape === 'ellipse') parts.push(`<ellipse cx="${px(el.x + el.w / 2)}" cy="${px(el.y + el.h / 2)}" rx="${px(el.w / 2)}" ry="${px(el.h / 2)}" fill="#${fill}"/>`);
      else if (el.shape === 'arrow') {
        // Match DrawingML chevron's default 50% of the short side adjustment.
        const tip = Math.min(el.w, el.h) / 2;
        parts.push(`<path d="M${px(el.x)} ${px(el.y)} H${px(el.x + el.w - tip)} L${px(el.x + el.w)} ${px(el.y + el.h / 2)} L${px(el.x + el.w - tip)} ${px(el.y + el.h)} H${px(el.x)} L${px(el.x + tip)} ${px(el.y + el.h / 2)}Z" fill="#${fill}"/>`);
      }
      else if(el.shape==='triangle'||el.shape==='trapezoid') {
        const points=el.shape==='triangle'?[[.5,0],[1,1],[0,1]]:[[.25,0],[.75,0],[1,1],[0,1]];
        parts.push(`<polygon points="${points.map(([x,y])=>`${px(el.x+x*el.w)},${px(el.y+y*el.h)}`).join(' ')}" fill="#${fill}"/>`);
      } else parts.push(rect(el.x, el.y, el.w, el.h, fill));
      parts.push('</g>');
    } else if (el.kind === 'line') parts.push(line(el.x, el.y, el.x + (el.direction === 'horizontal' ? el.w : 0), el.y + (el.direction === 'vertical' ? el.h : 0)));
    else if (el.kind === 'chart') parts.push(chartSvg(el));
    else if (el.kind === 'table') {
      let y = el.y;
      for (const [r, row] of [el.columns, ...el.rows].entries()) {
        let x = el.x;
        row.forEach((value, c) => { parts.push(rect(x, y, el.columnWidths[c], el.rowHeights[r], r === 0 ? theme.table.headerFill : theme.colors.background, theme.table.border), text(cellText(value), x + theme.table.cellPadding, y + theme.table.cellPadding, el.columnWidths[c] - 2 * theme.table.cellPadding, theme.typography.body, r === 0)); x += el.columnWidths[c]; });
        y += el.rowHeights[r];
      }
    } else {
      const map = mapGeometry(el); parts.push(rect(map.box.x, map.box.y, map.box.w, map.box.h, theme.colors.background, theme.table.border));
      for (const p of map.points) parts.push(`<circle cx="${px(p.x)}" cy="${px(p.y)}" r="5" fill="#${theme.colors.primary}"/>`, text(String(p.number), p.x + .08, p.y - .1, .5));
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 ${px(scene.width)} ${px(scene.height)}" role="img">${parts.join('')}</svg>`;
  if (Buffer.byteLength(svg) > 16 * 1024 * 1024) throw new Error('PITCH_SVG_LIMIT');
  return svg;
}
export async function renderScenePng(scene: SlideScene, theme: DesignTheme, media: SceneMedia[]) {
  const svg = await renderSceneSvg(scene, theme, media), { renderAsync } = await import('@resvg/resvg-js');
  const png = await renderAsync(svg, { fitTo: { mode: 'width', value: 2560 }, font: { loadSystemFonts: false } });
  return new Uint8Array(png.asPng());
}
