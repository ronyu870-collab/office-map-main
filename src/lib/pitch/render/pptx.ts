import { createOfficePresentation } from '@/src/lib/intelligence/query/officePresentation';
import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';
import { slideSceneSchema, type SlideScene } from '../contracts/scene';
import { chartTextSize, DESIGN_PROFILES, designThemeSchema, textColor, textSize, type DesignTheme } from '../design/theme';
import type PptxGenJS from 'pptxgenjs';
import { createPitchPicturePackage } from '../data/pptx-package';
import { chartColor, chartScale, contain, cover, mapGeometry, scatterXScale, seriesLabel } from './geometry';
import { tableCellAlignment, tableCellFill } from '../design/table';
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
  const pictures = createPitchPicturePackage();
  const measured = pages.some(p => p.scene.rendererVersion) ? await inspectMedia(media) : [];
  for (const [i, page] of pages.entries()) {
    const scene = slideSceneSchema.parse(page.scene), theme = designThemeSchema.parse(page.theme);
    if (scene.themeId !== theme.id || scene.themeVersion !== theme.version) throw new Error('PITCH_THEME_MISMATCH');
    const slide = deck.addSlide(); slide.background = { color: theme.colors.background };
    if (scene.rendererVersion === 'pitch-scene/2') {
      await assertSceneQuality(scene, theme, measured);
      addNativeScene(slide, scene, theme, measured, pictures.imageData);
      pictures.reuseParts(slide);
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
        slide.addImage({ data: pictures.imageData(image), x, y, w, h, altText: clean(element.alt) });
      }
    }
    if (theme.logo.enabled) slide.addImage({ data: COLLIERS_LOGO_DATA_URI, x: theme.width - theme.margin - 1, y: theme.margin, w: 1, h: .562 });
    if (theme.footer.enabled) slide.addText(clean(theme.footer.label + (theme.footer.pageNumber ? ` · ${i + 1}` : '')), {
      x: theme.margin, y: 6.85, w: theme.width - 2 * theme.margin, h: .35, margin: 0,
      fontSize: theme.typography.body, fontFace: theme.fonts.zh, color: theme.colors.muted,
    });
    pictures.reuseParts(slide);
  }
  const bytes = new Uint8Array(await deck.write({ outputType: 'uint8array', compression: true }) as Uint8Array);
  if (bytes.length > 16 * 1024 * 1024) throw new Error('PITCH_EXPORT_LIMIT');
  return bytes;
}

function addNativeScene(slide: PptxGenJS.Slide, scene: SlideScene, theme: DesignTheme, media: Awaited<ReturnType<typeof inspectMedia>>, imageData: (image: SceneMedia) => string) {
  for (const el of scene.elements) {
    const { x, y, w, h } = el;
    if (el.kind === 'text') slide.addText(el.text, { x, y, w, h, margin: 0, breakLine: false, valign: 'top', fit: 'none',
      fontFace: /\p{Script=Han}/u.test(el.text) ? theme.fonts.zh : theme.fonts.en, fontSize: textSize(theme, el.role, el.semantic), bold: el.bold,
      color: textColor(theme, el), align: el.align, ...(el.semantic === 'cover' ? { wrap: false } : {}),
      lineSpacingMultiple: 1.32, paraSpaceAfter: 0, lang: /\p{Script=Han}/u.test(el.text) ? 'zh-CN' : 'en-US' });
    else if (el.kind === 'image') {
      const image = media.find(m => m.id === el.mediaAssetId && m.version === el.mediaVersion)!;
      const data = imageData(image);
      const picture = { data, altText: clean(el.alt), rotate: el.rotation ?? 0 };
      if (el.fit === 'cover') {
        const crop = cover(el, image.width, image.height, el.focus);
        slide.addImage({ ...picture, x, y, w: crop.w, h: crop.h,
          sizing: { type: 'crop', w, h, x: crop.x, y: crop.y } });
      } else slide.addImage({ ...picture, ...contain(el, image.width, image.height) });
    } else if (el.kind === 'brand') {
      slide.addImage({ data: COLLIERS_LOGO_DATA_URI, ...contain(el, 400, 225) });
    } else if (el.kind === 'shape') slide.addShape(el.shape === 'arrow' ? 'chevron' : el.shape, { x, y, w, h, rotate: el.rotation ?? 0, fill: { color: theme.colors[el.fill], transparency: Math.round((1-(el.opacity??1))*100) }, line: { color: theme.colors[el.fill], transparency: 100 } });
    else if (el.kind === 'line') slide.addShape('line', { x, y, w: el.direction === 'horizontal' ? w : 0, h: el.direction === 'vertical' ? h : 0, line: { color: theme.table.border, width: 1, ...(el.arrow ? { endArrowType: 'triangle' as const } : {}) } });
    else if (el.kind === 'table') {
      // Rows are measured and paginated before Office; PptxGenJS must never
      // silently introduce pages or shrink fonts independently of preview.
      slide.addTable([el.columns, ...el.rows].map((row, i) => row.map((value, column) => ({ text: cellText(value), options: { bold: i === 0,
        align: tableCellAlignment(el, theme, column),
        fill: { color: tableCellFill(el, theme, i, column) } } }))), {
        x, y, w, h, colW: el.columnWidths, rowH: el.rowHeights, autoPage: false,
        margin: theme.table.cellPadding * 72, fontFace: theme.fonts.zh, fontSize: theme.typography.body,
        color: theme.colors.text, border: theme.profile && DESIGN_PROFILES[theme.profile].table === 'ledger'
          ? [{ type: 'none' }, { type: 'none' }, { type: 'solid', color: theme.table.border, pt: .5 }, { type: 'none' }]
          : { type: 'solid', color: theme.table.border, pt: .5 }, valign: 'top',
      });
    } else if (el.kind === 'chart') {
      addNativeChart(slide, el, theme);
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

function addNativeChart(slide: PptxGenJS.Slide, el: Extract<SlideScene['elements'][number], { kind: 'chart' }>, theme: DesignTheme) {
  const { x, y, w, h, chartType, xAxis, emphasis } = el;
  const { min, max, step } = chartScale(el);
  const rules = theme.profile ? DESIGN_PROFILES[theme.profile].chart : undefined;
  const size = chartTextSize(theme), scatter = Boolean(xAxis);
  const target = emphasis?.kind === 'target' ? emphasis.category : undefined;
  const names = el.categories.map(clean);
  const data = el.series.map(s => ({ name: clean(seriesLabel(s)), labels: names, values: s.values as number[] }));
  const options: PptxGenJS.IChartOpts = {
    x, y, w, h, showTitle: chartType === 'pie', title: data[0].name, titleFontFace: theme.fonts.zh, titleFontSize: size,
    showLegend: !scatter || data.length > 1, legendPos: 't', legendFontSize: size, legendFontFace: theme.fonts.zh,
    catAxisLabelFontSize: size, catAxisLabelFontFace: theme.fonts.zh,
    valAxisLabelFontSize: size, valAxisLabelFontFace: theme.fonts.zh,
    chartColors: !scatter && (target !== undefined || rules && data.length === 1 && ['bar', 'column'].includes(chartType))
      ? names.map((_, i) => chartColor(el, theme, 0, i))
      : theme.chartColors,
    valAxisMinVal: min, valAxisMaxVal: max, ...(rules || scatter ? { valAxisMajorUnit: step } : {}),
    showValue: false, showLabel: chartType === 'pie', displayBlanksAs: 'gap',
    dataLabelFontSize: size, dataLabelFontFace: theme.fonts.zh,
    showPercent: false, catAxisLabelColor: theme.colors.text, valAxisLabelColor: theme.colors.text,
    chartArea: { fill: { color: theme.colors.background }, border: { color: theme.colors.background, pt: 0 } },
    plotArea: { fill: { color: theme.colors.background }, border: { color: theme.colors.background, pt: 0 } },
    barDir: chartType === 'bar' ? 'bar' : 'col', barGrouping: chartType === 'stacked-column' ? 'stacked' : 'clustered',
    valGridLine: { color: rules?.grid ?? theme.table.border, size: .5 },
    ...(rules ? { lineSize: rules.line, lineDataSymbol: rules.markers ? 'circle' : 'none', gapWidthPct: rules.gap } : {}),
  };
  if (xAxis) {
    const limits = scatterXScale(el), yTitle = el.series.length === 1 ? data[0].name : el.series[0].unit;
    const kept = xAxis.values.map((value, i) => value !== null && el.series.some(s => s.values[i] !== null) ? i : -1).filter(i => i >= 0);
    const label = clean(seriesLabel({ name: xAxis.label, unit: xAxis.unit }));
    const points = data.map(s => ({
      ...s,
      labels: [kept.map(i => s.values[i] === null ? '' : names[i])],
      values: kept.map(i => s.values[i]),
    }));
    const plotted = target === undefined ? points : [
      { name: points[0].name, labels: [kept.map(i => i === target ? '' : names[i])], values: kept.map(i => i === target ? null! : data[0].values[i]) },
      { name: names[target], labels: [kept.map(i => i === target ? names[i] : '')], values: kept.map(i => i === target ? data[0].values[i] : null!) },
    ];
    slide.addChart('scatter', [
      { name: label, labels: names, values: kept.map(i => xAxis.values[i]!) },
      ...plotted,
    ], {
      ...options, chartColors: target === undefined ? theme.chartColors : [theme.colors.secondary, theme.chartColors[0]],
      lineSize: 0, lineDataSymbol: 'circle', lineDataSymbolSize: 6,
      showLabel: true, dataLabelFormatScatter: 'custom', dataLabelPosition: 't',
      catAxisMinVal: limits.min, catAxisMaxVal: limits.max,
      showCatAxisTitle: true, catAxisTitle: label, catAxisTitleFontFace: theme.fonts.zh, catAxisTitleFontSize: size,
      showValAxisTitle: Boolean(yTitle), valAxisTitle: yTitle, valAxisTitleFontFace: theme.fonts.zh, valAxisTitleFontSize: size,
    });
  } else if (chartType === 'combo') {
    // PptxGenJS 4 reads multi-chart options from argument 2.
    slide.addChart([
      { type: 'bar', data: [data[0]], options: { barDir: 'col', ...(rules ? { chartColors: [theme.chartColors[0]] } : {}) } },
      { type: 'line', data: [data[1]], options: emphasis?.kind === 'benchmark'
        ? { lineDash: 'dash', lineDataSymbol: 'none', chartColors: [theme.chartColors[1]] } : {} },
    ], options as unknown as PptxGenJS.OptsChartData[]);
  } else if (chartType !== 'scatter') {
    slide.addChart(chartType === 'column' || chartType === 'stacked-column' ? 'bar' : chartType, data, options);
  }
}
