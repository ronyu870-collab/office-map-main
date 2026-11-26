import path from 'node:path';
import { children, descendants, first, nodeText, paragraphText, unsafe, limited, type SafeArchive, type XmlNode } from '@/src/lib/intelligence/knowledge/safeArchive';
import { blankPage, finishPage, MAX_PAGES, type ParsedPage, type ParserSession, type ExtractedMedia } from './protocol';
import { extractMedia } from './media';
const relNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rid = (n: XmlNode, name = 'id') => n.attrs[`{${relNamespace}}${name}`] ?? n.attrs[`r:${name}`];
export function relationships(archive: SafeArchive, part: string) {
  const rel = path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels');
  const result = new Map<string, { target: string; type: string; external: boolean }>();
  if (!archive.names.includes(rel)) return result;
  for (const n of descendants(archive.xml(rel), 'Relationship')) {
    const external = n.attrs.TargetMode === 'External', target = n.attrs.Target;
    if (!target || !n.attrs.Id || result.has(n.attrs.Id)) throw unsafe();
    const resolved = external ? '' : path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(part), target));
    if (!external && (resolved.startsWith('../') || !archive.names.includes(resolved))) throw unsafe();
    result.set(n.attrs.Id, { target: resolved, type: n.attrs.Type ?? '', external });
  } return result;
}
const geometry = (n: XmlNode) => {
  const transform = first(n, 'xfrm'), off = transform && children(transform, 'off')[0], ext = transform && children(transform, 'ext')[0];
  return off && ext ? { x: Number(off.attrs.x), y: Number(off.attrs.y), w: Number(ext.attrs.cx), h: Number(ext.attrs.cy) } : null;
};
function chart(archive: SafeArchive, part: string): ParsedPage['charts'][number] {
  const root = archive.xml(part), plot = first(root, 'plotArea'); if (!plot) throw unsafe();
  const types = plot.children.filter(n => /Chart$/.test(n.name));
  const type = types.length > 1 ? 'combo' : types[0]?.name === 'barChart' ? (first(types[0], 'barDir')?.attrs.val === 'bar' ? 'bar' : 'column') : types[0]?.name.replace('Chart', '') ?? 'unsupported';
  const series = types.flatMap(t => children(t, 'ser'));
  if (series.length > 10) throw limited();
  const cache = (node: XmlNode | undefined, numeric: boolean) => {
    if (!node) return [];
    const count = Number(first(node, 'ptCount')?.attrs.val ?? 0), points = descendants(node, 'pt');
    if (count > 200 || points.length > 200) throw limited();
    const values: (string | number | null)[] = Array.from({ length: count || points.length }, () => null);
    for (const p of points) { const i = Number(p.attrs.idx), raw = first(p, 'v')?.value ?? ''; if (!Number.isInteger(i) || i < 0 || i >= values.length) throw unsafe(); values[i] = numeric ? raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : null : raw; }
    return values;
  };
  const cat = series[0] && first(series[0], 'cat');
  const categories = cache(cat, false).map(v => v === null ? '' : String(v));
  const data = series.map((s, i) => ({ name: first(s, 'tx') ? descendants(first(s, 'tx')!, 'v').map(nodeText).join('') || paragraphText(first(s, 'tx')!) : `Series ${i + 1}`, unit: '', values: cache(first(s, 'val'), true) as (number | null)[] }));
  if (data.some(s => s.values.length !== categories.length)) throw unsafe();
  return { type, categories, series: data, cached: true };
}
export function pptxSession(archive: SafeArchive): ParserSession {
  const root = archive.xml('ppt/presentation.xml'), rels = relationships(archive, 'ppt/presentation.xml');
  const order = descendants(root, 'sldId').map(n => rels.get(rid(n) ?? '')).map(r => { if (!r || r.external || !r.type.endsWith('/slide')) throw unsafe(); return r.target; });
  if (!order.length || order.length > MAX_PAGES || new Set(order).size !== order.length) throw limited();
  const size = first(root, 'sldSz'), dimensions = size ? { width: Number(size.attrs.cx), height: Number(size.attrs.cy), unit: 'emu' as const } : null;
  return { count: order.length, close: async () => {}, page: async index => {
    const part = order[index]; if (!part) throw unsafe(); const source = archive.xml(part), refs = relationships(archive, part);
    const page = blankPage(index + 1, 'slide', `幻灯片 ${index + 1}`), media: ExtractedMedia[] = []; page.size = dimensions; page.hidden = ['0','false'].includes(source.attrs.show);
    page.notesPresent = [...refs.values()].some(r => r.type.endsWith('/notesSlide'));
    page.references = [...refs.values()].filter(r => /\/(slideLayout|slideMaster|theme)$/.test(r.type)).map(r => r.target);
    for (const r of [...refs.values()]) if (r.type.endsWith('/slideLayout') && !r.external) {
      const layoutRefs = relationships(archive, r.target); for (const m of layoutRefs.values()) if (m.type.endsWith('/slideMaster') && !m.external) { page.references.push(m.target); for (const t of relationships(archive, m.target).values()) if (t.type.endsWith('/theme') && !t.external) page.references.push(t.target); }
    }
    if ([...refs.values()].some(r => r.external)) page.warnings.push('含外部关系；未访问外部链接或加载外部对象。');
    const walk = async (node: XmlNode, groups: string[]) => {
      for (const n of node.children) {
        if (!['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp', 'contentPart'].includes(n.name)) continue;
        const prop = first(n, 'cNvPr');
        if (prop?.attrs.hidden === '1' || prop?.attrs.hidden === 'true') { page.hiddenObjects++; continue; }
        if (n.name === 'grpSp') { await walk(n, [...groups, prop?.attrs.id ?? 'group']); continue; }
        const box = geometry(n);
        if (groups.length && !page.warnings.includes('分组内坐标为局部坐标，结构预览不等于原页截图。')) page.warnings.push('分组内坐标为局部坐标，结构预览不等于原页截图。');
        if (n.name === 'sp') {
          const text = paragraphText(n), ph = first(n, 'ph')?.attrs.type, role = ['title', 'ctrTitle'].includes(ph ?? '') ? 'title' : ph === 'subTitle' ? 'subtitle' : 'body';
          if (text) { page.texts.push({ text, role, box, groups }); if (role === 'title' && !page.title) page.title = text; }
          const shape = first(n, 'prstGeom')?.attrs.prst; if (shape) page.shapes.push({ type: shape, box, groups });
          if (first(n, 'custGeom')) page.warnings.push('自定义矢量形状未重建；保留原件。');
        } else if (n.name === 'pic') {
          const blip = first(n, 'blip'), link = blip && refs.get(rid(blip, 'embed') ?? '');
          if (!link || link.external) { page.warnings.push('图片为外链或缺少内嵌数据，未抓取。'); continue; }
          try { const file = await extractMedia(link.target, archive.read(link.target)); media.push(file); page.images.push({ key: link.target, box, crop: first(n, 'srcRect')?.attrs ?? {}, groups }); }
          catch { page.warnings.push('图片格式、像素或大小不受支持；保留原件中的图片。'); }
        } else {
          const tbl = first(n, 'tbl'), graph = first(n, 'chart');
          if (tbl) {
            const rows = children(tbl, 'tr').map(r => children(r, 'tc').map(c => paragraphText(c) || null));
            if (!rows.length || rows.length > 201 || rows[0].length > 100) throw limited();
            if (descendants(tbl, 'tc').some(c => c.attrs.gridSpan || c.attrs.rowSpan || c.attrs.hMerge || c.attrs.vMerge)) page.warnings.push('表格含合并单元格；网格提取需人工核对。');
            page.tables.push({ columns: rows[0].map(v => v ?? ''), rows: rows.slice(1) });
          } else if (graph) {
            const r = refs.get(rid(graph) ?? ''); if (!r || r.external) { page.warnings.push('外部图表未加载。'); continue; }
            try { const data = chart(archive, r.target); page.charts.push(data); page.warnings.push('图表采用原文件缓存值，未刷新工作簿，需核对历史期间与单位。'); } catch { page.warnings.push('图表结构或数据无法可靠提取，未伪造数值。'); }
          } else page.warnings.push('SmartArt、OLE 或特殊图形未重建；请查看原件并人工补充。');
        }
      }
    };
    const tree = first(source, 'spTree'); if (!tree) throw unsafe(); await walk(tree, []);
    if (!page.title) page.title = page.texts[0]?.text.split('\n')[0] ?? `幻灯片 ${index + 1}`;
    return { page: finishPage(page), media };
  } };
}
export function docxSession(archive: SafeArchive): ParserSession {
  const root = archive.xml('word/document.xml'), body = first(root, 'body'); if (!body) throw unsafe();
  const rels = relationships(archive, 'word/document.xml'), items = body.children.filter(n => ['p', 'tbl'].includes(n.name));
  const sections: XmlNode[][] = []; let current: XmlNode[] = [];
  for (const n of items) { if (current.length && (current.length >= 30 || n.name === 'p' && /heading|标题/i.test(first(n, 'pStyle')?.attrs.val ?? ''))) { sections.push(current); current = []; } current.push(n); }
  if (current.length) sections.push(current); if (!sections.length || sections.length > MAX_PAGES) throw limited();
  return { count: sections.length, close: async () => {}, page: async i => {
    const section = sections[i]; if (!section) throw unsafe(); const start = items.indexOf(section[0]) + 1, page = blankPage(i + 1, 'word-section', `正文结构单元 ${start}–${start + section.length - 1}（非 Word 页码）`), media: ExtractedMedia[] = [];
    for (const n of section) {
      if(n.name==='tbl'&&descendants(n,'blip').length)page.warnings.push('表格中的嵌入图片未独立提取，保留原件供人工关联。');
      if (n.name === 'tbl') { const rows = children(n, 'tr').map(r => children(r, 'tc').map(c => {if(descendants(c,'vanish').length){page.hiddenObjects++;return null;}return paragraphText(c)||null;})); if (rows.length > 201) throw limited(); if (rows.length) page.tables.push({ columns: rows[0].map(v => v ?? ''), rows: rows.slice(1) }); continue; }
      if (descendants(n, 'vanish').length) { page.hiddenObjects++; continue; }
      const text = descendants(n, 't').map(nodeText).join(''), heading = /heading|标题/i.test(first(n, 'pStyle')?.attrs.val ?? '');
      if (text) page.texts.push({ text, role: heading ? 'title' : 'body', box: null, groups: [`body-unit:${items.indexOf(n) + 1}`] });
      if (descendants(n, 'del').length || descendants(n, 'ins').length) page.warnings.push('存在修订，提取结果需要人工核对，未视为最终稿。');
      for (const b of descendants(n, 'blip')) { const r = rels.get(rid(b, 'embed') ?? ''); if (!r || r.external) { page.warnings.push('外链图片未加载。'); continue; } try { media.push(await extractMedia(r.target, archive.read(r.target))); page.images.push({ key: r.target, box: null, crop: {}, groups: [] }); } catch { page.warnings.push('图片不受支持，保留原件。'); } }
    }
    page.title = page.texts.find(t => t.role === 'title')?.text ?? page.texts[0]?.text.split('\n')[0] ?? page.locator;
    page.notesPresent = archive.names.some(n => /^word\/(footnotes|endnotes|comments)[.]xml$/.test(n));
    if ([...rels.values()].some(r => r.external)) page.warnings.push('含外部关系；未访问。');
    return { page: finishPage(page), media };
  } };
}
