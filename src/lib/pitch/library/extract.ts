import { createHash } from 'node:crypto';
import { slideContentSchema, type SlideContent } from '../contracts/content';
import type { ParsedPage } from './protocol';
export const CATEGORY_RULES = [
  ['company', '公司介绍', /公司介绍|公司概况|company\s+(profile|overview)/i], ['team', '团队介绍', /团队|成员|team|our people/i],
  ['case', '代表案例', /案例|case stud|track record/i], ['macro', '宏观经济', /宏观|GDP|macroeconom/i],
  ['market', '房地产市场研究', /市场研究|租金|空置率|market research|vacancy/i], ['building', '楼宇项目介绍', /楼宇|项目介绍|building|property profile/i],
  ['competition', '竞争分析', /竞争|竞品|competition|competitor/i], ['service', '服务方案', /服务方案|service proposal/i],
  ['marketing', '营销方案', /营销|marketing/i], ['leasing', '招商策略', /招商|leasing strategy/i], ['implementation', '项目实施计划', /实施计划|项目计划|implementation|delivery plan/i],
] as const;
export function categoryCandidates(page: ParsedPage) {
  const titles = CATEGORY_RULES.filter(([, , rule]) => rule.test(page.title));
  const matches = titles.length ? titles : CATEGORY_RULES.filter(([, , rule]) => rule.test(page.texts.map(t => t.text).join('\n')));
  return matches.map(([code, label]) => ({ code, label, confidence: matches.length === 1 && titles.length ? 'title_match' : 'uncertain' }));
}
export function stableId(value: string) { const b = createHash('sha256').update(value).digest().subarray(0, 16); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128; const h = b.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; }
export type SourceInfo = { id: string; filename: string; version: number; language: string; data_as_of: string | null; sha256: string; is_test_data: boolean };
export function candidateContent(page: ParsedPage, pageId: string, doc: SourceInfo): { content: SlideContent | null; warnings: string[] } {
  if (page.hidden) return { content: null, warnings: ['隐藏页面不自动形成可发布业务资产。'] };
  if (!doc.data_as_of) return { content: null, warnings: ['业务日期未知；保留原件和结构，补充真实日期后再提取候选。'] };
  const sourceIds = [stableId(`${pageId}:source`)], blocks: SlideContent['blocks'] = [];
  const rawTitle = page.title || `${doc.filename} · ${page.locator}`, title = rawTitle.length <= 160 ? rawTitle : `${doc.filename.slice(0, 100)} · ${page.ordinal}`;
  for (const t of page.texts) {
    if (t.text === rawTitle && rawTitle === title) continue;
    for (const text of t.text.match(/[\s\S]{1,3900}/g) ?? []) if (text.trim()) blocks.push({ kind: 'paragraph', text, sourceIds });
  }
  for (const image of page.images) if (image.mediaId) blocks.push({ kind: 'image', mediaAssetId: image.mediaId, mediaVersion: 1, alt: page.title || doc.filename, sourceIds });
  for (const table of page.tables) {
    if (table.columns.length <= 12 && table.columns.every(c => c.trim()) && table.rows.length) blocks.push({ kind: 'table', columns: table.columns, rows: table.rows.map(r => r.map(c => typeof c === 'boolean' ? String(c) : c)), sourceIds });
    else return { content: null, warnings: ['表格表头、列数或空数据需人工整理；完整结构已保留。'] };
  }
  for (const chart of page.charts) {
    if (!['column', 'bar', 'line', 'pie', 'combo'].includes(chart.type) || !chart.categories.length || chart.series.some(s => !s.name.trim())) return { content: null, warnings: ['图表类型或缓存不完整，需人工整理；未伪造数据。'] };
    blocks.push({ kind: 'chart', chartType: chart.type as 'column', categories: chart.categories, series: chart.series, sourceIds });
  }
  if (!blocks.length && page.texts.length) blocks.push({ kind: 'paragraph', text: page.texts.map(t => t.text).join('\n'), sourceIds });
  if (!blocks.length || blocks.length > 50 || page.status === 'manual') return { content: null, warnings: ['内容为空、超出协议容量或需要人工读取；原始结构完整保留。'] };
  const result = slideContentSchema.safeParse({ protocol: 'colliers-pitch/1', locale: doc.language, title, blocks, dataAsOf: doc.data_as_of, disclosure: 'internal', isTestData: doc.is_test_data,
    sources: [{ id: sourceIds[0], kind: 'document', documentId: doc.id, pageId, label: `${doc.filename} · ${page.locator}`, locator: page.locator, version: String(doc.version), sha256: doc.sha256, dataAsOf: doc.data_as_of }] });
  return result.success ? { content: result.data, warnings: [] } : { content: null, warnings: ['完整结果超过标准内容协议容量，请人工拆分；原件未丢失。'] };
}
