import { z } from 'zod';
import type { QueryResult } from '../query/result';

const topic = z.enum(['rent', 'vacancy', 'area', 'leases', 'supply', 'buildings', 'documents', 'charts', 'reports']);
const format = z.enum(['pdf', 'xlsx', 'csv', 'docx', 'pptx', 'png', 'svg']);
export const agentMemorySchema = z.strictObject({ version: z.literal('agent-memory/1'), turns: z.number().int().min(1).max(100000),
  topics: z.array(topic).max(9), preferences: z.strictObject({ language: z.literal('zh-CN'), requestedFormats: z.array(format).max(7) }),
  research: z.strictObject({ taskId: z.string().max(100), state: z.string().max(40) }).nullable(),
  results: z.array(z.strictObject({ resultId: z.string().max(100), version: z.string().max(200) })).max(8),
  files: z.array(z.strictObject({ format, resultId: z.string().max(100) })).max(8),
  factPolicy: z.literal('references_require_current_authorization'),
});
export type AgentMemory = z.infer<typeof agentMemorySchema>;

/** Deterministic semantic compression, no supplier call, no copied business
 * claims, tenant names, raw document text or credentials in long-term memory. */
export function nextAgentMemory(previous: unknown, question: string, result?: QueryResult): AgentMemory {
  const prior = agentMemorySchema.safeParse(previous).data;
  const topics = new Set<z.infer<typeof topic>>(prior?.topics ?? []);
  const patterns = { rent: /租金/, vacancy: /空置/, area: /面积/, leases: /成交/, supply: /供应/,
    buildings: /楼宇|大厦|楼座/, documents: /楼书|资料|文档/, charts: /图表|折线|柱状|散点/, reports: /报告|研究/ };
  for (const [key, pattern] of Object.entries(patterns)) if (pattern.test(question)) topics.add(key as z.infer<typeof topic>);
  const requestedFormats = new Set(prior?.preferences.requestedFormats ?? []);
  for (const [key, pattern] of Object.entries({ pdf: /PDF/i, xlsx: /Excel|xlsx/i, csv: /CSV/i, docx: /Word|docx/i,
    pptx: /PPT|PowerPoint/i, png: /PNG/i, svg: /SVG/i })) if (pattern.test(question)) requestedFormats.add(key as z.infer<typeof format>);
  const task = result?.parameters.researchTask as { id?: string; state?: string } | undefined;
  const generated = new Set(z.array(format).safeParse(result?.parameters.researchDeliverables).data ?? []);
  for (const key of ['agentExport', 'agentReport', 'agentChart']) {
    const descriptor = result?.parameters[key] as { format?: string } | undefined;
    const value = descriptor?.format?.replace(/_zip$/, '');
    const parsed = format.safeParse(value);
    if (parsed.success) generated.add(parsed.data);
  }
  return agentMemorySchema.parse({ version: 'agent-memory/1', turns: Math.min(100000, (prior?.turns ?? 0) + 1),
    topics: [...topics], preferences: { language: 'zh-CN', requestedFormats: [...requestedFormats] },
    research: task?.id && task.state ? { taskId: task.id, state: task.state } : prior?.research ?? null,
    results: result ? [...(prior?.results ?? []).filter(r => r.resultId !== result.resultId), { resultId: result.resultId, version: result.dataVersion }].slice(-8) : prior?.results ?? [],
    files: result && generated.size ? [...(prior?.files ?? []), ...[...generated].map(format => ({ format, resultId: result.resultId }))].slice(-8) : prior?.files ?? [],
    factPolicy: 'references_require_current_authorization' });
}
