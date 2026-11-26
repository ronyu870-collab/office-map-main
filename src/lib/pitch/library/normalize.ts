import type { SlideContent } from '../contracts/content';
import type { LayoutId } from '../contracts/scene';
import { layoutSlides } from '../layout/engine';
import { LayoutError } from '../layout/metrics';
import type { DesignTheme } from '../design/theme';
export type NormalizedPart = { content: SlideContent; layoutId: LayoutId; variant: 'standard' | 'alternate'; blockIndices: number[]; changes: string[] };
/** Lossless conversion never invents an insight or updates historical facts. */
export async function normalizationPlan(content: SlideContent, theme: DesignTheme): Promise<NormalizedPart[]> {
  const parts: NormalizedPart[] = [], indexed = content.blocks.map((b, i) => ({ b, i }));
  const paragraphs = indexed.filter(({ b }) => b.kind === 'paragraph'), images = indexed.filter(({ b }) => b.kind === 'image');
  const add = (blocks: SlideContent['blocks'], indices: number[], layoutId: LayoutId, changes: string[] = []) => parts.push({ content: { ...content, blocks }, blockIndices: indices, layoutId, variant: blocks.length > 4 ? 'alternate' : 'standard', changes });
  if (paragraphs.length) add([...paragraphs.map(v => v.b), ...(images.length === 1 ? [images[0].b] : [])], [...paragraphs.map(v => v.i), ...(images.length === 1 ? [images[0].i] : [])], images.length === 1 ? 'image-text' : 'two-columns');
  if (!paragraphs.length || images.length !== 1) for (const { b, i } of images) add([b], [i], 'cover');
  for (const [i, b] of content.blocks.entries()) {
    if (['paragraph', 'image'].includes(b.kind)) continue;
    if (b.kind === 'table') add([b], [i], 'data-table');
    else if (b.kind === 'chart') add([b], [i], 'chart-insight');
    else if (b.kind === 'metric') add([b], [i], 'kpi');
    else if (b.kind === 'team') add([b], [i], 'team-profile');
    else if (b.kind === 'case') add([b], [i], 'case-study');
    else if (b.kind === 'timeline') add([b], [i], 'strategy-framework');
    else if (b.kind === 'insight') add([{ kind: 'paragraph', text: `${b.claim}\n${b.basis}\n${b.limitations.join('\n')}`, sourceIds: b.sourceIds }], [i], 'two-columns', ['insight_to_complete_text']);
    else throw new LayoutError('PITCH_NORMALIZE_MANUAL', '地图需要匹配分析与范围，请人工选择地图布局；原内容已保留。');
  }
  for (const p of parts) {
    try { await layoutSlides(p.content, theme, p.layoutId, p.variant); continue; }
    catch (error) {
      if (!(error instanceof LayoutError)) throw error;
      if (p.content.blocks.every(b => b.kind === 'chart')) {
        p.content = {...p.content, blocks:p.content.blocks.flatMap(b=>b.kind==='chart'?[{kind:'table' as const,columns:['分类 / Category',...b.series.map(s=>`${s.name}${s.unit?` (${s.unit})`:''}`)],rows:b.categories.map((c,index)=>[c,...b.series.map(s=>s.values[index])]),sourceIds:b.sourceIds}]:[])};
        p.layoutId='data-table';p.changes.push('chart_to_editable_table:readability');
        try { await layoutSlides(p.content,theme,p.layoutId,p.variant);continue; }catch(tableError){if(!(tableError instanceof LayoutError))throw tableError;}
      }
      if (!p.content.blocks.every(b => b.kind === 'table')) throw error;
      p.content = { ...p.content, blocks: p.content.blocks.flatMap(b => b.kind === 'table' ? b.rows.flatMap(row => {
        const full = row.map((v, i) => `${b.columns[i]}: ${v === null ? '—' : v}`).join('\n');
        return (full.match(/[\s\S]{1,3900}/g) ?? []).map(text => ({ kind: 'paragraph' as const, text, sourceIds: b.sourceIds }));
      }) : []) };
      p.layoutId = 'two-columns'; p.variant = 'standard'; p.changes.push('table_to_complete_text:capacity'); await layoutSlides(p.content, theme, p.layoutId);
    }
  }
  if (!parts.length) throw new LayoutError('PITCH_NORMALIZE_MANUAL', '没有可转换的完整内容，请人工修正。');
  return parts;
}
