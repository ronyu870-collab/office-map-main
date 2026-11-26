import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';
import { slideSceneSchema, type SlideScene, type SceneElement } from '../contracts/scene';
import { chartTextSize, DESIGN_PROFILES, designThemeSchema, textColor, textSize, type DesignTheme } from '../design/theme';
import { sceneFont, textWidth, wrapText, lineHeight } from '../layout/metrics';
import { assertSceneQuality } from '../layout/quality';
import { chartColor, chartPlot, chartScale, cover, mapGeometry, scatterXScale, seriesLabel } from './geometry';
import { tableCellAlignment, tableCellFill } from '../design/table';
import { cellText } from './format';
import { objectId, objectRotation } from '../workspace/object-layout';
import { inspectMedia, type SceneMedia } from './media';
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const px = (n: number) => n * 96;

/** Fixed SVG serializer; no caller SVG, URLs, HTML, metadata or hidden data.
 * Glyph outlines use the same bundled metrics as layout, avoiding browser SVG
 * font-loading races. Office retains native text with the declared font. */
export async function renderSceneSvg(raw: SlideScene, rawTheme: DesignTheme, rawMedia: SceneMedia[], editorLayers = false) {
  const scene = slideSceneSchema.parse(raw), theme = designThemeSchema.parse(rawTheme), media = await inspectMedia(rawMedia), font = await sceneFont();
  await assertSceneQuality(scene, theme, media);
  const parts: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => `<rect x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}" fill="#${fill}"${stroke ? ` stroke="#${stroke}"` : ''}/>`;
  const text = (value: string, x: number, y: number, w: number, size = theme.typography.body, bold = false, color = theme.colors.text, align: 'left' | 'center' | 'right' = 'left') => {
    const lines = wrapText(value, w, size, font), scale = size / 72 * 96 / font.unitsPerEm;
    const fragments = lines.map((line, index) => {
      const run = font.layout(line);
      const delta = align === 'left' ? 0 : (w - textWidth(line, size, font)) * (align === 'center' ? .5 : 1);
      let dx = 0;
      return run.glyphs.map((g, i) => { const p = run.positions[i], at = dx; dx += p.xAdvance;
        return `<path d="${g.path.toSVG()}" transform="translate(${px(x + delta) + (at + p.xOffset) * scale} ${px(y) + size / 72 * 96 * 1.03 + index * px(lineHeight(size)) - p.yOffset * scale}) scale(${scale} ${-scale})"${bold ? ' stroke="currentColor" stroke-width="18"' : ''}/>`;
      }).join('');
    }).join('');
    return `<g fill="#${color}" color="#${color}" role="img" aria-label="${xml(value)}"><title>${xml(value)}</title>${fragments}</g>`;
  };
  const line = (x: number, y: number, x2: number, y2: number, color = theme.table.border, width = 1.3, dashed = false) =>
    `<line x1="${px(x)}" y1="${px(y)}" x2="${px(x2)}" y2="${px(y2)}" stroke="#${color}" stroke-width="${width}"${dashed ? ' stroke-dasharray="5 4"' : ''}/>`;
  const circle = (x: number, y: number, radius: number, color: string) =>
    `<circle cx="${px(x)}" cy="${px(y)}" r="${radius}" fill="#${color}"/>`;
  const chartSvg = (el: Extract<SceneElement, { kind: 'chart' }>) => {
    let svg = '';
    const { min, max, step } = chartScale(el), { x, y, w, h } = chartPlot(el, theme);
    const size = chartTextSize(theme), rules = theme.profile ? DESIGN_PROFILES[theme.profile].chart : undefined;
    const sx = (v: number) => x + (v - min) / (max - min) * w;
    const sy = (v: number) => y + h - (v - min) / (max - min) * h;
    const horizontal = el.chartType === 'bar', stacked = el.chartType === 'stacked-column';
    let legendX = el.x;
    for (const [i, series] of el.series.entries()) {
      const label = seriesLabel(series), labelWidth = textWidth(label, size, font) + .08;
      if (!el.xAxis || el.series.length > 1) {
        const color = chartColor(el, theme, i), benchmark = el.emphasis?.kind === 'benchmark' && i === 1;
        const sample = benchmark ? line(legendX, el.y + .12, legendX + .18, el.y + .12, color, 1.6, true)
          : rect(legendX, el.y + .075, .11, .11, color);
        svg += sample + text(label, legendX + .23, el.y, labelWidth, size);
        legendX += labelWidth + .48;
      } else svg += text(label, el.x, el.y, el.w, size);
    }
    if (el.chartType === 'pie') {
      const values = el.series[0].values as number[], total = values.reduce((a, b) => a + b, 0);
      const cx = x + w * .32, cy = y + h / 2, r = Math.min(w * .3, h / 2);
      let angle = -Math.PI / 2;
      values.forEach((v, i) => {
        const delta = v / total * Math.PI * 2, next = angle + delta, color = chartColor(el, theme, i);
        if (delta >= Math.PI * 2 - 1e-9) svg += circle(cx, cy, px(r), color);
        else if (v > 0) svg += `<path d="M${px(cx)} ${px(cy)} L${px(cx + r * Math.cos(angle))} ${px(cy + r * Math.sin(angle))} A${px(r)} ${px(r)} 0 ${delta > Math.PI ? 1 : 0} 1 ${px(cx + r * Math.cos(next))} ${px(cy + r * Math.sin(next))}Z" fill="#${color}"/>`;
        svg += text(`${el.categories[i]}: ${cellText(v)}`, x + w * .67, y + i * .4, w * .33, size);
        angle = next;
      });
      return svg;
    }
    const grid = rules?.grid ?? theme.table.border, axis = theme.colors.secondary, ink = theme.colors.text;
    const tick = (v: number) => cellText(Number(v.toPrecision(12)));
    const ticks = (start: number, end: number, increment: number) =>
      Array.from({ length: Math.min(12, Math.round((end - start) / increment)) + 1 }, (_, i) => start + increment * i);
    const hs = lineHeight(size) / 2;
    for (const v of ticks(min, max, step)) {
      if (horizontal) svg += line(sx(v), y, sx(v), y + h, v === 0 ? axis : grid, 1) +
        text(tick(v), sx(v) - .41, y + h + .12, .82, size, false, ink, 'center');
      else svg += line(x, sy(v), x + w, sy(v), v === 0 ? axis : grid, 1) +
        text(tick(v), el.x, Math.max(el.y, sy(v) - hs), x - el.x - .13, size, false, ink, 'right');
    }
    if (el.xAxis) {
      const limits = scatterXScale(el), mapX = (v: number) => x + (v - limits.min) * w / (limits.max - limits.min);
      for (const v of ticks(limits.min, limits.max, limits.step)) {
        svg += line(mapX(v), y, mapX(v), y + h, grid, 1) + text(tick(v), mapX(v) - .40, y + h + .09, .80, size, false, ink, 'center');
      }
      svg += text(seriesLabel({ name: el.xAxis.label, unit: el.xAxis.unit }), x, y + h + .37, w, size, false, ink, 'center');
      const values = el.xAxis.values;
      for (const [si, series] of el.series.entries()) series.values.forEach((v, i) => {
        const xv = values[i];
        if (v === null || xv === null) return;
        const color = chartColor(el, theme, si, i), cx = mapX(xv), cy = sy(v);
        const focus = el.emphasis?.kind === 'target' && el.emphasis.category === i;
        const labelW = Math.min(2.2, w * .47);
        const labelX = Math.max(x, Math.min(cx - labelW / 2, x + w - labelW));
        svg += `<g aria-label="${xml(el.categories[i])}">` + circle(cx, cy, focus ? 6.5 : 4.5, color) +
          text(el.categories[i], labelX, Math.max(el.y + .26, cy - .29), labelW, size, focus, ink, 'center') + '</g>';
      });
      return svg;
    }
    const n = el.categories.length, barShare = 100 / (100 + (rules?.gap ?? 60));
    const positive = Array<number>(n).fill(0), negative = Array<number>(n).fill(0);
    el.categories.forEach((c, i) => {
      svg += horizontal ? text(c, el.x, y + h * (i + .5) / n - hs, x - el.x - .1, size, false, ink, 'right')
        : text(c, x + w * i / n, y + h + .11, w / n, size, false, ink, 'center');
    });
    el.series.forEach((series, si) => {
      let previous: [number, number] | undefined;
      series.values.forEach((v, i) => {
        if (v === null) { previous = undefined; return; }
        const color = chartColor(el, theme, si, i);
        if (el.chartType === 'line' || el.chartType === 'combo' && si === 1) {
          const point: [number, number] = [x + w * (i + .5) / n, sy(v)];
          const benchmark = el.emphasis?.kind === 'benchmark';
          if (previous) svg += line(previous[0], previous[1], point[0], point[1], color, rules?.line ?? 1.3, benchmark);
          if (!benchmark && (!rules || rules.markers || !previous && (series.values[i + 1] ?? null) === null)) svg += circle(point[0], point[1], 3, color);
          previous = point;
        } else if (horizontal) {
          const bh = h / n * barShare / el.series.length, yy = y + h * (i + (1 - barShare) / 2) / n + si * bh;
          if (v !== 0) svg += rect(Math.min(sx(0), sx(v)), yy, Math.abs(sx(v) - sx(0)), bh, color);
        } else {
          const count = el.chartType === 'combo' || stacked ? 1 : el.series.length;
          const bw = w / n * barShare / count, xx = x + w * (i + (1 - barShare) / 2) / n + (stacked ? 0 : si * bw);
          const totals = v < 0 ? negative : positive, base = stacked ? totals[i] : 0;
          if (stacked) totals[i] += v;
          if (v !== 0) svg += rect(xx, Math.min(sy(base), sy(base + v)), bw, Math.abs(sy(base + v) - sy(base)), color);
        }
      });
    });
    return svg;
  };
  parts.push(rect(0, 0, scene.width, scene.height, theme.colors.background));
  for (const [index, el] of scene.elements.entries()) {
    const rotation = objectRotation(el);
    if (editorLayers) parts.push(`<g data-pitch-object="${objectId(el, index)}">`);
    if (rotation) parts.push(`<g transform="rotate(${rotation} ${px(el.x + el.w / 2)} ${px(el.y + el.h / 2)})">`);
    if (el.kind === 'text') parts.push(text(el.text, el.x, el.y, el.w, textSize(theme, el.role, el.semantic), el.bold, textColor(theme, el), el.align));
    else if (el.kind === 'image') {
      const image = media.find(m => m.id === el.mediaAssetId && m.version === el.mediaVersion)!;
      const data = `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}`;
      if (el.fit === 'cover') {
        const crop = cover(el, image.width, image.height, el.focus);
        parts.push(`<svg x="${px(el.x)}" y="${px(el.y)}" width="${px(el.w)}" height="${px(el.h)}" overflow="hidden">`,
          `<image x="${px(-crop.x)}" y="${px(-crop.y)}" width="${px(crop.w)}" height="${px(crop.h)}" href="${data}"><title>${xml(el.alt)}</title></image></svg>`);
      } else parts.push(`<image x="${px(el.x)}" y="${px(el.y)}" width="${px(el.w)}" height="${px(el.h)}" preserveAspectRatio="xMidYMid meet" href="${data}"><title>${xml(el.alt)}</title></image>`);
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
        row.forEach((value, c) => {
          const w = el.columnWidths[c], h = el.rowHeights[r], padding = theme.table.cellPadding;
          const ledger = theme.profile && DESIGN_PROFILES[theme.profile].table === 'ledger';
          parts.push(rect(x, y, w, h, tableCellFill(el, theme, r, c), ledger ? undefined : theme.table.border));
          if (ledger) parts.push(line(x, y + h, x + w, y + h, theme.table.border, .8));
          parts.push(text(cellText(value), x + padding, y + padding, w - 2 * padding, theme.typography.body, r === 0, theme.colors.text, tableCellAlignment(el, theme, c)));
          x += w;
        });
        y += el.rowHeights[r];
      }
    } else {
      const map = mapGeometry(el); parts.push(rect(map.box.x, map.box.y, map.box.w, map.box.h, theme.colors.background, theme.table.border));
      for (const p of map.points) parts.push(`<circle cx="${px(p.x)}" cy="${px(p.y)}" r="5" fill="#${theme.colors.primary}"/>`, text(String(p.number), p.x + .08, p.y - .1, .5));
    }
    if (rotation) parts.push('</g>');
    if (editorLayers) parts.push('</g>');
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
