import { createOfficePresentation } from '@/src/lib/intelligence/query/officePresentation';
import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';
import { slideSceneSchema, type SlideScene } from '../contracts/scene';
import { designThemeSchema, type DesignTheme } from '../design/theme';
import type PptxGenJS from 'pptxgenjs';
import { chartScale, contain, mapGeometry } from './geometry';
import { cellText } from './format';
import { assertSceneQuality } from '../layout/quality';
import { inspectMedia, type SceneMedia } from './media';
export type { SceneMedia } from './media';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069\uFFFE\uFFFF]/g, ' ');
/** No URLs, file system paths, XML, scripts, callbacks or model-generated code.
 * Native text boxes remain editable; media bytes are already authorized/digested. */
export async function renderPitchPptx(title: string, pages: { scene: SlideScene; theme: DesignTheme }[], media: SceneMedia[]): Promise<Uint8Array> {
  if (!pages.length || pages.length > 50) throw new Error('PITCH_PAGE_LIMIT');
  const deck = await createOfficePresentation({ author: 'Colliers Pitch Studio', title: clean(title), subject: 'Pitch Studio', font: pages[0].theme.fonts.zh });
  const measured = pages.some(p => p.scene.rendererVersion) ? await inspectMedia(media) : [];
  for (const [i, page] of pages.entries()) {
    const scene = slideSceneSchema.parse(page.scene), theme = designThemeSchema.parse(page.theme);
    if (scene.themeId !== theme.id || scene.themeVersion !== theme.version) throw new Error('PITCH_THEME_MISMATCH');
    const slide = deck.addSlide(); slide.background = { color: theme.colors.background };
    if (scene.rendererVersion === 'pitch-scene/2') {
      await assertSceneQuality(scene, theme, measured);
      addNativeScene(slide, scene, theme, measured);
      continue;
    }
    for (const element of scene.elements) {
      const { x, y, w, h } = element;
      if (element.kind === 'text') slide.addText(clean(element.text), { x, y, w, h, margin: 0, valign: 'top',
        fontFace: /\p{Script=Han}/u.test(element.text) ? theme.fonts.zh : theme.fonts.en,
        fontSize: theme.typography[element.role], color: element.role === 'title' ? theme.colors.primary : theme.colors.text,
        bold: element.bold, breakLine: false, lang: 'zh-CN', lineSpacingMultiple: 1.15 });
      else if (element.kind === 'image') {
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
  if (bytes.length > 16 * 1024 * 1024) throw new Error('PITCH_EXPORT_LIMIT');
  return bytes;
}

function addNativeScene(slide: PptxGenJS.Slide, scene: SlideScene, theme: DesignTheme, media: Awaited<ReturnType<typeof inspectMedia>>) {
  for (const el of scene.elements) {
    const { x, y, w, h } = el;
    if (el.kind === 'text') slide.addText(el.text, { x, y, w, h, margin: 0, breakLine: false, valign: 'top', fit: 'none',
      fontFace: /\p{Script=Han}/u.test(el.text) ? theme.fonts.zh : theme.fonts.en, fontSize: theme.typography[el.role], bold: el.bold,
      color: el.purpose ? theme.colors.muted : el.role === 'title' ? theme.colors.primary : theme.colors.text,
      lineSpacingMultiple: 1.32, paraSpaceAfter: 0, lang: /\p{Script=Han}/u.test(el.text) ? 'zh-CN' : 'en-US' });
    else if (el.kind === 'image') {
      const image = media.find(m => m.id === el.mediaAssetId && m.version === el.mediaVersion)!;
      const data = image.mime + ';base64,' + Buffer.from(image.bytes).toString('base64');
      slide.addImage({ data, ...contain(el, image.width, image.height), altText: el.alt });
    } else if (el.kind === 'brand') {
      slide.addImage({ data: COLLIERS_LOGO_DATA_URI, ...contain(el, 400, 225) });
    } else if (el.kind === 'shape') slide.addShape(el.shape === 'arrow' ? 'chevron' : el.shape, { x, y, w, h, fill: { color: theme.colors[el.fill] }, line: { color: theme.colors[el.fill], transparency: 100 } });
    else if (el.kind === 'line') slide.addShape('line', { x, y, w: el.direction === 'horizontal' ? w : 0, h: el.direction === 'vertical' ? h : 0, line: { color: theme.table.border, width: 1, ...(el.arrow ? { endArrowType: 'triangle' as const } : {}) } });
    else if (el.kind === 'table') {
      // Rows are measured and paginated before Office; PptxGenJS must never
      // silently introduce pages or shrink fonts independently of preview.
      slide.addTable([el.columns, ...el.rows].map((row, i) => row.map(value => ({ text: cellText(value), options: { bold: i === 0, fill: { color: i === 0 ? theme.table.headerFill : theme.colors.background } } }))), {
        x, y, w, h, colW: el.columnWidths, rowH: el.rowHeights, autoPage: false,
        margin: theme.table.cellPadding * 72, fontFace: theme.fonts.zh, fontSize: theme.typography.body,
        color: theme.colors.text, border: { type: 'solid', color: theme.table.border, pt: .5 }, valign: 'top',
      });
    } else if (el.kind === 'chart') {
      const { min, max } = chartScale(el);
      const data = el.series.map(s => ({ name: `${s.name}${s.unit ? ` (${s.unit})` : ''}`, labels: el.categories, values: s.values as number[] }));
      const options: PptxGenJS.IChartOpts = { x, y, w, h, showTitle: el.chartType === 'pie', title: data[0].name, titleFontFace: theme.fonts.zh, titleFontSize: theme.typography.body, showLegend: true, legendPos: 't', legendFontSize: theme.typography.body,
        legendFontFace: theme.fonts.zh, catAxisLabelFontSize: theme.typography.body, catAxisLabelFontFace: theme.fonts.zh,
        valAxisLabelFontSize: theme.typography.body, valAxisLabelFontFace: theme.fonts.zh,
        chartColors: theme.chartColors, valAxisMinVal: min, valAxisMaxVal: max,
        showValue: false, showLabel: el.chartType === 'pie', displayBlanksAs: 'gap',
        dataLabelFontSize: theme.typography.body, dataLabelFontFace: theme.fonts.zh,
        showPercent: false, catAxisLabelColor: theme.colors.text, valAxisLabelColor: theme.colors.text,
        chartArea: { fill: { color: theme.colors.background }, border: { color: theme.colors.background, pt: 0 } },
        plotArea: { fill: { color: theme.colors.background }, border: { color: theme.colors.background, pt: 0 } },
        barDir: el.chartType === 'bar' ? 'bar' : 'col',
        valGridLine: { color: theme.table.border, size: .5 },
      };
      // PptxGenJS 4 runtime reads multi-chart options from argument 2; its
      // declaration still calls that argument data. Passing [] loses all options.
      if (el.chartType === 'combo') slide.addChart([{ type: 'bar', data: [data[0]], options: { barDir: 'col' } }, { type: 'line', data: [data[1]], options: {} }], options as unknown as PptxGenJS.OptsChartData[]);
      else slide.addChart(el.chartType === 'column' ? 'bar' : el.chartType, data, options);
    } else {
      const map = mapGeometry(el);
      slide.addShape('rect', { ...map.box, fill: { color: theme.colors.background }, line: { color: theme.table.border, width: .7 } });
      for (const p of map.points) {
        slide.addShape('ellipse', { x: p.x - .045, y: p.y - .045, w: .09, h: .09, fill: { color: theme.colors.primary }, line: { transparency: 100 } });
        slide.addText(String(p.number), { x: p.x + .08, y: p.y - .12, w: .5, h: .35, margin: 0, fontFace: theme.fonts.zh, fontSize: theme.typography.body, color: theme.colors.text });
      }
    }
  }
}
