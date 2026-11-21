import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { z } from 'zod';
import { reportDescriptorSchema, REPORT_LIMITS } from './reportProtocol';
import { resultViewSchema, resultSummary, cellText, units } from './presentation';
import { resultOutputDescriptor } from './resultOutput';
import { researchAnalysisSchema } from './researchAnalysisView';
import { buildResultChart } from './charts';
import { chartRequestSchema } from './chartSpec';
import { renderChartPng } from './chartPng';
import { resultDigest, type QueryResult } from './result';

const sectionSchema = z.object({ result: resultViewSchema, chart: chartRequestSchema.nullable() });
const color = (hex: string) => rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
const ink = color('172033'), blue = color('003e7e'), muted = color('667085'), rule = color('d9e0e8');
const width = 841.89, height = 595.28, margin = 44, available = width - margin * 2, lineHeight = 17;
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, ' ');

/** Fixed PDF primitives only: no HTML parser, JavaScript, links, external assets or caller paths. */
export async function renderResearchPdf(raw: QueryResult) {
  const root = resultViewSchema.parse(raw), descriptor = reportDescriptorSchema.parse(root.parameters.agentReport);
  const sections = z.array(sectionSchema).min(1).max(8).parse((root.parameters.agentReport as { sections: unknown }).sections);
  if (descriptor.sectionCount !== sections.length || descriptor.rowCount !== sections.reduce((n, s) => n + s.result.table.rows.length, 0)
    || descriptor.rowCount > REPORT_LIMITS.rows) throw new Error('REPORT_ROW_LIMIT');
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  // Embed the server-only static TrueType Chinese face. Fontkit subsets
  // glyphs and embeds a ToUnicode map for searchable Chinese.
  const font = await doc.embedFont(new Uint8Array(await readFile(path.join(process.cwd(), 'private/chart-fonts/NotoSansSC-PdfRegular.ttf'))), { subset: true });
  const charset = new Set(font.getCharacterSet());
  const generation = new Date(descriptor.generatedAt);
  doc.setTitle('高力国际北京写字楼市场研究报告'); doc.setAuthor('Colliers AI'); doc.setSubject('内部研究资料；不构成对客发布授权');
  doc.setProducer('Colliers AI research-pdf/1'); doc.setCreator('Colliers AI'); doc.setCreationDate(generation); doc.setModificationDate(generation);
  const generated = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(generation) + '（北京时间）';
  let page!: PDFPage, y = 0, characters = 0;
  function checkText(s: string) {
    characters += s.length;
    if (characters > REPORT_LIMITS.textCharacters) throw new Error('REPORT_TEXT_LIMIT');
    if (Array.from(s).some(c => c !== '\n' && !charset.has(c.codePointAt(0)!))) throw new Error('REPORT_FONT_GLYPH_UNSUPPORTED');
  }
  function lines(rawText: string, maxWidth = available, size = 11): string[] {
    const text = clean(rawText); checkText(text);
    const output: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '', length = 0;
      for (const c of Array.from(paragraph)) {
        const w = font.widthOfTextAtSize(c, size);
        if (length + w > maxWidth && line) { output.push(line); line = ''; length = 0; }
        line += c; length += w;
      }
      output.push(line);
    }
    return output;
  }
  function text(s: string, x: number, top: number, size = 11, fill = ink) {
    page.drawText(s, { x, y: height - top - size, size, font, color: fill });
  }
  function newPage() {
    if (doc.getPageCount() >= REPORT_LIMITS.pages) throw new Error('REPORT_PAGE_LIMIT');
    page = doc.addPage([width, height]); y = 86;
    page.drawRectangle({ x: 0, y: 0, width, height, color: color('f8fafc') });
    text('高力国际  |  北京写字楼研究', margin, 29, 11, blue);
    text('内部研究资料', width - margin - 80, 29, 11, muted);
    page.drawLine({ start: { x: margin, y: height - 57 }, end: { x: width - margin, y: height - 57 }, thickness: .7, color: rule });
  }
  function space(h: number) { if (y + h > height - 66) newPage(); }
  function paragraph(s: string, heading = false) {
    const size = heading ? 16 : 11, leading = heading ? 24 : lineHeight;
    const wrapped = lines(s, available, size); if (heading) space(Math.min(wrapped.length + 2, 5) * leading);
    for (const line of wrapped) { space(leading); text(line, margin, y, size, heading ? blue : ink); y += leading; }
    y += heading ? 8 : 7;
  }
  const manifest = { version: 'research-pdf/1', purpose: 'internal', generatedAt: descriptor.generatedAt,
    resultId: root.resultId, digest: resultDigest(raw), dataVersion: root.dataVersion,
    sections: sections.map((s, i) => ({ resultId: s.result.resultId, snapshotId: s.result.snapshotId, dataVersion: s.result.dataVersion,
      createdAt: s.result.createdAt, digest: resultDigest((root.parameters.agentReport as { sections: Array<{ result: QueryResult }> }).sections[i].result), parameters: s.result.parameters,
      table: s.result.table, analysis: s.result.analysis, sources: s.result.sources, limitations: s.result.limitations, chart: s.chart })) };
  // Technical provenance stays in an inert JSON attachment, not business prose.
  await doc.attach(new Uint8Array(new TextEncoder().encode(JSON.stringify(manifest))), 'manifest.json', {
    mimeType: 'application/json', description: '来源、精确单元格、口径与结果版本', creationDate: generation, modificationDate: generation,
  });
  newPage(); paragraph('北京写字楼市场研究报告', true);
  paragraph('研究范围：' + [...new Set(sections.map(s => resultOutputDescriptor(s.result).object))].join('；'));
  paragraph('数据期间：' + [...new Set(sections.map(s => resultOutputDescriptor(s.result).period))].join('；'));
  paragraph('生成时间：' + generated);
  paragraph('内部研究用途。对客成果须另行取得正式发布授权，本文件不自动获得对外传播资格。');
  paragraph('核心结论', true);
  sections.forEach((s, i) => { const d = resultOutputDescriptor(s.result); paragraph(`${i + 1}. ${d.metric}：${resultSummary(s.result)[0]}`); });
  paragraph('阅读说明', true);
  paragraph('正文数值按正式单元格显示精度展示，精确值与完整来源随文件内 manifest.json 保留。各结果独立保留期间、有效样本与分母，不跨结果重算平均数、百分比或趋势。未知不填零，不推断市场原因或投资价值。');
  for (const [i, section] of sections.entries()) {
    const r = section.result, d = resultOutputDescriptor(r);
    newPage(); paragraph(`${i + 1}. ${d.object} · ${d.metric}`, true);
    paragraph('数据期间：' + d.period); paragraph('研究范围：' + resultOutputDescriptor(r).object + '；' + ((r.parameters.scope as { inventory?: string } | undefined)?.inventory === 'tracked' ? '当前跟踪楼宇样本' : '当前获权楼宇目录'));
    paragraph('关键指标', true);
    const last = r.operation === 'trend' || r.operation === 'group_trend' || r.operation === 'cross_trend' ? r.table.rows.at(-1) : r.operation === 'aggregate' || r.operation === 'compare' ? r.table.rows[0] : undefined;
    const kpis = r.table.columns.filter(c => c.unit && !/Count|count|denominator|numerator|rank/i.test(c.key));
    if (last && kpis.length) for (const c of kpis) paragraph(`${c.label}：${cellText(last.cells[c.key], c.unit)} ${units[c.unit!] ?? c.unit}（取自原表对应期间，样本见明细）`);
    else paragraph('本节按完整原表呈现，不把逐楼记录擅自汇总为市场指标。完整记录与限制见下文。');
    paragraph('研究分析与统计口径', true);
    resultSummary(r).forEach(s => paragraph(s));
    const research = researchAnalysisSchema.safeParse(r.parameters.researchAnalysis).data;
    if (research) {
      const known = new Set(r.sources.map(s => s.id));
      if (research.findings.some(f => f.sourceIds.some(id => !known.has(id)))) throw new Error('REPORT_FINDING_SOURCE_INVALID');
      for (const finding of research.findings) paragraph(`${finding.title}：${finding.text}`);
      // Changes come only from the saved deterministic research supplement.
      for (const series of research.series) for (const [label, changes] of [['环比', series.quarterOnQuarter], ['同比', series.yearOnYear]] as const) {
        for (const change of changes) {
          const period = `${change.current.year}Q${change.current.quarter}`;
          paragraph(`${series.label || d.metric} ${period} ${label}：${change.change ? cellText({ kind: 'number', value: change.change, sourceIds: [] }, change.changeUnit) + ' ' + (units[change.changeUnit] ?? change.changeUnit) : '未知：缺少可比有效数据或基期为零'}。`);
        }
      }
    }
    if (section.chart) {
      const chart = buildResultChart(r, section.chart);
      if (chart.request.kind === 'plot' && chart.points.length > 100) throw new Error('REPORT_CHART_LABEL_LIMIT');
      const png = await renderChartPng(chart, { provenance: 'attachment' });
      if (png.width > 2300) throw new Error('REPORT_CHART_WIDTH_LIMIT');
      const image = await doc.embedPng(png.bytes);
      // Large charts are tiled over pages at a readable scale, never silently
      // cropped or squeezed into one illegible image. Adjacent tiles overlap.
      const scale = Math.min(available / image.width, .5), chartWidth = image.width * scale, chartHeight = image.height * scale;
      const tile = 350, step = 330;
      for (let offset = 0; offset < chartHeight; offset += step) {
        newPage(); paragraph('图表 · ' + d.metric, true); paragraph('数据期间：' + d.period + '；正式图元与原结果绑定。');
        const shown = Math.min(tile, chartHeight - offset), top = y;
        // Clip to the page tile with PDF graphics operators; only generated image.
        const { pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await import('pdf-lib');
        page.pushOperators(pushGraphicsState(), rectangle(margin, height - top - shown, chartWidth, shown), clip(), endPath());
        page.drawImage(image, { x: margin, y: height - top - chartHeight + offset, width: chartWidth, height: chartHeight });
        page.pushOperators(popGraphicsState()); y += shown + 8;
        if (chartHeight > tile) paragraph(`图表续页区段 ${Math.floor(offset / step) + 1}；相邻区段保留重叠，完整数值见下表。`);
        if (chartHeight - offset <= tile) break;
      }
    }
    // Horizontal bands retain the first identifying column. Every row and every
    // column is printed; a long cell can continue across multiple pages.
    const columns = r.table.columns;
    const bands = columns.length <= 6 ? [columns] : Array.from({ length: Math.ceil((columns.length - 1) / 5) }, (_, b) => [columns[0], ...columns.slice(1 + b * 5, 6 + b * 5)]);
    for (const [band, cols] of bands.entries()) {
      const cellWidth = available / Math.max(1, cols.length);
      const header = () => {
        paragraph(`数据明细${bands.length > 1 ? ` · 字段组 ${band + 1}/${bands.length}` : ''}`, true);
        const labels = cols.map(c => lines(c.label + (c.unit ? `（${units[c.unit] ?? c.unit}）` : ''), cellWidth - 12));
        const h = Math.max(1, ...labels.map(l => l.length)) * lineHeight + 12;
        if (h > 240) throw new Error('REPORT_TABLE_HEADER_LIMIT');
        page.drawRectangle({ x: margin, y: height - y - h, width: available, height: h, color: color('edf4fb') });
        labels.forEach((list, ci) => list.forEach((line, li) => text(line, margin + ci * cellWidth + 6, y + 6 + li * lineHeight, 11, blue)));
        y += h;
      };
      newPage(); header();
      if (!r.table.rows.length) paragraph('没有符合本次范围的有效记录；不编造指标或结论。');
      for (const row of r.table.rows) {
        const values = cols.map(c => lines(cellText(row.cells[c.key], c.unit), cellWidth - 12));
        const total = Math.max(1, ...values.map(v => v.length)); let offset = 0;
        while (offset < total) {
          let count = Math.floor((height - 74 - y - 12) / lineHeight);
          if (count < 1) { newPage(); header(); count = Math.floor((height - 74 - y - 12) / lineHeight); }
          count = Math.min(count, total - offset);
          values.forEach((list, ci) => list.slice(offset, offset + count).forEach((line, li) => text(line, margin + ci * cellWidth + 6, y + 6 + li * lineHeight)));
          y += count * lineHeight + 12;
          page.drawLine({ start: { x: margin, y: height - y }, end: { x: width - margin, y: height - y }, thickness: .4, color: rule });
          offset += count;
          if (offset < total) { newPage(); paragraph('长记录续页', true); header(); }
        }
      }
    }
    newPage(); paragraph('来源与限制 · ' + d.metric, true);
    [...new Set(r.limitations)].forEach(s => paragraph(s));
    paragraph('数据为保存的获权快照，不代表实时行情；数据库记录存在不等于原件已核验。缺失、无效、冲突及未核验分别保留。');
    const groups = new Map<string, number>();
    const sourceNames: Record<string, string> = { buildings: '楼宇目录', building_metrics: '季度指标库', building_brochure_data: '楼宇资料库' };
    const verification: Record<string, string> = { database_only: '数据库记录', verified_original: '原件已核验', unreviewed: '未核验', historical: '历史资料' };
    for (const source of r.sources) {
      const label = `${sourceNames[source.table] ?? '正式结果来源'} · ${({ net_effective_rent: '净有效租金', total_area: '总面积', vacant_area: '空置面积', name: '楼宇名称', height: '建筑高度', submarket: '子市场', grade: '等级' } as Record<string, string>)[source.field] ?? source.field} · ${source.period ? `${source.period.year}Q${source.period.quarter}` : '非季度资料'} · ${verification[source.verification]}`;
      groups.set(label, (groups.get(label) ?? 0) + 1);
    }
    if (!groups.size) paragraph('没有可用来源记录；不得把空结果解释为现实市场无存量或无需求。');
    for (const [label, count] of groups) paragraph(`${label}：${count} 条来源。`);
    paragraph(`结果版本：${r.dataVersion.slice(0, 16)}；快照时间：${r.createdAt}。完整字段级追溯见本文件内来源附件。`);
  }
  for (const [i, p] of doc.getPages().entries()) {
    page = p; page.drawLine({ start: { x: margin, y: 51 }, end: { x: width - margin, y: 51 }, thickness: .7, color: rule });
    text(`内部研究 · 版本 ${root.dataVersion.slice(0, 12)}`, margin, height - 39, 11, muted);
    text(`${i + 1} / ${doc.getPageCount()}`, width - margin - 55, height - 39, 11, muted);
  }
  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount() };
}
