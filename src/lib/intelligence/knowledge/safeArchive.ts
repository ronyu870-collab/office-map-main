import JSZip from 'jszip';
import { inflateRawSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
export class DocumentError extends Error {
  constructor(public readonly code: string, public readonly detail: string) { super(code); }
}
export const unsafe = () => new DocumentError('PITCH_UNSAFE_DOCUMENT', '文档损坏、加密或包含不安全结构；原件保留，未执行其中内容。');
export const limited = () => new DocumentError('PITCH_DOCUMENT_LIMIT', '文档超过解析容量，请拆分文件或页面后重新导入。');
export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; value: string };
export function parseXml(value: string): XmlNode {
  if (value.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(value)) throw unsafe();
  const root: XmlNode = { name: '#root', attrs: {}, children: [], value: '' }, stack = [root]; let count = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', () => { throw unsafe(); });
  parser.on('opentag', tag => {
    if (++count > 150000 || stack.length > 64) throw limited();
    const node: XmlNode = { name: tag.local, attrs: {}, children: [], value: '' };
    for (const attr of Object.values(tag.attributes)) {
      // Expanded names remain available; local aliases support arbitrary prefixes.
      node.attrs[attr.name] = attr.value; node.attrs[`{${attr.uri}}${attr.local}`] = attr.value;
      if (!(attr.local in node.attrs)) node.attrs[attr.local] = attr.value;
    }
    stack.at(-1)!.children.push(node); stack.push(node);
  });
  parser.on('text', text => { stack.at(-1)!.value += text; });
  parser.on('cdata', text => { stack.at(-1)!.value += text; });
  parser.on('closetag', () => { stack.pop(); });
  try { parser.write(value).close(); } catch (e) { if (e instanceof DocumentError) throw e; throw unsafe(); }
  if (root.children.length !== 1) throw unsafe(); return root.children[0];
}
export const children = (n: XmlNode, name: string) => n.children.filter(c => c.name === name);
export function descendants(n: XmlNode, name: string): XmlNode[] { return n.children.flatMap(c => [...(c.name === name ? [c] : []), ...descendants(c, name)]); }
export const first = (n: XmlNode, name: string) => descendants(n, name)[0];
export const nodeText = (n: XmlNode): string => n.value + n.children.map(nodeText).join('');
export function paragraphText(n: XmlNode) { return descendants(n, 'p').map(p => descendants(p, 't').map(nodeText).join('')).filter(Boolean).join('\n'); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; }
export async function openSafeArchive(bytes: Uint8Array, requireContentTypes = true) {
  const data = Buffer.from(bytes); if (data.length < 22 || data.length > 24 * 1024 * 1024) throw unsafe();
  let end = data.length - 22; for (; end >= Math.max(0, data.length - 65557); end--) if (data.readUInt32LE(end) === 0x06054b50 && end + 22 + data.readUInt16LE(end + 20) === data.length) break;
  if (end < Math.max(0, data.length - 65557) || data.readUInt32LE(end) !== 0x06054b50 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) throw unsafe();
  const count = data.readUInt16LE(end + 10), offset = data.readUInt32LE(end + 16), length = data.readUInt32LE(end + 12);
  if (count > 2000 || offset + length > end || count === 0xffff) throw limited();
  const entries = new Map<string, { start: number; compressed: number; size: number; method: number; crc: number }>(); let at = offset, total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || data.readUInt32LE(at) !== 0x02014b50) throw unsafe();
    const flags = data.readUInt16LE(at + 8), method = data.readUInt16LE(at + 10), compressed = data.readUInt32LE(at + 20), size = data.readUInt32LE(at + 24), nameLength = data.readUInt16LE(at + 28), extraLength = data.readUInt16LE(at + 30), comment = data.readUInt16LE(at + 32), local = data.readUInt32LE(at + 42);
    const name = data.subarray(at + 46, at + 46 + nameLength).toString('utf8'); total += size;
    if (flags & 1 || ![0, 8].includes(method) || entries.has(name) || /(^\/|\\|(^|\/)\.\.(\/|$)|\u0000|^[A-Za-z]:)/.test(name)) throw unsafe();
    if (size > 16 * 1024 * 1024 || total > 64 * 1024 * 1024 || size > Math.max(compressed * 200, 1024 * 1024) || local + 30 > offset) throw limited();
    if (data.readUInt32LE(local) !== 0x04034b50 || data.readUInt16LE(local + 6) & 1 || data.readUInt16LE(local + 8) !== method) throw unsafe();
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    if (start + compressed > offset) throw unsafe();
    entries.set(name, { start, compressed, size, method, crc: data.readUInt32LE(at + 16) }); at += 46 + nameLength + extraLength + comment;
  }
  if (at !== offset + length) throw unsafe();
  // JSZip validates the container, but decompression below has a hard output cap
  // independent of potentially forged central-directory uncompressed sizes.
  try { await JSZip.loadAsync(data); } catch { throw unsafe(); }
  const read = (name: string) => {
    const e = entries.get(name); if (!e) throw unsafe();
    let result: Buffer; try { const source = data.subarray(e.start, e.start + e.compressed); result = e.method === 0 ? source : inflateRawSync(source, { maxOutputLength: Math.min(e.size + 1, 16 * 1024 * 1024) }); } catch { throw unsafe(); }
    if (result.length !== e.size || crc32(result) !== e.crc) throw unsafe(); return new Uint8Array(result);
  };
  const text = (name: string) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(read(name)); } catch { throw unsafe(); } };
  const names = [...entries.keys()];
  const types = names.includes('[Content_Types].xml') ? parseXml(text('[Content_Types].xml')) : requireContentTypes ? (() => { throw unsafe(); })() : {children:[]};
  const activeType = types.children.some(n => /macroEnabled|vbaProject/i.test(n.attrs.ContentType ?? '') && (n.name === 'Override' ? names.includes((n.attrs.PartName ?? '').replace(/^\//, '')) : names.some(name => name.endsWith('.' + n.attrs.Extension))));
  if (names.some(n => /vbaProject|activeX\//i.test(n)) || activeType) throw new DocumentError('PITCH_MACRO_UNSUPPORTED', '含宏文档不受支持，未执行宏。');
  return { names, read, text, xml: (name: string) => parseXml(text(name)) };
}
export type SafeArchive = Awaited<ReturnType<typeof openSafeArchive>>;
