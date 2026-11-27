import { slideSceneSchema, type SceneElement, type SlideScene } from '../contracts/scene';
import { visualBounds } from '../contracts/scene-geometry';
import { chartTextSize, textColor, textSize, type DesignTheme } from '../design/theme';
import { chartPlot, chartScale, cover, scatterXScale } from '../render/geometry';
import { lineHeight, sceneFont, wrapText, LayoutError } from './metrics';
export type MediaSize = { id: string; version: number; width: number; height: number };
export type QualityIssue = { code: string; element: number; message: string; severity: 'error' | 'warning' };
const overlapsIntentionally = (element: SlideScene['elements'][number]) =>
  (element.kind === 'image' || (element.kind === 'shape' && !element.background)) && element.allowOverlap === true;
export async function checkScene(raw: SlideScene, theme: DesignTheme, media: MediaSize[] = []): Promise<QualityIssue[]> {
  const issues: QualityIssue[] = [], add = (code: string, element: number, message: string, severity: 'error' | 'warning' = 'error') => issues.push({ code, element, message, severity });
  if (!slideSceneSchema.safeParse(raw).success) { add('SCENE_SCHEMA', -1, '页面结构或元素坐标不合法。'); return issues; }
  const font = await sceneFont();
  if (raw.themeId !== theme.id || raw.themeVersion !== theme.version) add('THEME_MISMATCH', -1, '主题版本不一致。');
  if (theme.typography.body < 16 || theme.typography.title < 24) add('FONT_TOO_SMALL', -1, '字号低于可读阈值。');
  if (!['Noto Sans SC'].includes(theme.fonts.zh) || !['Noto Sans SC'].includes(theme.fonts.en)) add('FONT_FALLBACK', -1, '预览以捆绑 Noto Sans SC 度量；Office 使用主题字体，可能存在字体替代。', 'warning');
  const visible = raw.elements.filter(e => e.kind !== 'brand' && !(e.kind === 'text' && e.purpose) && !(e.kind === 'shape' && e.background));
  if (!visible.length) add('EMPTY_PAGE', -1, '页面没有业务内容。');
  const visualBoxes = raw.elements.map(visualBounds);
  for (const [i, el] of raw.elements.entries()) {
    if (el.kind === 'text') {
      const size = textSize(theme, el.role, el.semantic);
      try { if (wrapText(el.text, el.w, size, font).length * lineHeight(size) > el.h + .02) add(el.role === 'title' ? 'TITLE_OVERFLOW' : 'TEXT_OVERFLOW', i, '文字无法在固定字号下完整显示。'); }
      catch (e) { add(e instanceof LayoutError ? e.code : 'TEXT_INVALID', i, '文字存在乱码、缺字或无法换行。'); }
    }
    if (el.kind === 'image') {
      const file = media.find(m => m.id === el.mediaAssetId && m.version === el.mediaVersion);
      if (!file) add('IMAGE_MISSING', i, '获权图片缺失。');
      else if (file.width / el.w < 100 && file.height / el.h < 100) add('IMAGE_RESOLUTION', i, '图片低于 100 dpi，请使用高分辨率原图。');
      if (file && el.fit === 'cover') {
        const crop = cover(el, file.width, file.height, el.focus);
        if (crop.dpi < 100 && !issues.some(issue => issue.element === i && issue.code === 'IMAGE_RESOLUTION')) add('IMAGE_RESOLUTION', i, '裁剪后图片低于 100 dpi，请使用高分辨率原图。');
        if (crop.retained < .40) add('IMAGE_CROP', i, '构图裁掉超过六成原图，需核查建筑主体。', 'warning');
      }
      if (raw.rendererVersion && !el.fit) add('IMAGE_DISTORTION', i, '图片必须声明等比适配。');
    }
    if (el.kind === 'table') {
      if (el.rows.length > 10) add('TABLE_ROWS', i, '表格行数超限，必须分页。');
      if (Math.abs(el.columnWidths.reduce((a, b) => a + b, 0) - el.w) > .01 || Math.abs(el.rowHeights.reduce((a, b) => a + b, 0) - el.h) > .01) add('TABLE_GEOMETRY', i, '表格尺寸与行列尺寸不一致。');
    }
    if (el.kind === 'chart' && (el.categories.length > 12 || el.series.length > 4)) add('CHART_LABEL_DENSITY', i, '图表标签或系列过密。');
    const bounds = visualBoxes[i];
    for (let j = 0; j < i; j++) {
      const other = raw.elements[j];
      if (el.kind === 'line' || other.kind === 'line' || el.kind === 'shape' && el.background || other.kind === 'shape' && other.background) continue;
      if (overlapsIntentionally(el) && overlapsIntentionally(other)) continue;
      if (other.kind === 'image' && other.bleed && raw.elements.slice(j + 1, i).some(panel => panel.kind === 'shape' &&
        panel.background && panel.fill === 'background' && (panel.opacity ?? 1) === 1 &&
        panel.x <= bounds.x && panel.y <= bounds.y && panel.x + panel.w >= bounds.x + bounds.w && panel.y + panel.h >= bounds.y + bounds.h)) continue;
      const neighbor = visualBoxes[j];
      const dx = Math.min(bounds.x + bounds.w, neighbor.x + neighbor.w) - Math.max(bounds.x, neighbor.x),
        dy = Math.min(bounds.y + bounds.h, neighbor.y + neighbor.h) - Math.max(bounds.y, neighbor.y);
      if (dx > .025 && dy > .025) add(other.kind === 'text' && other.purpose ? 'FOOTER_OBSCURED' : 'ELEMENT_OVERLAP', i, `元素与第 ${j + 1} 个元素重叠。`);
    }
  }
  if (theme.profile) {
    const active = visible.filter(e => e.kind !== 'line');
    const data = active.filter(e => e.kind === 'image' || e.kind === 'chart' || e.kind === 'table' || e.kind === 'map');
    const contentText = active.filter((e): e is Extract<SceneElement, { kind: 'text' }> => e.kind === 'text' && e.semantic !== 'caption');
    const area = active.reduce((sum, e) => sum + e.w * e.h, 0);
    if (area < raw.width * raw.height * .22 && !['section-statement', 'text-cover'].includes(raw.composition ?? '')) add('EXCESS_WHITESPACE', -1, '内容集中在不足四分之一的画幅，请核查留白是否有目的。', 'warning');
    if (active.length > 25 || contentText.reduce((sum, e) => sum + e.text.replace(/\s/g, '').length, 0) > 1050) add('CONTENT_DENSITY', -1, '可见信息偏密，建议按结论和证据拆页。', 'warning');
    if (data.length > 2 && !data.some(e => e.w * e.h >= Math.max(...data.map(other => other === e ? 0 : other.w * other.h)) * 1.35) && raw.composition !== 'photo-matrix') add('WEAK_FOCAL_POINT', -1, '多个同等大小的主图竞争注意力。', 'warning');
    if (new Set(contentText.map(e => e.x.toFixed(1))).size > 3 && raw.composition !== 'photo-matrix') add('REPEATED_COLUMNS', -1, '文字主轴过多，请检查阅读顺序。', 'warning');
    if (contentText.some(e => e.semantic === 'conclusion' && textSize(theme, e.role, e.semantic) < theme.typography.body * 1.4)) add('WEAK_HIERARCHY', -1, '结论标题与正文的视觉层级接近。', 'warning');
    for (const [i, e] of raw.elements.entries()) {
      if (e.kind === 'text' && contrast(textColor(theme, e), theme.colors.background) < 4.5) add('TEXT_CONTRAST', i, '文字颜色与背景的对比度不足。', 'warning');
      if (e.kind === 'table' && (e.columns.length > 5 && e.rows.length > 6 || e.rowHeights.some(h => h > .85))) add('TABLE_READING_LOAD', i, '多列或多行说明增加表格阅读负担。', 'warning');
      if (e.kind === 'chart' && (e.categories.length > 9 || e.xAxis && scatterLabelCrowded(e, theme))) add('CHART_LABEL_CROWDING', i, '图表标签可能拥挤，需检查实际渲染。', 'warning');
    }
  }
  return issues;
}
export async function assertSceneQuality(scene: SlideScene, theme: DesignTheme, media: MediaSize[]) {
  const issues = await checkScene(scene, theme, media), errors = issues.filter(i => i.severity === 'error');
  if (errors.length) throw new LayoutError('PITCH_LAYOUT_QUALITY', errors.map(i => i.message).join('；'));
  return issues;
}

function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => hex.match(/../g)!.map(c => parseInt(c, 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((total, c, i) => total + c * [.2126, .7152, .0722][i], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function scatterLabelCrowded(chart: Extract<SlideScene['elements'][number], { kind: 'chart' }>, theme: DesignTheme) {
  const x = scatterXScale(chart), y = chartScale(chart), plot = chartPlot(chart, theme);
  const points = chart.series.flatMap(series => series.values.flatMap((value, i) => {
    const xv = chart.xAxis!.values[i];
    return xv === null || value === null ? [] : [{ x: (xv - x.min) / (x.max - x.min) * plot.w, y: (value - y.min) / (y.max - y.min) * plot.h }];
  }));
  return points.some((p, i) => points.slice(i + 1).some(q => Math.abs(p.x - q.x) < 1.2 && Math.abs(p.y - q.y) < lineHeight(chartTextSize(theme))));
}

export function checkDeckDesign(scenes: SlideScene[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  let consecutive = 1;
  const signature = (scene: SlideScene) => scene.composition ?? scene.layoutId;
  for (const [i, scene] of scenes.entries()) {
    if (!scene.designVersion || i === 0) continue;
    const previous = scenes[i - 1];
    if (scene.themeId !== previous.themeId || scene.themeVersion !== previous.themeVersion) {
      issues.push({ code: 'DECK_THEME_INCONSISTENCY', element: i, message: '相邻页面使用不同主题或版本。', severity: 'warning' });
    }
    if ((scene.pagination?.index ?? 0) > 0) continue;
    consecutive = signature(scene) === signature(previous) ? consecutive + 1 : 1;
    if (consecutive === 4) issues.push({ code: 'DECK_COMPOSITION_REPEAT', element: i, message: '连续四页使用相同构图，请核查证据组织。', severity: 'warning' });
  }
  return issues;
}
