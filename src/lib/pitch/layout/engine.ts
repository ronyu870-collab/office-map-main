import { slideContentSchema, type SlideContent } from '../contracts/content';
import { layoutIdSchema, slideSceneSchema, type LayoutId, type SceneElement, type SlideScene } from '../contracts/scene';
import { designThemeSchema, type DesignTheme } from '../design/theme';
import { cellText } from '../render/format';
import { LayoutError, sceneFont } from './metrics';

type Block = SlideContent['blocks'][number];
type Of<K extends Block['kind']> = Extract<Block, { kind: K }>;
import { LAYOUTS } from './definitions';
export { LAYOUTS } from './definitions';
import { sceneComponents } from './components';
type Tools = ReturnType<typeof sceneComponents>;
function requireBlocks<K extends Block['kind']>(content: SlideContent, kind: K): Of<K>[] {
  const found = content.blocks.filter((b): b is Of<K> => b.kind === kind);
  if (!found.length) throw new LayoutError('PITCH_REQUIRED_CONTENT', `此布局缺少 ${kind} 内容。`);
  return found;
}
function chunk<T>(values: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < values.length; i += n) out.push(values.slice(i, i + n)); return out; }
const paragraphText = (content: SlideContent) => content.blocks.filter(b => b.kind === 'paragraph').map(b => b.text).join('\n\n');
const insightText = (content: SlideContent, en: boolean) => requireBlocks(content, 'insight').map(b => `${b.claim}\n${b.basis}\n${en ? 'Limits' : '边界'}: ${b.limitations.join('；')}`).join('\n\n');

function tablePages(table: Of<'table'>, t: Tools, x: number, y: number, w: number, h: number, emphasizeFirst = false): SceneElement[][] {
  if (!table.rows.length) throw new LayoutError('PITCH_EMPTY_TABLE', '表格没有数据，未知值请保留为空值。');
  if (table.columns.length > 6) throw new LayoutError('PITCH_TABLE_COLUMNS', '当前表格最多六列，请选择对比转置变体或减少本页字段。');
  const weights = table.columns.map((_, i) => emphasizeFirst && i === 0 ? 1.8 : 1);
  const widths = weights.map(weight => w * weight / weights.reduce((a, b) => a + b, 0));
  const heightFor = (row: (string | number | null)[]) => Math.max(...row.map((v, i) => t.lines(cellText(v), widths[i] - 2 * t.theme.table.cellPadding).length)) * t.lh + 2 * t.theme.table.cellPadding;
  const header = heightFor(table.columns), pages: SceneElement[][] = [];
  let rows: typeof table.rows = [], heights: number[] = [], used = header;
  const flush = () => { pages.push([{ kind: 'table', x, y, w, h: used, columns: table.columns, rows, columnWidths: widths, rowHeights: [header, ...heights] }]); rows = []; heights = []; used = header; };
  for (const row of table.rows) {
    const rh = heightFor(row);
    if (header + rh > h) throw new LayoutError('PITCH_TABLE_CELL_CAPACITY', '单行内容过长，无法在可读字号下完整展示，请拆分内容。');
    if (used + rh > h || rows.length >= 10) flush();
    rows.push(row); heights.push(rh); used += rh;
  }
  if (rows.length) flush();
  return pages;
}

/** Business meaning -> layout, never a business-specific brand implementation. */
export async function layoutSlides(raw: SlideContent, rawTheme: DesignTheme, rawLayout: LayoutId, variant: 'standard' | 'alternate' = 'standard'): Promise<SlideScene[]> {
  const content = slideContentSchema.parse(raw), theme = designThemeSchema.parse(rawTheme), id = layoutIdSchema.parse(rawLayout);
  const definition = LAYOUTS.find(l => l.id === id)!;
  const unsupported = content.blocks.find(b => !definition.kinds.includes(b.kind));
  if (unsupported) throw new LayoutError('PITCH_UNSUPPORTED_CONTENT', `“${definition.zh}”不支持 ${unsupported.kind}，请更换布局；内容未被删除。`);
  const t = sceneComponents(await sceneFont(), theme), m = theme.margin, width = theme.width - m * 2, gap = theme.gridGap, en = content.locale.startsWith('en');
  const alt = variant === 'alternate', top = content.subtitle ? 1.65 : 1.35, bottom = 5.8, height = bottom - top;
  let groups: SceneElement[][] = [];
  if (id === 'cover') {
    if (content.blocks.filter(b => b.kind === 'image').length > 1) throw new LayoutError('PITCH_IMAGE_COUNT', '封面最多接受一张图片；请拆分页面或选择其他布局。');
    const image = content.blocks.find(b => b.kind === 'image');
    const tw = image ? 6.5 : width, ty = alt ? 1.55 : 2.05;
    const elements = [t.text(content.title, m, ty, tw, 1.7, 'title', true)];
    const desc = [content.subtitle, paragraphText(content)].filter(Boolean).join('\n\n');
    if (desc) elements.push(t.text(desc, m, ty + 1.9, tw, 1.65));
    if (image?.kind === 'image') elements.push(t.image(image, m + 7, 1.5, width - 7, 4));
    groups = [elements];
  } else if (id === 'section-divider') {
    requireBlocks(content, 'paragraph');
    groups = [[{ kind: 'shape', shape: 'rect', x: m, y: 2.1, w: .08, h: 2.7, fill: 'primary', background: false }, t.text(content.title, m + .4, alt ? 1.9 : 2.3, width - .4, 1.3, 'title', true), t.text([content.subtitle, paragraphText(content)].filter(Boolean).join('\n\n'), m + .4, 3.8, width - .4, 1.6)]];
  } else if (id === 'image-text') {
    const images = requireBlocks(content, 'image'); requireBlocks(content, 'paragraph');
    if (images.length !== 1) throw new LayoutError('PITCH_IMAGE_COUNT', '单图文布局需要且只接受一张图片。');
    const cw = (width - gap) / 2, tx = alt ? m + cw + gap : m, ix = alt ? m : m + cw + gap;
    groups = chunk(t.lines(paragraphText(content), cw), Math.floor(height / t.lh)).map(lines => [t.text(lines.join('\n'), tx, top, cw, height), t.image(images[0], ix, top, cw, height - .72), t.text(images[0].alt, ix, bottom - .65, cw, .65)]);
  } else if (id === 'two-columns') {
    requireBlocks(content, 'paragraph'); const left = alt ? width * .36 : (width - gap) / 2, right = width - gap - left;
    const paragraphs = requireBlocks(content, 'paragraph').map(b => b.text);
    const lh = Math.floor(height / t.lh), leftLines = t.lines(paragraphs.filter((_, i) => i % 2 === 0).join('\n\n'), left);
    const rightText = paragraphs.filter((_, i) => i % 2 === 1).join('\n\n');
    const rightLines = rightText ? t.lines(rightText, right) : [];
    for (let i = 0; i < Math.max(leftLines.length, rightLines.length); i += lh) {
      const a = leftLines.slice(i, i + lh), b = rightLines.slice(i, i + lh);
      groups.push([...(a.length ? [t.text(a.join('\n'), m, top, left, height)] : []), ...(b.length ? [t.text(b.join('\n'), m + left + gap, top, right, height)] : [])]);
    }
  } else if (id === 'kpi') {
    groups = chunk(requireBlocks(content, 'metric'), alt ? 4 : 6).map(metrics => metrics.flatMap((b, i) => {
      const cols = alt ? 2 : 3, cw = (width - gap * (cols - 1)) / cols, x = m + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * 2.1;
      const changes = [b.yoy === undefined ? '' : `${en ? 'YoY' : '同比'} ${b.yoy === null ? '—' : b.yoy + '%'}`, b.qoq === undefined ? '' : `${en ? 'QoQ' : '环比'} ${b.qoq === null ? '—' : b.qoq + '%'}`].filter(Boolean).join(' · ');
      return [t.text(b.label, x, y, cw, .7, 'body', true), t.text(`${cellText(b.value)} ${b.unit}`, x, y + .8, cw, .65), ...(changes ? [t.text(changes, x, y + 1.45, cw, .65)] : [])];
    }));
  } else if (id === 'team-profile') {
    const members = requireBlocks(content, 'team').flatMap(b => b.members), per = alt ? 2 : 3, cw = (width - gap * (per - 1)) / per;
    groups = chunk(members, per).map(people => people.flatMap((p, i) => {
      const x = m + i * (cw + gap), image: SceneElement = p.mediaAssetId ? { kind: 'image', mediaAssetId: p.mediaAssetId, mediaVersion: p.mediaVersion!, alt: p.name, fit: 'contain', x, y: top, w: cw, h: 1.6 } : t.text(en ? 'Photo not supplied' : '未提供照片', x, top, cw, 1.6);
      return [image, t.text(`${p.name}\n${p.title}`, x, top + 1.8, cw, 1.1, 'body', true), t.text(p.biography, x, top + 3, cw, height - 3)];
    }));
  } else if (id === 'case-study') {
    if (content.blocks.filter(b => b.kind === 'image').length > 1) throw new LayoutError('PITCH_IMAGE_COUNT', '案例布局每组最多接受一张图片；请拆分页面。');
    const cases = requireBlocks(content, 'case'), image = content.blocks.find(b => b.kind === 'image'), cw = image ? width * .58 : width;
    for (const c of cases) {
      const stream = `${c.title}\n\n${en ? 'Challenge' : '挑战'}：${c.challenge}\n\n${en ? 'Approach' : '方法'}：${c.approach}\n\n${en ? 'Outcome' : '成果'}：${c.outcome}`;
      groups.push(...chunk(t.lines(stream, cw), Math.floor(height / t.lh)).map(lines => [t.text(lines.join('\n'), alt && image ? m + width - cw : m, top, cw, height), ...(image?.kind === 'image' ? [t.image(image, alt ? m : m + cw + gap, top, width - cw - gap, height)] : [])]));
    }
  } else if (id === 'data-table' || id === 'comparison') {
    for (const original of requireBlocks(content, 'table')) {
      if (!original.rows.length) throw new LayoutError('PITCH_EMPTY_TABLE', '对比或数据表没有数据，请补充记录后生成。');
      const table = id === 'comparison' && !alt ? { ...original, columns: [en ? 'Measure' : '指标', ...original.rows.map(r => cellText(r[0]))], rows: original.columns.slice(1).map((c, i) => [c, ...original.rows.map(r => r[i + 1])]) } : original;
      groups.push(...tablePages(table, t, m, top, width, height, id === 'data-table' && alt));
    }
  } else if (id === 'chart-insight') {
    const charts = requireBlocks(content, 'chart'), hasInsight = content.blocks.some(b => b.kind === 'insight');
    const iw = alt ? width : width * .3, cw = !hasInsight || alt ? width : width - iw - gap, ch = hasInsight && alt ? 2.7 : height;
    const insight = hasInsight ? insightText(content, en) : '', ih = alt ? height - ch - gap : height;
    for (const chart of charts) {
      if (chart.chartType === 'scatter') throw new LayoutError('PITCH_CHART_UNSUPPORTED', '散点图尚未注册，请选择柱状、条形、折线、饼图或组合图。');
      if (!chart.categories.length || chart.categories.length > 12 || chart.series.length > 4 || chart.categories.some(c => t.lines(c, chart.chartType === 'bar' ? .9 : (cw - 1.2) / chart.categories.length).length > 2)) throw new LayoutError('PITCH_CHART_LABELS', '图表标签过密或过长，请减少本页分类或换用条形图。');
      const plotHeight = ch - 1.5;
      if (chart.series.some(s => t.lines(`${s.name}${s.unit ? ` (${s.unit})` : ''}`, cw / chart.series.length - .22).length > 1)
        || chart.chartType === 'bar' && chart.categories.some(c => t.lines(c, .9).length * t.lh > plotHeight / chart.categories.length)
        || chart.chartType === 'pie' && (chart.categories.length * .4 > plotHeight || chart.categories.some((c, i) => t.lines(`${c}: ${cellText(chart.series[0].values[i])}`, (cw - 1.2) * .33).length > 1))) {
        throw new LayoutError('PITCH_CHART_LABELS', '图例或标签无法以可读字号完整展示，请缩短名称、减少分类或换用其他布局。');
      }
      if (!chart.series.some(s => s.values.some(v => v !== null))) throw new LayoutError('PITCH_CHART_EMPTY', '图表没有已知数值，不能把未知值当成零。');
      if (chart.series.some(s => s.values.some(v => v !== null && Math.abs(v) > 1e15))) throw new LayoutError('PITCH_CHART_RANGE', '图表数值超过安全范围，请保留单位并改用更合适的数值尺度。');
      if (new Set(chart.series.map(s => s.unit)).size !== 1) throw new LayoutError('PITCH_CHART_UNITS', '当前单轴图表要求系列单位一致；不同单位请拆图。');
      if (chart.chartType === 'pie' && (chart.series.length !== 1 || chart.series[0].values.some(v => v === null || v < 0) || !chart.series[0].values.some(v => v! > 0))) throw new LayoutError('PITCH_PIE_VALUES', '饼图需要一组完整、非负且总量大于零的数值。');
      if (chart.chartType === 'combo' && chart.series.length !== 2) throw new LayoutError('PITCH_COMBO_SERIES', '组合图需要两个同单位系列：柱形与折线。');
      const el: SceneElement = { kind: 'chart', x: m, y: top, w: cw, h: ch, chartType: chart.chartType, categories: chart.categories, series: chart.series };
      if (!hasInsight) { groups.push([el]); continue; }
      groups.push(...chunk(t.lines(insight, iw), Math.floor(ih / t.lh)).map(lines => [el, t.text(lines.join('\n'), alt ? m : m + cw + gap, alt ? top + ch + gap : top, iw, ih)]));
    }
  } else if (id === 'map-analysis') {
    const maps = requireBlocks(content, 'map'), mw = alt ? width * .52 : width * .63, iw = width - mw - gap;
    for (const map of maps) {
      if (!map.bounds || !map.points?.length) throw new LayoutError('PITCH_MAP_SNAPSHOT_REQUIRED', '地图引用需要获权的范围与坐标快照，不能生成占位地图。');
      const [west, south, east, north] = map.bounds;
      if (west >= east || south >= north || map.points.length > 12 || map.points.some(p => p.longitude < west || p.longitude > east || p.latitude < south || p.latitude > north)) throw new LayoutError('PITCH_MAP_BOUNDS', '地图范围或点位不合法；跨日期变更线地图需要专用适配器。');
      const points = map.points;
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) if (Math.hypot((points[i].longitude - points[j].longitude) / (east - west), (points[i].latitude - points[j].latitude) / (north - south)) < .045) throw new LayoutError('PITCH_MAP_DENSITY', '点位过密，请调整范围或分成多页。');
      const legend = points.map((p, i) => `${i + 1} ${p.label}`).join('\n');
      const explanation = `${legend}\n\n${insightText(content, en)}\n${en ? 'Coordinate schematic; not a street basemap' : '坐标示意图，非道路底图'}`;
      groups.push(...chunk(t.lines(explanation, iw), Math.floor(height / t.lh)).map(lines => [{ kind: 'map' as const, x: m, y: top, w: mw, h: height, bounds: map.bounds!, points }, t.text(lines.join('\n'), m + mw + gap, top, iw, height)]));
    }
  } else {
    const entries = requireBlocks(content, 'timeline').flatMap(b => b.entries), cw = (width - gap * 2) / 3;
    groups = chunk(entries, 3).map(items => items.flatMap((e, i) => {
      const x = m + i * (cw + gap), y = alt ? top + i * .35 : top;
      return [t.text(`${e.date}\n${e.title}`, x, y, cw, 1.15, 'body', true), { kind: 'shape', shape: 'arrow', x, y: y + 1.35, w: cw, h: .2, fill: 'secondary', background: false } as SceneElement, t.text(e.description, x, y + 1.85, cw, height - 2.55)];
    }));
  }
  if (!groups.length || groups.length > 50) throw new LayoutError('PITCH_PAGE_LIMIT', '没有可生成的页面，或已超过五十页上限。');
  const source = `${en ? 'As of' : '期间'} ${content.dataAsOf} · ${en ? 'Source' : '来源'}：${content.sources.map(s => s.label).join('；')}${content.isTestData ? (en ? ' · TEST DATA' : ' · 测试数据，非真实案例') : ''}`;
  return groups.map((elements, i) => {
    const header = ['cover', 'section-divider'].includes(id) ? [] : [t.text(content.title + (groups.length > 1 ? ` (${i + 1}/${groups.length})` : ''), m, .45, width, .65, 'title', true), ...(content.subtitle ? [t.text(content.subtitle, m, 1.15, width, .36)] : [])];
    const footer: SceneElement[] = [t.text(source, m, 6.1, width, .7, 'body', false, 'source')];
    if (theme.footer.enabled && (theme.footer.label || theme.footer.pageNumber)) footer.push(t.text([theme.footer.label, theme.footer.pageNumber ? String(i + 1) : ''].filter(Boolean).join(' · '), m, 6.9, width - (theme.logo.enabled ? 1 : 0), .35, 'body', false, 'footer'));
    if (theme.logo.enabled) footer.push({ kind: 'brand', resource: 'colliers-brand-assets/1', x: theme.width - m - .8, y: 6.9, w: .8, h: .35 });
    return slideSceneSchema.parse({ protocol: content.protocol, rendererVersion: 'pitch-scene/2', variant, pagination: { index: i, count: groups.length }, width: theme.width, height: theme.height, layoutId: id, layoutVersion: 2, themeId: theme.id, themeVersion: theme.version, elements: [...header, ...elements, ...footer] });
  });
}
