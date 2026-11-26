import { slideSceneSchema, type SlideScene } from '../contracts/scene';
import type { DesignTheme } from '../design/theme';
import { lineHeight, sceneFont, wrapText, LayoutError } from './metrics';
export type MediaSize = { id: string; version: number; width: number; height: number };
export type QualityIssue = { code: string; element: number; message: string; severity: 'error' | 'warning' };
export async function checkScene(raw: SlideScene, theme: DesignTheme, media: MediaSize[] = []): Promise<QualityIssue[]> {
  const issues: QualityIssue[] = [], add = (code: string, element: number, message: string, severity: 'error' | 'warning' = 'error') => issues.push({ code, element, message, severity });
  if (!slideSceneSchema.safeParse(raw).success) { add('SCENE_SCHEMA', -1, '页面结构或元素坐标不合法。'); return issues; }
  const font = await sceneFont();
  if (raw.themeId !== theme.id || raw.themeVersion !== theme.version) add('THEME_MISMATCH', -1, '主题版本不一致。');
  if (theme.typography.body < 16 || theme.typography.title < 24) add('FONT_TOO_SMALL', -1, '字号低于可读阈值。');
  if (!['Noto Sans SC'].includes(theme.fonts.zh) || !['Noto Sans SC'].includes(theme.fonts.en)) add('FONT_FALLBACK', -1, '预览以捆绑 Noto Sans SC 度量；Office 使用主题字体，可能存在字体替代。', 'warning');
  const visible = raw.elements.filter(e => e.kind !== 'brand' && !(e.kind === 'text' && e.purpose));
  if (!visible.length) add('EMPTY_PAGE', -1, '页面没有业务内容。');
  for (const [i, el] of raw.elements.entries()) {
    if (el.kind === 'text') {
      try { if (wrapText(el.text, el.w, theme.typography[el.role], font).length * lineHeight(theme.typography[el.role]) > el.h + .02) add(el.role === 'title' ? 'TITLE_OVERFLOW' : 'TEXT_OVERFLOW', i, '文字无法在固定字号下完整显示。'); }
      catch (e) { add(e instanceof LayoutError ? e.code : 'TEXT_INVALID', i, '文字存在乱码、缺字或无法换行。'); }
    }
    if (el.kind === 'image') {
      const file = media.find(m => m.id === el.mediaAssetId && m.version === el.mediaVersion);
      if (!file) add('IMAGE_MISSING', i, '获权图片缺失。');
      else if (file.width / el.w < 100 && file.height / el.h < 100) add('IMAGE_RESOLUTION', i, '图片低于 100 dpi，请使用高分辨率原图。');
      if (raw.rendererVersion && !el.fit) add('IMAGE_DISTORTION', i, '图片必须声明等比适配。');
    }
    if (el.kind === 'table') {
      if (el.rows.length > 10) add('TABLE_ROWS', i, '表格行数超限，必须分页。');
      if (Math.abs(el.columnWidths.reduce((a, b) => a + b, 0) - el.w) > .01 || Math.abs(el.rowHeights.reduce((a, b) => a + b, 0) - el.h) > .01) add('TABLE_GEOMETRY', i, '表格尺寸与行列尺寸不一致。');
    }
    if (el.kind === 'chart' && (el.categories.length > 12 || el.series.length > 4)) add('CHART_LABEL_DENSITY', i, '图表标签或系列过密。');
    for (let j = 0; j < i; j++) {
      const other = raw.elements[j];
      if (el.kind === 'line' || other.kind === 'line' || el.kind === 'shape' && el.background || other.kind === 'shape' && other.background) continue;
      const dx = Math.min(el.x + el.w, other.x + other.w) - Math.max(el.x, other.x), dy = Math.min(el.y + el.h, other.y + other.h) - Math.max(el.y, other.y);
      if (dx > .025 && dy > .025) add(other.kind === 'text' && other.purpose ? 'FOOTER_OBSCURED' : 'ELEMENT_OVERLAP', i, `元素与第 ${j + 1} 个元素重叠。`);
    }
  }
  return issues;
}
export async function assertSceneQuality(scene: SlideScene, theme: DesignTheme, media: MediaSize[]) {
  const issues = await checkScene(scene, theme, media), errors = issues.filter(i => i.severity === 'error');
  if (errors.length) throw new LayoutError('PITCH_LAYOUT_QUALITY', errors.map(i => i.message).join('；'));
  return issues;
}
