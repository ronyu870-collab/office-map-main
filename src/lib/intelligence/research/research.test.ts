import { formalTrend, completedResearch } from './testFixtures';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ResearchExecution } from './execution';
import { RESEARCH_TOOL_SCHEMAS, researchPlan } from './protocol';
import { reviewResearch, researchObservation } from './workspace';
import { generateResearchDeliverable } from './deliverable';
import { STRUCTURED_DATA_SCHEMAS } from '../agent/toolRegistry';
import { BUSINESS_TOOL_SCHEMAS } from '../business/protocol';
import { leasePlanSchema } from '../lease/protocol';

describe('controlled multi-tool research execution', () => {
  it('resolves completed Shanghai quarters and compiles a bounded DAG solely from existing governed schemas', () => {
    const task = researchPlan({ submarkets: ['CBD', '金融街'], metrics: ['rent', 'vacancy', 'totalArea'], leases: 'quarter', supply: true, profiles: true, jointRentVacancy: true }, randomUUID(), new Date('2026-11-22T01:00:00Z'));
    expect(task.start).toEqual({ year: 2025, quarter: 4 }); expect(task.end).toEqual({ year: 2026, quarter: 3 });
    expect(task.steps.at(-1)?.dependsOn).toEqual(task.steps.slice(0, -1).map(s => s.id));
    for (const s of task.steps.slice(0, -1)) {
      const schema = s.tool === 'query_lease_transactions' ? leasePlanSchema
        : BUSINESS_TOOL_SCHEMAS[s.tool as keyof typeof BUSINESS_TOOL_SCHEMAS] ?? STRUCTURED_DATA_SCHEMAS[s.tool as keyof typeof STRUCTURED_DATA_SCHEMAS];
      expect(() => schema.parse(s.args), s.tool).not.toThrow();
    }
  });
  it('rejects ambiguous dates, oversized scope and model-injected SQL/data/content', () => {
    const base = { submarkets: ['CBD'] };
    for (const extra of [{ sql: 'select * from secret' }, { title: '租金999' }, { start: { year: 2026, quarter: 1 } }, { recentCompletedQuarters: 9 }, { submarkets: ['CBD', '金融街', '望京'] }]) expect(() => researchPlan({ ...base, ...extra }, randomUUID())).toThrow();
    expect(() => researchPlan({ submarkets: ['CBD', '金融街'], metrics: ['rent', 'vacancy', 'totalArea'], leases: 'industry', supply: true, profiles: true, jointRentVacancy: true, distribution: 'rent' }, randomUUID())).toThrow('RESEARCH_STEP_LIMIT');
    expect(() => RESEARCH_TOOL_SCHEMAS.generate_research_deliverable.parse({ taskId: randomUUID(), formats: ['docx'], conclusions: '猜测1000', path: '/private' })).toThrow();
  });
  it('checkpoints interruption after a successful read, resumes without repeating data and rejects stale cursors or corrupted dependencies', async () => {
    const run = new ResearchExecution(); run.plan({ submarkets: ['CBD'], metrics: ['rent', 'vacancy', 'totalArea'] });
    const controller = new AbortController(); let calls = 0;
    await expect(run.advance({ taskId: run.task!.id }, async () => { calls++; controller.abort(); return { content: '{}', result: formalTrend() }; }, controller.signal)).rejects.toThrow();
    expect(calls).toBe(1);
    const snapshot = run.checkpoint(true)!; expect(snapshot.parameters.researchTask).toMatchObject({ state: 'interrupted' });
    const restored = new ResearchExecution(snapshot);
    await expect(restored.advance({ taskId: run.task!.id }, async () => { throw Error('must not run'); }, new AbortController().signal)).rejects.toThrow('RESEARCH_CURSOR_CHANGED');
    await restored.advance({ taskId: run.task!.id, afterStep: 'market_rent' }, async (_, args) => { calls++; return { content: '{}', result: formalTrend(args.metric as 'vacancy') }; }, new AbortController().signal);
    restored.review({ taskId: run.task!.id }); expect(calls).toBe(3); expect(restored.results[0]).toEqual(run.results[0]);
    const tampered = structuredClone(snapshot); (tampered.parameters.researchTask as typeof run.task)!.steps[1].tool = 'arbitrary_sql';
    expect(() => new ResearchExecution(tampered)).toThrow('RESEARCH_PLAN_INVALID');
  });
  it('requires a completed review and explicit internal purpose, exposes progress metadata without private text', async () => {
    const run = new ResearchExecution(); run.plan({ submarkets: ['CBD'] });
    expect(() => run.review({ taskId: run.task!.id })).toThrow('RESEARCH_DEPENDENCY_PENDING');
    await expect(generateResearchDeliverable(run.checkpoint()!, { taskId: run.task!.id, formats: ['docx'] }, randomUUID())).rejects.toThrow('RESEARCH_REVIEW_REQUIRED');
    const complete = await completedResearch();
    await expect(generateResearchDeliverable(complete.checkpoint()!, { taskId: complete.task!.id, formats: ['pptx'], purpose: 'client' }, randomUUID())).rejects.toThrow('REPORT_CLIENT_PUBLICATION');
    const result = { ...complete.results[0], parameters: { ...complete.results[0].parameters, domain: 'knowledge-research/1', knowledgeBindings: [] } };
    const review = reviewResearch(complete.task!, [result, complete.results[1]]);
    expect(review.canGenerate).toBe(false); expect(review.issues.some(i => i.code === 'knowledge_not_licensed_for_deliverables')).toBe(true);
    expect(JSON.stringify(researchObservation(complete.checkpoint()!))).not.toContain('155.71');
  });
  it('distinguishes missing evidence from zero and keeps deterministic statements/source IDs without causal inference', async () => {
    const run = await completedResearch(), review = reviewResearch(run.task!, run.results);
    expect(review.canGenerate).toBe(true); expect(review.inferences).toEqual([]);
    for (const f of review.facts) expect(f.sourceIds.every(id => run.results.find(r => r.resultId === f.resultId)!.sources.some(s => s.id === id))).toBe(true);
    const missing = structuredClone(run.results[0]) as { -readonly [K in keyof typeof run.results[0]]: typeof run.results[0][K] };
    missing.table = { ...missing.table, rows: missing.table.rows.map(r => ({ ...r, cells: { ...r.cells } })) };
    (missing.table.rows[0].cells as Record<string, unknown>).value = { kind: 'unknown', state: 'missing', reason: 'no_sample', sourceIds: [] };
    expect(reviewResearch(run.task!, [missing, run.results[1]]).issues.some(i => i.code === 'missing_or_restricted_cells')).toBe(true);
    for (const key of ['usedCount', 'availableCount', 'denominator']) (missing.table.rows[0].cells as Record<string, unknown>)[key] = { kind: 'number', value: { numeric: 0, exact: { numerator: '0', denominator: '1' } }, sourceIds: [] };
    expect(reviewResearch(run.task!, [missing, run.results[1]]).canGenerate).toBe(true);
    (missing.table.rows[0].cells as Record<string, unknown>).value = { kind: 'number', value: { numeric: 0, exact: { numerator: '0', denominator: '1' } }, sourceIds: [] };
    expect(reviewResearch(run.task!, [missing, run.results[1]]).issues.some(i => i.code === 'numeric_evidence_missing')).toBe(true);
  });
});
