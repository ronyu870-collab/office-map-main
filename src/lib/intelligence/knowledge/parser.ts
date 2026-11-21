import { createHash } from 'node:crypto';
import { chunkSchema, type DocumentChunk } from './protocol';
export const PARSER_VERSION = 'local-text/1';
const LIMIT = 4000000;
export function documentTokens(text: string): string[] {
    const values = new Set<string>();
    for (const word of text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[\p{Script=Latin}\p{N}]+/gu) ?? []) {
        if (/\p{Script=Han}/u.test(word)) {
            const chars = Array.from(word);
            for (let i = 0; i < chars.length - 1; i++)
                values.add(chars[i] + chars[i + 1]);
        }
        else
            values.add(word);
    }
    return [...values].sort();
}
export function chunkDocument(pages: {
    text: string;
    location: string;
    page: number | null;
}[]): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let total = 0;
    for (const p of pages) {
        const text = p.text.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').trim();
        total += text.length;
        if (total > LIMIT)
            throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
        for (let offset = 0; offset < text.length; offset += 1000) {
            const part = text.slice(offset, offset + 1120);
            if (!part.trim())
                continue;
            chunks.push(chunkSchema.parse({ ordinal: chunks.length, text: part, location: p.location + (offset ? ' · 字符 ' + (offset + 1) : ''), page: p.page }));
            if (chunks.length > 2000)
                throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
        }
    }
    return chunks;
}
// Only OpenXML text nodes are decoded. No DOM, macros, entity expansion, hyperlinks,
// relationships, embedded objects, external resources or document instructions execute.
export function xmlText(xml: string, tag: 'w:t' | 'a:t'): string {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new Error('KNOWLEDGE_UNSAFE_DOCUMENT');
    const decode = (v: string) => v.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, s => {
        const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
        if (named[s])
            return named[s];
        const n = s.startsWith('&#x') ? parseInt(s.slice(3, -1), 16) : parseInt(s.slice(2, -1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    });
    const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g');
    let out = '', previous = 0;
    for (const match of xml.matchAll(re)) {
        if (/<\/(?:w|a):p>/.test(xml.slice(previous, match.index)))
            out += '\n';
        out += decode(match[1]);
        previous = match.index! + match[0].length;
    }
    return out;
}
export async function parseDocument(bytes: Uint8Array, mime: string): Promise<DocumentChunk[]> {
    if (bytes.length > 24 * 1024 * 1024)
        throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
    if (mime === 'application/pdf') {
        if (Buffer.from(bytes.slice(0, 5)).toString() !== '%PDF-')
            throw new Error('KNOWLEDGE_UNSAFE_DOCUMENT');
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, useWorkerFetch: false });
        const pdf = await task.promise;
        try {
            let extracted = 0;
            if (pdf.numPages > 500)
                throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
            const pages = [];
            for (let page = 1; page <= pdf.numPages; page++) {
                const p = await pdf.getPage(page);
                const content = await p.getTextContent();
                const text = content.items.reduce((out, i) => { if (!('str' in i))
                    return out; const separator = out && !/\s$/.test(out) && !/^\s/.test(i.str) && !(/\p{Script=Han}$/u.test(out) && /^\p{Script=Han}/u.test(i.str)) ? ' ' : ''; return out + separator + i.str + (i.hasEOL ? '\n' : ''); }, '').trim();
                extracted += text.length;
                if (extracted > LIMIT)
                    throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
                pages.push({ text, page, location: '第 ' + page + ' 页' });
            }
            return chunkDocument(pages);
        }
        finally {
            await task.destroy();
        }
    }
    if (!mime.includes('openxmlformats-officedocument'))
        throw new Error('KNOWLEDGE_FORMAT_UNSUPPORTED');
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files);
    if (entries.length > 5000)
        throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
    // Inspect central-directory inflated sizes before JSZip/SheetJS allocates content.
    let inflated = 0;
    for (const e of entries) {
        const size = (e as unknown as {
            _data?: {
                uncompressedSize?: number;
            };
        })._data?.uncompressedSize ?? 0;
        inflated += size;
        if (size > LIMIT * 2 || inflated > 32 * 1024 * 1024 || e.name.includes('..') || e.name.startsWith('/'))
            throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
    }
    if (mime.endsWith('spreadsheetml.sheet')) {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(bytes, { type: 'array', cellFormula: true, cellHTML: false, cellNF: false, cellStyles: false, bookVBA: false, bookDeps: false });
        const parts = [];
        let cells = 0;
        for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
            if ((range.e.r + 1) * (range.e.c + 1) > 100000)
                throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
            for (let r = range.s.r; r <= range.e.r; r++) {
                const values = [];
                for (let c = range.s.c; c <= range.e.c; c++) {
                    if (++cells > 100000)
                        throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
                    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
                    if (cell?.f)
                        continue;
                    if (cell?.v !== undefined)
                        values.push(String(cell.v));
                }
                if (values.length)
                    parts.push({ text: values.join(' | '), location: '工作表 ' + name + ' · 第 ' + (r + 1) + ' 行', page: null });
            }
        }
        return chunkDocument(parts);
    }
    if (mime.endsWith('wordprocessingml.document')) {
        const entry = zip.file('word/document.xml');
        if (!entry)
            throw new Error('KNOWLEDGE_UNSAFE_DOCUMENT');
        const xml = await entry.async('string');
        if (/<!DOCTYPE|<!ENTITY/i.test(xml))
            throw new Error('KNOWLEDGE_UNSAFE_DOCUMENT');
        // Word pagination is layout-dependent: cite paragraph numbers, never invented pages.
        return chunkDocument([...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m, i) => ({ text: xmlText(m[0], 'w:t'), location: '正文第 ' + (i + 1) + ' 段', page: null })));
    }
    if (mime.endsWith('presentationml.presentation')) {
        const presentation = zip.file('ppt/presentation.xml'), relationships = zip.file('ppt/_rels/presentation.xml.rels');
        if (!presentation || !relationships)
            throw new Error('KNOWLEDGE_UNSAFE_DOCUMENT');
        const order = await presentation.async('string'), rels = await relationships.async('string');
        if (/<!DOCTYPE|<!ENTITY/i.test(order + rels))
            throw new Error('KNOWLEDGE_UNSAFE_DOCUMENT');
        const attr = (tag: string, name: string) => tag.match(new RegExp('(?:^|\\s)' + name + '=["\']([^"\']+)["\']'))?.[1];
        const targets = new Map<string, string>();
        for (const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
            const id = attr(m[0], 'Id'), target = attr(m[0], 'Target'), external = attr(m[0], 'TargetMode');
            if (id && target && external !== 'External' && /^slides\/slide\d+\.xml$/.test(target))
                targets.set(id, 'ppt/' + target);
        }
        const pages: Array<{
            text: string;
            location: string;
            page: number | null;
        }> = [];
        for (const m of order.matchAll(/<p:sldId\b[^>]*\/?>/g)) {
            const id = attr(m[0], 'r:id'), target = id ? targets.get(id) : null, entry = target ? zip.file(target) : null;
            if (!entry)
                throw new Error('KNOWLEDGE_UNSAFE_DOCUMENT');
            const page = pages.length + 1;
            if (page > 500)
                throw new Error('KNOWLEDGE_DOCUMENT_LIMIT');
            pages.push({ text: xmlText(await entry.async('string'), 'a:t'), location: '幻灯片 ' + page, page });
        }
        return chunkDocument(pages);
    }
    throw new Error('KNOWLEDGE_FORMAT_UNSUPPORTED');
}
export const bytesDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
