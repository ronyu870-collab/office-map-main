import { openSafeArchive, DocumentError, unsafe, limited } from '@/src/lib/intelligence/knowledge/safeArchive';
import { MAX_FILE, MAX_PAGES, blankPage, finishPage, formats, type ParserSession } from './protocol';
import { extractMedia } from './media';
import { pptxSession, docxSession } from './openxml';
export function fileFormat(filename: string, mime?: string) {
  const extension = filename.split('.').pop()?.toLowerCase() as keyof typeof formats;
  if (!Object.hasOwn(formats, extension) || mime && mime !== formats[extension] && mime !== 'application/octet-stream') throw new DocumentError('PITCH_FORMAT_UNSUPPORTED', '仅支持 PPTX、PDF、DOCX、XLSX、PNG、JPEG、WebP 和 UTF-8 纯文本；旧 PPT 与含宏文件不受支持。');
  return { extension, mime: formats[extension] };
}
export async function openDocument(bytes: Uint8Array, filename: string, mime: string): Promise<ParserSession> {
  if (!bytes.length || bytes.length > MAX_FILE) throw limited(); const format = fileFormat(filename, mime);
  if (['png', 'jpg', 'jpeg', 'webp'].includes(format.extension)) {
    const media = await extractMedia(filename, bytes); if (media.mime !== format.mime) throw unsafe();
    return { count: 1, close: async () => {}, page: async () => ({ page: finishPage({ ...blankPage(1, 'image', '原始图片'), title: filename, size: { width: media.width, height: media.height, unit: 'px' }, images: [{ key: filename, box: { x: 0, y: 0, w: media.width, h: media.height }, crop: {}, groups: [] }] }), media: [media] }) };
  }
  if (format.extension === 'txt') {
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw unsafe(); }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/u.test(text) || text.length > 500000) throw unsafe();
    // Logical chunks retain exact offsets; source text is never executed.
    const parts = text.match(/[\s\S]{1,12000}/g) ?? ['']; if (parts.length > MAX_PAGES) throw limited();
    return { count: parts.length, close: async () => {}, page: async i => ({ page: finishPage({ ...blankPage(i + 1, 'text', `字符 ${i * 12000 + 1}–${i * 12000 + parts[i].length}`), title: parts[i].split('\n')[0].slice(0, 4000), texts: [{ text: parts[i], role: 'body', box: null, groups: [] }] }), media: [] }) };
  }
  if (format.extension === 'pdf') return pdfSession(bytes);
  const archive = await openSafeArchive(bytes);
  if (format.extension === 'pptx') return pptxSession(archive);
  if (format.extension === 'docx') return docxSession(archive);
  // SheetJS may inflate parts internally: validate every part with the bounded
  // decoder first, including unknown connections, embeddings and metadata.
  for (const name of archive.names) archive.read(name);
  const XLSX = await import('xlsx');
  let workbook: ReturnType<typeof XLSX.read>; try { workbook = XLSX.read(bytes, { type: 'array', cellFormula: true, cellDates: false, cellHTML: false, cellNF: true, bookVBA: false, bookDeps: false, cellStyles: true }); } catch { throw unsafe(); }
  const units: { name: string; start: number; end: number; left: number; right: number; hidden: boolean }[] = []; let total = 0;
  for (const [i, name] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[name], range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1); total += cells;
    if (total > 50000 || range.e.c - range.s.c > 99) throw limited();
    for (let row = range.s.r; row <= range.e.r; row += 150) units.push({ name, start: row, end: Math.min(row + 149, range.e.r), left: range.s.c, right: range.e.c, hidden: !!workbook.Workbook?.Sheets?.[i]?.Hidden });
  }
  if (!units.length || units.length > MAX_PAGES) throw limited();
  return { count: units.length, close: async () => {}, page: async i => {
    const unit = units[i], sheet = workbook.Sheets[unit.name], range = XLSX.utils.encode_range({ r: unit.start, c: unit.left }, { r: unit.end, c: unit.right });
    const page = blankPage(i + 1, 'worksheet', `工作表 ${unit.name} · ${range}`); page.title = unit.name; page.hidden = unit.hidden;
    const table: (typeof page.tables)[number] = { columns: [], rows: [], range, cells: [] };
    const visibleColumns = Array.from({length:unit.right-unit.left+1},(_,n)=>unit.left+n).filter(c=>!sheet['!cols']?.[c]?.hidden);
    let header = false;
    for (let r = unit.start; r <= unit.end; r++) {
      if(sheet['!rows']?.[r]?.hidden){page.hiddenObjects++;continue;}
      const row = [];
      for (const c of visibleColumns) {
        const address = XLSX.utils.encode_cell({ r, c }), cell = sheet[address];
        const value = cell?.v === undefined ? null : typeof cell.v === 'number' && Number.isFinite(cell.v) || typeof cell.v === 'boolean' ? cell.v : String(cell.v);
        const formula = cell?.f; table.cells!.push({ address, type: cell?.t ?? 'missing', value, ...(formula ? { formula } : {}), cached: !!formula && cell?.v !== undefined });
        // Cached formula values remain in the source structure but are omitted
        // from candidate business values until an editor explicitly confirms.
        row.push(formula ? null : value);
      }
      if (!header) {table.columns = row.map((v, c) => v === null ? XLSX.utils.encode_col(visibleColumns[c]) : String(v));header=true;} else table.rows.push(row);
    }
    if(visibleColumns.length<unit.right-unit.left+1){page.hiddenObjects+=unit.right-unit.left+1-visibleColumns.length;}
    page.tables.push(table);
    if (table.cells!.some(c => c.formula)) page.warnings.push('含公式；保留公式及缓存结果，候选值留空，未执行或刷新公式。');
    if (archive.names.some(n => /externalLinks|connections[.]xml|queryTables/i.test(n))) page.warnings.push('含外部数据连接，未访问或刷新。');
    if (sheet['!merges']?.length) page.warnings.push('含合并单元格，需核对表头与空值。');
    return { page: finishPage(page), media: [] };
  } };
}
async function pdfSession(bytes: Uint8Array): Promise<ParserSession> {
  if (Buffer.from(bytes.slice(0, 5)).toString() !== '%PDF-') throw unsafe();
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, disableAutoFetch: true, disableRange: true, stopAtErrors: true, maxImageSize: 4000000 });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PAGES) throw limited();
    if (await pdf.hasJSActions()) throw new DocumentError('PITCH_ACTIVE_PDF_UNSUPPORTED', 'PDF 包含脚本动作，未执行，需提供安全副本。');
    return { count: pdf.numPages, close: () => task.destroy(), page: async i => {
      const source = await pdf.getPage(i + 1), viewport = source.getViewport({ scale: 1 }), page = blankPage(i + 1, 'pdf-page', `PDF 第 ${i + 1} 页`);
      page.size = { width: viewport.width, height: viewport.height, unit: 'pt' };
      const text = await source.getTextContent();
      for (const item of text.items) if ('str' in item && item.str) page.texts.push({ text: item.str, role: 'body', box: { x: item.transform[4], y: viewport.height - item.transform[5] - item.height, w: item.width, h: item.height }, groups: [] });
      page.title = page.texts[0]?.text ?? `PDF 第 ${i + 1} 页`; const media = [];
      const ops = await source.getOperatorList(); let images = 0;
      for (const [index, op] of ops.fnArray.entries()) if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
        if (++images > 30) throw limited();
        try {
          const value = op === OPS.paintInlineImageXObject ? ops.argsArray[index][0] : await new Promise<{ width: number; height: number; data: Uint8Array; kind: number }>((resolve, reject) => {
            const timer = setTimeout(() => reject(unsafe()), 1500); source.objs.get(ops.argsArray[index][0], (data: { width: number; height: number; data: Uint8Array; kind: number }) => { clearTimeout(timer); resolve(data); });
          });
          if (!value.width || !value.height || value.width * value.height > 16_000_000 || !value.data || ![2, 3].includes(value.kind)) throw unsafe();
          const sharp = (await import('sharp')).default, bytes = new Uint8Array(await sharp(value.data, { raw: { width: value.width, height: value.height, channels: value.kind === 3 ? 4 : 3 } }).png().toBuffer()), key = `pdf-image:${i + 1}:${index}`;
          media.push(await extractMedia(key, bytes)); page.images.push({ key, box: null, crop: {}, groups: [] });
        } catch { page.warnings.push('部分 PDF 图像无法独立提取；保留原页，不推断图像中的业务事实。'); }
      }
      if (!page.texts.length) { page.status = 'manual'; page.warnings.push('扫描页或无可读取文字；当前未配置受控 OCR。'); }
      if ((await source.getAnnotations()).length) page.warnings.push('注释／表单未作为正文；请核对原件。');
      source.cleanup(); return { page: finishPage(page), media };
    } };
  } catch (e) { await task.destroy(); if (e instanceof DocumentError) throw e; throw unsafe(); }
}
