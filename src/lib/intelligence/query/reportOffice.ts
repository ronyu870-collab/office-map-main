import { readReportModel, reportSectionNarrative } from './reportModel';
import { resultOutputDescriptor } from './resultOutput';
import { cellText, units } from './presentation';
import { buildResultChart } from './charts';
import { renderChartPng } from './chartPng';
import { REPORT_LIMITS } from './reportProtocol';
import type { QueryResult } from './result';

const font = 'Microsoft YaHei', ink = '172033', blue = '25408F', pale = 'F5F7FA';
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069\uFFFE\uFFFF]/g, ' ');
const xml = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const generated = (stamp: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(stamp)) + '（北京时间）';
type Model = ReturnType<typeof readReportModel>;
type Section = Model['sections'][number];

/** Inert OPC custom XML, referenced from the office document. Never an external link. */
async function attachManifest(bytes: Uint8Array, manifest: Model['manifest'], kind: 'word' | 'ppt') {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes), relPath = kind === 'word' ? 'word/_rels/document.xml.rels' : 'ppt/_rels/presentation.xml.rels';
  const rels = await zip.file(relPath)!.async('string');
  // Escape non-XML/bidi characters in JSON, preserving exact original evidence
  // even when the visible Office text needs safe display substitutions.
  const json = JSON.stringify(manifest).replace(/[\u007F\u202A-\u202E\u2066-\u2069\uFFFE\uFFFF]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  zip.file('customXml/colliers-research.xml', `<?xml version="1.0" encoding="UTF-8"?><research xmlns="urn:colliers:research:1">${xml(json)}</research>`);
  zip.file(relPath, rels.replace('</Relationships>', '<Relationship Id="rIdColliersResearch" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/colliers-research.xml"/></Relationships>'));
  const types = await zip.file('[Content_Types].xml')!.async('string');
  zip.file('[Content_Types].xml', types.replace('</Types>', '<Override PartName="/customXml/colliers-research.xml" ContentType="application/xml"/></Types>'));
  // Downloads are rebuilt from the authorized snapshot. Wall-clock metadata
  // must not change the file digest recorded when that snapshot was generated.
  const core = zip.file('docProps/core.xml');
  if (core) zip.file('docProps/core.xml', (await core.async('string')).replace(
    /(<dcterms:(?:created|modified)\b[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g,
    `$1${manifest.generatedAt}$2`));
  for (const entry of Object.values(zip.files)) entry.date = new Date('2000-01-01T00:00:00Z');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function content(model: Model) {
  const scope = [...new Set(model.sections.map(s => resultOutputDescriptor(s.result).object))].join('；');
  const period = [...new Set(model.sections.map(s => resultOutputDescriptor(s.result).period))].join('；');
  return ['研究范围：' + scope, '数据期间：' + period, '生成时间：' + generated(model.descriptor.generatedAt),
    '内部研究资料。对客发布与对外传播须另行正式授权。',
    '所有表格保留正式结果及原始统计口径，未知不填零；成交面积不是净吸纳量，未来供应目录不是实际交付。相关关系不解释为因果。',
    ...model.root.limitations];
}
function citations(section: Section) {
  const groups = new Map<string, number>();
  for (const s of section.result.sources) {
    const title = `${s.table} · ${s.field} · ${s.period ? `${s.period.year}Q${s.period.quarter}` : '非季度资料'} · ${s.verification}`;
    groups.set(title, (groups.get(title) ?? 0) + 1);
  }
  return [...groups].map(([label, count]) => `${label}：${count} 条来源。`);
}
function bands(section: Section) {
  const cols = section.result.table.columns;
  return cols.length <= 6 ? [cols] : Array.from({ length: Math.ceil((cols.length - 1) / 5) }, (_, i) => [cols[0], ...cols.slice(1 + i * 5, 6 + i * 5)]);
}
function boundedText(model: Model) {
  const characters = JSON.stringify(model.sections.map(s => [reportSectionNarrative(s.result), s.result.table, s.result.limitations])).length;
  if (characters > REPORT_LIMITS.textCharacters) throw new Error('REPORT_TEXT_LIMIT');
}
async function chartImage(section: Section) {
  if (!section.chart) return null;
  const chart = buildResultChart(section.result, section.chart);
  if (chart.request.kind === 'plot' && chart.points.length > 100) throw new Error('REPORT_CHART_LABEL_LIMIT');
  // Full narrative and limitations are laid out as editable text beside the
  // figure. Avoid repeating them inside a tall raster; all marks/axes stay intact.
  const png = await renderChartPng({ ...chart, summary: [], limitations: [] }, { provenance: 'attachment' });
  if (png.width > 2300 || png.height > 2400) throw new Error('REPORT_CHART_SIZE_LIMIT');
  return png;
}

/** Native editable Word paragraphs/tables, fixed local images and page fields. */
export async function renderResearchDocx(raw: QueryResult) {
  const model = readReportModel(raw); boundedText(model);
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Header, Footer,
    PageNumber, WidthType, HeadingLevel, ShadingType, BorderStyle } = await import('docx');
  const p = (s: string, heading = false) => new Paragraph({ heading: heading ? HeadingLevel.HEADING_1 : undefined,
    spacing: { after: heading ? 180 : 120 }, keepNext: heading,
    children: [new TextRun({ text: clean(s), size: heading ? 32 : 22, bold: heading, color: heading ? blue : ink, font })] });
  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [p('高力国际北京写字楼专题研究', true), ...content(model).map(s => p(s))];
  for (const [i, section] of model.sections.entries()) {
    const d = resultOutputDescriptor(section.result);
    children.push(new Paragraph({ pageBreakBefore: true, children: [] }), p(`${i + 1}. ${d.object} · ${d.metric}`, true), p('数据期间：' + d.period));
    for (const s of reportSectionNarrative(section.result)) children.push(p(s));
    const image = await chartImage(section);
    if (image) {
      const w = 650, h = w * image.height / image.width;
      if (h > 750) throw new Error('REPORT_CHART_SIZE_LIMIT');
      children.push(p('同源图表', true), new Paragraph({ children: [new ImageRun({ type: 'png', data: image.bytes,
        transformation: { width: w, height: h }, altText: { id: String(i + 1), title: d.metric, description: d.period, name: '正式结果图表' } })] }));
    }
    for (const [band, cols] of bands(section).entries()) {
      children.push(p('数据明细' + (section.result.table.columns.length > 6 ? ` · 字段组 ${band + 1}` : ''), true));
      const totalWidth = 10400, widths = cols.map((_, i) => Math.floor(totalWidth / cols.length) + (i === cols.length - 1 ? totalWidth % cols.length : 0));
      const rows = [cols.map(c => c.label + (c.unit ? `（${units[c.unit] ?? c.unit}）` : '')),
        ...section.result.table.rows.map(row => cols.map(c => cellText(row.cells[c.key], c.unit)))];
      children.push(new Table({ width: { size: totalWidth, type: WidthType.DXA }, columnWidths: widths,
        layout: 'fixed', rows: rows.map((row, ri) => new TableRow({ tableHeader: ri === 0,
          children: row.map((value, ci) => new TableCell({ width: { size: widths[ci], type: WidthType.DXA },
            shading: { fill: ri === 0 ? 'EAF0F7' : 'FFFFFF', type: ShadingType.CLEAR },
            borders: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'D9E0E8' } },
            margins: { top: 100, bottom: 100, left: 100, right: 100 }, children: [p(value)] })) })) }));
    }
    if (!section.result.table.rows.length) children.push(p('没有符合范围的有效记录，不编造指标或结论。'));
    children.push(p('来源与限制', true), ...[...section.result.limitations, ...citations(section),
      `结果版本：${section.result.dataVersion.slice(0, 16)}；快照时间：${section.result.createdAt}。`].map(s => p(s)));
  }
  const doc = new Document({ title: '高力国际北京写字楼专题研究', creator: 'Colliers AI', subject: '内部研究资料',
    features: { updateFields: true }, styles: { default: { document: { run: { font, size: 22, color: ink }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 900, bottom: 900, left: 753, right: 753 } } },
      headers: { default: new Header({ children: [p('高力国际 | 北京写字楼研究')] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: '内部研究资料 · 第 ', font, size: 22 }),
        new TextRun({ children: [PageNumber.CURRENT], font, size: 22 }), new TextRun({ text: ' 页 / 共 ', font, size: 22 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font, size: 22 }), new TextRun({ text: ' 页', font, size: 22 })] })] }) }, children }] });
  return attachManifest(new Uint8Array(await Packer.toBuffer(doc)), model.manifest, 'word');
}

/** Explicit CJK line wrapping and pagination; all rows/fields remain editable. */
export function wrapReportText(value: string, max: number): string[] {
  const lines: string[] = [];
  for (const p of clean(value).split(/\r?\n/)) {
    let line = '', width = 0;
    for (const c of p) { const w = c.codePointAt(0)! > 255 ? 1 : .6; if (width + w > max && line) { lines.push(line); line = ''; width = 0; } line += c; width += w; }
    lines.push(line);
  }
  return lines;
}
export async function renderResearchPptx(raw: QueryResult) {
  const model = readReportModel(raw); boundedText(model);
  const { default: PptxGenJS } = await import('pptxgenjs');
  const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE'; deck.author = 'Colliers AI'; deck.subject = '内部研究资料';
  deck.title = '北京写字楼专题研究'; deck.theme = { headFontFace: font, bodyFontFace: font };
  let pages = 0;
  const page = (title: string) => {
    if (++pages > REPORT_LIMITS.pages) throw new Error('REPORT_PAGE_LIMIT');
    const slide = deck.addSlide(); slide.background = { color: pale };
    const titleLines = wrapReportText(title, 25);
    if (titleLines.length > 2) throw new Error('REPORT_TITLE_LIMIT');
    slide.addText(titleLines.join('\n'), { x: .6, y: .35, w: 12.1, h: .98, fontFace: font, fontSize: 30, color: blue, bold: true, margin: 0, breakLine: false });
    slide.addText(`高力国际 · 内部研究资料 · ${pages} · 版本 ${model.root.dataVersion.slice(0, 12)}`,
      { x: .6, y: 6.95, w: 12.1, h: .32, fontFace: font, fontSize: 18, color: '667085', margin: 0 });
    return slide;
  };
  const prose = (title: string, paragraphs: string[]) => {
    const lines = paragraphs.flatMap(s => wrapReportText(s, 45));
    for (let offset = 0; offset < lines.length; offset += 12) page(title).addText(lines.slice(offset, offset + 12).join('\n'),
      { x: .6, y: 1.5, w: 12.1, h: 5.1, fontFace: font, fontSize: 18, color: ink, margin: 0, paraSpaceAfter: 6, valign: 'top', lineSpacingMultiple: 1.2, lang: 'zh-CN' });
  };
  prose('北京写字楼专题研究', content(model));
  for (const [i, section] of model.sections.entries()) {
    const d = resultOutputDescriptor(section.result), title = `${i + 1}. ${d.metric}`;
    prose(title, ['研究范围：' + d.object, '数据期间：' + d.period, ...reportSectionNarrative(section.result)]);
    const image = await chartImage(section);
    if (image) {
      const scale = Math.min(11.9 / image.width, 4.75 / image.height), w = image.width * scale, h = image.height * scale;
      if (w < 6 || h < 1.5) throw new Error('REPORT_CHART_SIZE_LIMIT');
      const slide = page(title + ' · 同源图表');
      slide.addImage({ data: 'image/png;base64,' + Buffer.from(image.bytes).toString('base64'), x: .6, y: 1.5, w, h, altText: d.metric + '；' + d.period });
      slide.addNotes('范围：' + d.object + '；期间：' + d.period + '；图表只来自本节正式结果，完整追溯见来源页与内置manifest。');
    }
    for (const [bi, cols] of bands(section).entries()) {
      const width = 12.1 / cols.length, chars = Math.max(4, Math.floor(width * 72 / 18) - 1);
      const header = cols.map(c => wrapReportText(c.label + (c.unit ? `（${units[c.unit] ?? c.unit}）` : ''), chars));
      const headerLines = Math.max(...header.map(a => a.length));
      if (headerLines > 6) throw new Error('REPORT_TABLE_HEADER_LIMIT');
      const capacity = 15 - headerLines;
      let rows: string[][] = [], heights: number[] = [], occupied = 0;
      const flush = () => {
        if (!rows.length) return;
        const slide = page(title + ' · 明细' + (bands(section).length > 1 ? ` ${bi + 1}` : ''));
        slide.addTable([header.map(a => a.join('\n')), ...rows].map(row => row.map(text => ({ text }))), { x: .6, y: 1.5, w: 12.1,
          colW: cols.map(() => width), rowH: [headerLines * .29 + .12, ...heights], fontFace: font, fontSize: 18,
          color: ink, fill: { color: 'FFFFFF' }, border: { color: 'D9E0E8', pt: .5 }, margin: .04, valign: 'top',
          autoPage: false });
        slide.addNotes('期间：' + d.period + '；未知和披露受限保留原状态，完整来源见本节来源页。');
        rows = []; heights = []; occupied = 0;
      };
      for (const row of section.result.table.rows) {
        const values = cols.map(c => wrapReportText(cellText(row.cells[c.key], c.unit), chars));
        const total = Math.max(...values.map(v => v.length));
        for (let offset = 0; offset < total;) {
          const count = Math.min(capacity, total - offset);
          if (occupied + count + rows.length * .4 > capacity) flush();
          rows.push(values.map(v => v.slice(offset, offset + count).join('\n'))); heights.push(count * .29 + .12); occupied += count;
          offset += count;
          if (offset < total) flush();
        }
      }
      flush();
    }
    prose(title + ' · 来源与限制', [...(!section.result.table.rows.length ? ['没有符合范围的有效记录，不编造指标或结论。'] : []),
      ...section.result.limitations, ...citations(section), `数据期间：${d.period}；结果版本：${section.result.dataVersion.slice(0, 16)}。`]);
  }
  const data = await deck.write({ outputType: 'uint8array', compression: true });
  return attachManifest(data as Uint8Array, model.manifest, 'ppt');
}

/** Merge the existing workbook renderer's sheets, never recalculate business cells. */
export async function renderResearchXlsx(raw: QueryResult) {
  const model = readReportModel(raw), XLSX = await import('xlsx');
  const { buildXlsx } = await import('./exports');
  const workbook = XLSX.utils.book_new();
  for (const [i, section] of model.sections.entries()) {
    const source = XLSX.read(await buildXlsx(section.result as QueryResult), { type: 'array', cellNF: true });
    for (const name of source.SheetNames) XLSX.utils.book_append_sheet(workbook, source.Sheets[name], `${i + 1}_${name}`.slice(0, 31));
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['研究用途', '仅供内部研究，对客发布须另行授权'],
    ...content(model).map(s => ['范围与限制', s]), ['结果版本', model.root.dataVersion]]), '研究说明');
  const { presentWorkbook } = await import('./workbookPresentation');
  return presentWorkbook(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
}
