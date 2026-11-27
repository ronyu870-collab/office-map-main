import { randomUUID } from 'node:crypto';
import { RESEARCH_TOOL_SCHEMAS, researchPlan, researchTaskSchema, type ResearchTask } from './protocol';
import { buildResearchWorkspace, researchSections, reviewResearch, researchObservation } from './workspace';
import type { QueryResult } from '../query/result';
import type { AgentToolObservation } from '../agent/agentOrchestrator';

/** Request-local execution; encrypted owner-bound archives are the only resume input. */
export class ResearchExecution {
  task: ResearchTask | undefined;
  results: QueryResult[] = [];
  private readonly attempted = new Set<string>();
  constructor(restored?: QueryResult) {
    if (!restored) return;
    this.task = researchTaskSchema.parse(restored.parameters.researchTask);
    this.results = researchSections(restored).map(s => s.result);
    // Reconstruct the executable DAG from the bounded spec, not archived arbitrary tools.
    const expected = researchPlan(this.task.spec, this.task.id, new Date(this.task.createdAt));
    if (JSON.stringify(this.task.start) !== JSON.stringify(expected.start) || JSON.stringify(this.task.end) !== JSON.stringify(expected.end)
      || JSON.stringify(this.task.steps.map(({ id, tool, args, dependsOn }) => ({ id, tool, args, dependsOn })))
      !== JSON.stringify(expected.steps.map(({ id, tool, args, dependsOn }) => ({ id, tool, args, dependsOn })))) throw new Error('RESEARCH_PLAN_INVALID');
    const completed = this.task.steps.filter(s => s.id !== 'review' && s.state === 'complete');
    if (completed.length !== this.results.length || new Set(completed.map(s => s.resultId)).size !== completed.length
      || completed.some((s, i) => this.results[i]?.resultId !== s.resultId)) throw new Error('RESEARCH_CHECKPOINT_INCOMPLETE');
  }
  private current(id: string) {
    if (!this.task || this.task.id !== id) throw new Error('RESEARCH_TASK_NOT_FOUND');
    return this.task;
  }
  plan(raw: unknown) {
    if (this.task) throw new Error('RESEARCH_TASK_ALREADY_EXISTS');
    this.task = researchPlan(raw, randomUUID());
    return this.observation();
  }
  async advance(raw: unknown, run: (name: string, args: Record<string, unknown>) => Promise<AgentToolObservation<QueryResult>>, signal: AbortSignal) {
    const args = RESEARCH_TOOL_SCHEMAS.advance_research_task.parse(raw), task = this.current(args.taskId);
    const cursor = task.steps.filter(s => s.id !== 'review' && s.state === 'complete').at(-1)?.id ?? null;
    if (args.afterStep !== cursor) throw new Error('RESEARCH_CURSOR_CHANGED');
    task.state = 'running';
    // Two real tools per advance bounds latency without raising Agent budgets.
    for (let i = 0; i < 2; i++) {
      signal.throwIfAborted();
      const step = task.steps.find(s => s.id !== 'review' && s.state !== 'complete' && !this.attempted.has(s.id));
      if (!step) break;
      if (step.dependsOn.some(id => task.steps.find(s => s.id === id)?.state !== 'complete')) throw new Error('RESEARCH_DEPENDENCY_PENDING');
      this.attempted.add(step.id);
      step.state = 'running'; delete step.error;
      try {
        const observed = await run(step.tool, step.args);
        if (!observed.result) throw new Error('RESEARCH_NO_VERIFIED_RESULT');
        // Keep results even if interruption arrives immediately after a successful read.
        const position = task.steps.slice(0, task.steps.indexOf(step)).filter(s => s.state === 'complete').length;
        this.results.splice(position, 0, observed.result);
        step.resultId = observed.result.resultId;
        step.state = 'complete';
      } catch (error) {
        step.state = signal.aborted ? 'pending' : 'blocked'; task.state = signal.aborted ? 'interrupted' : 'blocked';
        const code = error instanceof Error ? error.message : '';
        const recoverable = /^(?:QUERY_READ_UNAVAILABLE|LEASE_READ_UNAVAILABLE|KNOWLEDGE_(?:ORIGINAL_UNAVAILABLE|PUBLIC_SEARCH_(?:DISABLED|UNAVAILABLE))|RESEARCH_(?:NO_VERIFIED_RESULT|STEP_NOT_AUTHORIZED))$/.test(code);
        step.error = code === 'RESEARCH_STEP_NOT_AUTHORIZED' || code === 'QUERY_DENIED' ? code : 'SOURCE_UNAVAILABLE';
        if (signal.aborted || !recoverable) throw error;
      } finally { task.updatedAt = new Date().toISOString(); }
    }
    if (task.steps.some(step => step.state === 'blocked')) task.state = 'blocked';
    return this.observation();
  }
  review(raw: unknown) {
    const { taskId } = RESEARCH_TOOL_SCHEMAS.review_research_task.parse(raw), task = this.current(taskId);
    const review = reviewResearch(task, this.results);
    if (!review.completeScope) throw new Error('RESEARCH_DEPENDENCY_PENDING');
    task.steps.find(s => s.id === 'review')!.state = 'complete'; task.state = 'reviewed'; task.updatedAt = new Date().toISOString();
    return this.observation();
  }
  checkpoint(interrupted = false) {
    if (!this.task) return undefined;
    return buildResearchWorkspace(this.task, this.results, interrupted);
  }
  observation() {
    const result = this.checkpoint()!;
    return { result, content: JSON.stringify({ ...researchObservation(result),
      afterStep: this.task!.steps.filter(s => s.id !== 'review' && s.state === 'complete').at(-1)?.id ?? null,
      canAdvance: this.task!.steps.some(s => s.id !== 'review' && s.state !== 'complete' && !this.attempted.has(s.id)) }) };
  }
}
