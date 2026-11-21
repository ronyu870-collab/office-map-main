import { RESEARCH_DOMAIN, RESEARCH_TOOL_SCHEMAS, researchTaskSchema } from './protocol';
import { reviewResearch, researchSections } from './workspace';
import { prepareReportResult } from '../agent/reportTool';
import { buildResultArtifact } from '../query/artifacts';
import type { QueryResult } from '../query/result';

export async function generateResearchDeliverable(workspace: QueryResult, raw: unknown, requestId: string) {
  const args = RESEARCH_TOOL_SCHEMAS.generate_research_deliverable.parse(raw);
  const task = researchTaskSchema.parse(workspace.parameters.researchTask);
  if (task.id !== args.taskId) throw new Error('RESEARCH_TASK_NOT_FOUND');
  if (args.purpose !== 'internal') throw new Error('REPORT_CLIENT_PUBLICATION_REQUIRES_SEPARATE_APPROVAL');
  const sections = researchSections(workspace), review = reviewResearch(task, sections.map(s => s.result));
  if (task.state !== 'reviewed' || task.steps.some(s => s.state !== 'complete') || !review.canGenerate) throw new Error('RESEARCH_REVIEW_REQUIRED');
  const base = prepareReportResult(sections.map(s => s.result), { resultIds: sections.map(s => s.result.resultId),
    charts: sections.filter(s => s.chart).map(s => ({ resultId: s.result.resultId, chart: s.chart })), purpose: 'internal' });
  const result: QueryResult = { ...base, parameters: { ...base.parameters, ...workspace.parameters,
    dataDomain: RESEARCH_DOMAIN, researchDeliverables: args.formats,
    agentReport: { ...(base.parameters.agentReport as object), version: 'research-output/1', format: args.formats[0] } } };
  const files = [];
  for (const format of args.formats) {
    const file = await buildResultArtifact(result, { requestId, resultId: result.resultId, action: 'export', format });
    if (file.type !== 'download') throw new Error('AGENT_EXPORT_NOT_GENERATED');
    files.push({ format, filename: file.filename, bytes: file.bytes.byteLength, sha256: file.sha256 });
  }
  return { result, content: JSON.stringify({ status: 'ready', state: 'server_generated', taskId: task.id, resultId: result.resultId,
    files, note: '服务器已生成内部研究文件，下载通过本条回答的可信操作；尚未发起浏览器下载，也未确认本机保存。对客发布须另行授权。' }) };
}
