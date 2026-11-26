import type { QueryResult } from '../query/result';

export const artifactLabels = { xlsx: 'Excel', csv_zip: 'CSV', png_zip: 'PNG', svg_zip: 'SVG', pdf: 'PDF', docx: 'Word', pptx: 'PPT' } as const;
type Format = keyof typeof artifactLabels;
const patterns: Record<Format, RegExp> = { xlsx: /Excel|xlsx/i, csv_zip: /CSV/i, png_zip: /PNG/i,
  svg_zip: /SVG/i, pdf: /PDF/i, docx: /Word|docx/i, pptx: /PPT|PowerPoint/i };

/** Output intent is not evidence of generation. Only server-produced descriptors
 * on the final deliverable count; a successful tool name alone is insufficient. */
export function requestedArtifactFormats(question: string): Format[] {
  if (/^(?:(?:请问|请介绍|请说明)\s*)?(?:如何实现|是否支持|支持哪些|你会做什么|你能做什么)/.test(question)
    || !/(?:生成|导出|下载|制作|输出|做成|转成|整理成|保存|给我|帮我|把|将)/.test(question)) return [];
  return (Object.keys(patterns) as Format[]).filter(format => [...question.matchAll(new RegExp(patterns[format].source, 'gi'))]
    .some(match => !/(?:不要|不用|不需要|无需|不必|而非|不是|别)(?:生成|导出|下载|制作)?\s*$/.test(question.slice(0, match.index))));
}

export function artifactFulfillment(question: string, result: QueryResult | undefined, deliveries: readonly QueryResult[] = []) {
  const requested = requestedArtifactFormats(question), available = new Set<Format>();
  for (const snapshot of deliveries.length ? deliveries : result ? [result] : []) {
    const p = snapshot.parameters;
    if (p.dataDomain === 'deep-research/1') {
      if (p.agentReport && Array.isArray(p.researchDeliverables)) for (const format of p.researchDeliverables)
        if (['xlsx', 'pdf', 'docx', 'pptx'].includes(format)) available.add(format as Format);
    } else {
      const exported = p.agentExport as { format?: string } | undefined;
      if (exported?.format === 'xlsx' || exported?.format === 'csv_zip') available.add(exported.format);
      const chart = p.agentChart as { format?: string } | undefined;
      if (chart?.format === 'png_zip' || chart?.format === 'svg_zip') available.add(chart.format);
      if ((p.agentReport as { format?: string } | undefined)?.format === 'pdf') available.add('pdf');
    }
  }
  const toolFor = (format: Format) => ['png_zip', 'svg_zip'].includes(format) ? 'export_chart'
    : format === 'pdf' ? 'generate_pdf_report' : ['docx', 'pptx'].includes(format) ? 'generate_research_deliverable' : 'export_table';
  return { requested, available: [...available], missing: requested.filter(f => !available.has(f)), toolFor };
}
