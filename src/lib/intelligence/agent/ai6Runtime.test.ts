import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resumesResearch, routeTask } from './taskRouting';
import { runAgentLoop, agentInstructions } from './agentOrchestrator';
import { structuredQueryPlan } from './structuredQueryPlan';
import { parseAgentToolArguments } from './toolRegistry';
import { createModelRuntime, modelToolCatalogue } from './modelRuntime';
import { compactModelContext, modelContextEnvelope } from './modelContext';
import { ModelProviderError } from './modelProvider';
import { AGENT_TOOLS } from './modelProvider';
import { summarizeModelOperations } from './modelOperationsView';
import { executeQueryPlan } from '../query/executePlan';
import { fixture, nameSource } from '../query/__tests__/fixtures';
import { buildListResult } from '../query/result';
import { resultViewSchema } from '../query/presentation';
import { tableRowIndexes, validatedResultTableView } from '../query/tableView';
import { buildResultArtifact } from '../query/artifacts';
import { prepareExportResult } from './exportTableTool';
import { describePlanRead } from '../query/snapshotReader';
import { parseQueryPlan } from '../query/plan';
import type { AgentMessage } from './modelProtocol';
import { resolveBusinessQuestion } from '../query/question';

const question = '2026Q2全部获权楼宇净有效租金按子市场比较';
const exportQuestion = '把CBD在2026Q2净有效租金最高的10栋楼导出Excel';
const signal = () => new AbortController().signal;
const plan = parseQueryPlan({ operation: 'aggregate', metric: 'rent', scope: { inventory: 'tracked', submarkets: ['CBD'] }, period: { year: 2026, quarter: 2 } });
const completion = (inputTokens = 100) => ({ provider: 'deepseek' as const, model: 'deepseek-flash', inputTokens, outputTokens: 20, message: { role: 'assistant' as const, content: '合成供应商响应' } });
afterEach(() => vi.unstubAllEnvs());

describe('AI6 full-condition execution routing', () => {
  it.each(['你好', 'Hello', '谢谢', 'Thank you', '你能做什么', 'what can you do', '你是谁'])('routes a complete social turn without a model: %s', async q => {
    const invoke = vi.fn(); const runTool = vi.fn();
    const out = await runAgentLoop({ question: q, taskRoute: routeTask(q), invoke, runTool, signal: signal() });
    expect(out.executionStatus).toBe('completed'); expect(out.calls).toBe(0); expect(out.toolCalls).toBe(0);
    expect(invoke).not.toHaveBeenCalled(); expect(runTool).not.toHaveBeenCalled();
  });
  it('reads current capability metadata without calling a model or claiming data coverage', async () => {
    const invoke = vi.fn(), runTool = vi.fn().mockResolvedValue({ content: JSON.stringify({ status: 'ready', authority: { fields: [{ label: '建筑高度' }] } }) });
    const out = await runAgentLoop({ question: '你有哪些数据权限', taskRoute: routeTask('你有哪些数据权限'), invoke, runTool, signal: signal() });
    expect(invoke).not.toHaveBeenCalled(); expect(runTool.mock.calls[0][0]).toBe('get_data_capabilities');
    expect(out.executionStatus).toBe('completed'); expect(out.answer).toContain('建筑高度'); expect(out.answer).toContain('不保证');
  });
  it('lists field-specific data quarters without confusing the calendar with available data', async () => {
    const runTool = vi.fn().mockResolvedValue({ content: JSON.stringify({ status: 'ready', authority: {},
      availablePeriods: [{ label: '净有效租金', periods: ['2026Q2'], truncated: true }] }) }), invoke = vi.fn();
    const q = '你能够查询哪些季度';
    const out = await runAgentLoop({ question: q, taskRoute: routeTask(q), invoke, runTool, signal: signal() });
    expect(invoke).not.toHaveBeenCalled(); expect(runTool.mock.calls[0][1]).toEqual({ includePeriods: true });
    expect(out.answer).toContain('2026Q2'); expect(out.answer).toContain('仅最近40期'); expect(out.answer).toContain('不代表每栋楼');
  });
  it('preserves period, metric, grouping and all-authorized population across both planners', () => {
    const task = routeTask(question);
    expect(task).toMatchObject({ route: 'deterministic_query', plan: { operation: 'group_aggregate', metric: 'rent', groupBy: 'submarket', period: { year: 2026, quarter: 2 }, scope: { inventory: 'all_authorized' } } });
    const legacy = resolveBusinessQuestion(question);
    expect(legacy.kind === 'plan' && legacy.plan).toEqual(task.plan);
  });
  it.each([
    '2026Q2全部获权楼宇空置率按子市场比较', '2026Q2 all authorized buildings net effective rent by submarket', 'CBD vacancy rate in 2026Q2', 'top 5 tallest buildings in CBD', 'list all buildings in CBD', 'CBD建筑高度排名前5',
    '2026Q2 CBD净有效租金', '2026Q2 CBD净有效租金和空置率按子市场比较', exportQuestion,
  ])('consumes the complete deterministic task: %s', q => expect(routeTask(q).route).toBe('deterministic_query'));
  it.each([
    '比较2026Q2 CBD和金融街净有效租金，但排除乙级楼宇，再生成图表',
    '2026Q2 CBD净有效租金，只看LEED楼宇', '2026Q2 CBD net effective rent excluding grade B', '2026Q2 CBD净有效租金并解释原因',
    '生成包含成交、楼书和季度统计的研究报告',
  ])('does not drop unsupported or multi-domain requirements: %s', q => expect(routeTask(q).route).not.toBe('deterministic_query'));
  it.each(['什么是净有效租金', '如何计算空置率', '请写一封邮件解释净有效租金'])('does not turn conceptual discussion into a database query: %s', q => {
    expect(routeTask(q).route).toBe('bounded_agent'); expect(modelToolCatalogue(q, 'deep', [])).toHaveLength(0);
  });
  it('resumes a verbatim research retry while a new business question stays independent', () => {
    const previous = '研究 CBD 近四季度租金、空置率和面积，生成内部 Word、PPT、PDF 与 Excel。';
    expect(resumesResearch(previous, previous)).toBe(true);
    expect(resumesResearch('继续刚才的研究', previous)).toBe(true);
    expect(resumesResearch('查询CBD楼宇清单', previous)).toBe(false);
    expect(resumesResearch('制作金融街四季度专项研究报告', previous)).toBe(false);
  });
  it('routes unresolved hard site conditions for interpretation and respects explicit map exclusion', () => {
    const base = 'CBD选址租赁2000平方米，预算300元/平方米/月';
    expect(routeTask(base + '，地铁步行800米内，不要地图')).toMatchObject({ route: 'deterministic_query',
      siteSelection: { walkMeters: 800, mapRequested: false } });
    for (const condition of ['必须具备独立电梯', '要能办环评', '指定在国贸站2号口附近']) {
      expect(routeTask(`${base}，${condition}，不要地图`).siteSelection).toBeUndefined();
    }
  });
  it.each([['步行800米内办公选址', '800'], ['帮我找写字楼，步行不超过500米', '500']])(
    'requests an anchor when the walk question has no destination: %s', async (question, distance) => {
      const invoke = vi.fn(), runTool = vi.fn();
      const out = await runAgentLoop({ question, taskRoute: routeTask(question), invoke, runTool, signal: signal() });
      expect(out.executionStatus).toBe('limited');
      expect(out.result).toBeUndefined();
      expect(out.answer).toContain(`${distance} 米`);
      expect(out.answer).toContain('直线距离初筛');
      expect(invoke).not.toHaveBeenCalled();
      expect(runTool).not.toHaveBeenCalled();
    },
  );
  it('recognizes named and nearest metro screening without silently dropping extra criteria', () => {
    expect(routeTask('地铁国贸站步行不超过800米的办公选址，给出地图链接')).toMatchObject({ route: 'deterministic_query',
      metroSelection: { radiusMeters: 800, stationName: '国贸', mapRequested: true }, walkingRouteUnavailable: true });
    expect(routeTask('帮我找写字楼，距地铁站步行不超过500米，不要地图')).toMatchObject({ route: 'deterministic_query',
      metroSelection: { radiusMeters: 500, mapRequested: false }, walkingRouteUnavailable: true });
    expect(routeTask('在中关村地铁站步行不超过800米的办公选址').metroSelection).toMatchObject({ stationName: '中关村', submarkets: undefined });
    expect(routeTask('在望京地铁站步行不超过800米的办公选址').metroSelection).toMatchObject({ stationName: '望京', submarkets: undefined });
    expect(routeTask('在望京西站步行800米内办公选址').metroSelection).toMatchObject({ stationName: '望京西', submarkets: undefined });
    expect(routeTask('请帮我找国贸地铁站步行不超过800米的办公楼').metroSelection).toMatchObject({ stationName: '国贸', submarkets: undefined });
    expect(routeTask('在CBD地铁步行不超过800米的办公选址').metroSelection).toMatchObject({ stationName: undefined, submarkets: ['CBD'] });
    expect(routeTask('在CBD，地铁站步行不超过800米的办公选址').metroSelection).toMatchObject({ stationName: undefined, submarkets: ['CBD'] });
    expect(routeTask('在中关村，地铁站步行800米内办公选址').metroSelection).toMatchObject({ stationName: undefined, submarkets: ['中关村'] });
    expect(routeTask('在国贸地铁站，步行不超过800米的办公选址').metroSelection).toMatchObject({ stationName: '国贸', submarkets: undefined });
    expect(routeTask('在中关村地铁站，步行800米内办公选址').metroSelection).toMatchObject({ stationName: '中关村', submarkets: undefined });
    expect(routeTask('地铁国贸站步行800米内找办公室，必须有独立电梯').metroSelection).toBeUndefined();
  });
  it('keeps report-period policy tasks out of the narrow semantic extractor', () => {
    const q = '查询最近一个已结束季度的净有效租金，用于内部报告。';
    expect(routeTask(q).route).toBe('bounded_agent');
    expect(modelToolCatalogue(q, 'professional', []).some(tool => tool.name === 'query_report_market')).toBe(true);
  });
  it('preserves chart-axis instructions for tool orchestration', () => {
    expect(routeTask('净有效租金为横轴，空置率为纵轴。').route).toBe('bounded_agent');
    expect(routeTask('net effective rent on x axis, vacancy rate on y axis').route).toBe('bounded_agent');
  });
  it('keeps an explicit new scope independent of old building IDs and inventory', () => {
    const prior = { ...plan, scope: { inventory: 'tracked' as const, submarkets: ['CBD'], buildingIds: [randomUUID()] } };
    expect(routeTask(question, prior).plan?.scope).toEqual({ inventory: 'all_authorized' });
    expect(routeTask('换成2026Q3', plan).plan).toMatchObject({ period: { year: 2026, quarter: 3 }, metric: 'rent', scope: plan.scope });
  });
  it.each(['什么是净有效租金？以 2026Q2 CBD 的实际数据为例。', '请问净有效租金是什么意思？用 2026Q2 CBD 的正式数据举例。'])
    ('resolves a concept with a naturally phrased, explicit quarterly example: %s', request => {
      const task = routeTask(request);
      expect(task).toMatchObject({ route: 'deterministic_query', conceptExample: true,
        plan: { operation: 'aggregate', metric: 'rent', period: { year: 2026, quarter: 2 }, scope: { submarkets: ['CBD'] } } });
    });
  it('only reuses server-imported previous results for exports and chart generation', () => {
    expect(routeTask('把刚才的结果导出Excel', plan, false, true)).toMatchObject({ reusePrevious: true, exportFormat: 'xlsx' });
    expect(routeTask('把刚才的结果画成图', plan, false, true)).toMatchObject({ reusePrevious: true, chartType: 'auto' });
    expect(routeTask('把刚才的结果导出Excel', plan).route).toBe('bounded_agent');
  });
  it.each([
    ['把刚才的结果导出Excel', false],
    ['请把刚才三份结果分别放到一个 Excel 工作簿', true],
    ['将前面的3个结果导出为同一个xlsx，每份一张工作表', true],
  ])('exports all rechecked prior results without asking a model: %s', async (request, separateSheets) => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const task = routeTask(request, plan, false, false, undefined, false, ids.length);
    expect(task).toMatchObject({ route: 'deterministic_query', reusePriorExport: separateSheets ? 'separate' : 'auto', exportFormat: 'xlsx' });
    const invoke = vi.fn(), runTool = vi.fn().mockResolvedValue({ result: buildListResult(fixture(), []), content: '{"status":"ready"}' });
    await runAgentLoop({ question: request, taskRoute: task, priorExportResultIds: ids, invoke, runTool, signal: signal() });
    expect(invoke).not.toHaveBeenCalled();
    expect(runTool).toHaveBeenCalledExactlyOnceWith('export_table', { resultIds: ids, format: 'xlsx', filters: [], singleSheet: false,
      ...(separateSheets ? { separateSheets: true } : {}) }, expect.any(AbortSignal));
  });
  it('keeps a missing sheet or additional deliverable visible', () => {
    expect(routeTask('把刚才三份结果分别放到一个Excel', plan, false, true, undefined, false, 2))
      .toMatchObject({ route: 'direct_response', reply: expect.stringContaining('2 份') });
    expect(routeTask('把刚才三份结果分别放到一个Excel，再生成一份PDF', plan, false, true, undefined, false, 3).reusePriorExport)
      .toBeUndefined();
  });
  it('applies complete sort, numeric filter and page edits only to an existing authorized column', async () => {
    const prior = resultViewSchema.parse(buildListResult(fixture(), ['height', 'netEffectiveRent']));
    const sorted = routeTask('按高度从高到低排列', undefined, false, true, prior);
    expect(sorted).toMatchObject({ route: 'deterministic_query', tableView: { sort: { key: 'height', direction: 'desc' } } });
    expect(routeTask('按高度从高到低排列并删除所有来源', undefined, false, true, prior).tableView).toBeUndefined();
    expect(routeTask('筛选建筑高度至少200平方米', undefined, false, true, prior).tableView).toBeUndefined();
    const task = routeTask('筛选建筑高度至少200米', undefined, false, true, prior);
    const view = validatedResultTableView(prior, task.tableView);
    expect(tableRowIndexes(prior, '', view.filters, view.sort).map(i => prior.table.rows[i].cells.name)).toMatchObject([{ value: 'A座' }]);
    const invoke = vi.fn(), runTool = vi.fn().mockImplementation(async () => ({ result: prior, content: '{"status":"ready"}' }));
    await runAgentLoop({ question: task.question, taskRoute: task, previousResultId: prior.resultId, invoke, runTool, signal: signal() });
    expect(invoke).not.toHaveBeenCalled(); expect(runTool.mock.calls.map(c => c[0])).toEqual(['select_answer_results', 'apply_result_view']);
    expect(routeTask('下一页', undefined, false, true, prior).tableView?.page).toBe(1);
    const charted = { ...prior, parameters: { ...prior.parameters, agentChart: { version: 'chart-workspace/1', request: { kind: 'bar', field: 'height' } } } };
    expect(routeTask('导出PNG', undefined, false, true, charted)).toMatchObject({ route: 'deterministic_query', chartExport: 'png_zip', reusePrevious: true });
    expect(routeTask('导出PNG', undefined, false, true, prior).chartExport).toBeUndefined();
  });
  it('exposes the complete formal plan with strict, bounded server validation', () => {
    const task = routeTask(question);
    expect(structuredQueryPlan('execute_query_plan', { plan: task.plan }).plan).toEqual(task.plan);
    expect(structuredQueryPlan('compare_market_segments', { period: { year: 2026, quarter: 2 }, metric: 'rent', inventory: 'all_authorized' }).plan).toEqual(task.plan);
    expect(() => parseAgentToolArguments('execute_query_plan', { plan: { ...task.plan, sql: 'select 1' } })).toThrow();
    expect(() => parseAgentToolArguments('compare_market_segments', { scope: { inventory: 'tracked' }, submarkets: ['CBD', '金融街'], period: { year: 2026, quarter: 2 }, metric: 'rent' })).toThrow();
  });
});

describe('AI6 actual formal result, artifact and partial delivery', () => {
  it('queries the formal engine and generates a readable Excel without invoking a supplier', async () => {
    const task = routeTask(exportQuestion); expect(task.plan?.operation).toBe('rank');
    const snapshot = fixture({ year: 2026, quarter: 2 });
    const ids = new Map(snapshot.rows.map(row => [row.id, randomUUID()]));
    const rewrite = (s: (typeof snapshot.rows)[number]['nameSource']) => ({ ...s, entityId: ids.get(s.entityId)!, recordId: ids.get(s.entityId)! });
    const rows = snapshot.rows.map(row => ({ ...row, id: ids.get(row.id)!, nameSource: nameSource(ids.get(row.id)!, row.name),
      facts: Object.fromEntries(Object.entries(row.facts).map(([key, fact]) => [key, { ...fact, sources: fact.sources.map(rewrite) }])) }));
    const formal = executeQueryPlan(task.plan!, [{ ...snapshot, rows, queryScope: { ...task.plan!.scope, filter: task.plan!.filter ?? null, requestedFields: describePlanRead(task.plan!).fields } }]);
    const invoke = vi.fn();
    const runTool = vi.fn(async (name, args) => name === 'execute_query_plan'
      ? { result: formal, content: '{"status":"ready"}' }
      : { result: prepareExportResult([formal], args), content: '{"status":"ready"}' });
    const out = await runAgentLoop({ question: exportQuestion, taskRoute: task, invoke, runTool, signal: signal() });
    expect(out.executionStatus).toBe('completed'); expect(out.calls).toBe(0); expect(out.toolCalls).toBe(2); expect(invoke).not.toHaveBeenCalled();
    const result = out.result!;
    const file = await buildResultArtifact(result, { requestId: randomUUID(), resultId: result.resultId, action: 'export', format: 'xlsx' });
    if (file.type !== 'download') throw new Error('missing Excel');
    const XLSX = await import('xlsx'); const book = XLSX.read(file.bytes, { type: 'array' });
    const contents = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 }) as unknown[][];
    expect(contents).toHaveLength(5); expect(contents[1]).toContain('B座'); expect(contents[1]).toContain(180);
    expect(contents[4]).toContain('A座'); expect(contents[4]).toContain(90);
  });
  it.each(['budget_exceeded', 'timeout', 'rate_limited', 'stream_interrupted'] as const)('retains a formal result when optional synthesis fails: %s', async code => {
    const result = executeQueryPlan(plan, [{ ...fixture({ year: 2026, quarter: 2 }), queryScope: { ...plan.scope, filter: plan.filter ?? null, requestedFields: describePlanRead(plan).fields } }]);
    const invoke = vi.fn().mockResolvedValueOnce({ ...completion(), message: { role: 'assistant', content: null, calls: [{ id: 'a', name: 'query_quarterly_metrics', arguments: JSON.stringify({ scope: plan.scope, period: { year: 2026, quarter: 2 }, metric: 'rent' }) }] } })
      .mockRejectedValueOnce(new ModelProviderError(code));
    const out = await runAgentLoop({ question: '综合解释CBD数据', invoke, runTool: async () => ({ result, content: '{"status":"ready"}' }), signal: signal() });
    expect(out.result).toBe(result); expect(out.executionStatus).toBe('partial'); expect(out.answer).toContain('附加分析未生成');
  });
  it('never delivers an already obtained result after revocation', async () => {
    let revoked = false;
    const invoke = vi.fn().mockResolvedValueOnce({ ...completion(), message: { role: 'assistant', content: null, calls: [{ id: 'a', name: 'get_data_capabilities', arguments: '{}' }] } }).mockRejectedValueOnce(new ModelProviderError('timeout'));
    await expect(runAgentLoop({ question: '综合说明', invoke, signal: signal(),
      revalidate: async () => { if (revoked) throw new Error('QUERY_DENIED'); },
      runTool: async () => { revoked = true; return { result: { resultId: randomUUID() }, content: '{"status":"ready"}' }; },
    })).rejects.toThrow('QUERY_DENIED');
  });
});

describe('AI6 unified budget and context ownership', () => {
  it('honors an explicit no-external-model constraint in both routing and the supplier boundary', async () => {
    const q = '2026Q2 CBD净有效租金，不要发给外部模型';
    expect(routeTask(q)).toMatchObject({ route: 'deterministic_query', modelForbidden: true, plan: { metric: 'rent' } });
    expect(routeTask('研究楼书，但不要把资料发给外部模型')).toMatchObject({ route: 'direct_response', modelForbidden: true });
    const adapter = vi.fn(), admit = vi.fn();
    const runtime = createModelRuntime({ actorId: randomUUID(), question: q, adapters: { deepseek: adapter }, admit,
      revalidate: async () => {}, onAttempt: async () => {} });
    await expect(runtime.invoke([{ role: 'user', content: q }], signal())).rejects.toMatchObject({ code: 'disclosure_denied' });
    expect(adapter).not.toHaveBeenCalled(); expect(admit).not.toHaveBeenCalled();
  });
  it('keeps semantic equivalents in one authorized query cache and stops repeated non-progress', async () => {
    const result = { resultId: randomUUID() };
    const invoke = vi.fn().mockImplementation(async () => ({ ...completion(), message: { role: 'assistant', content: null,
      calls: [{ id: randomUUID(), name: invoke.mock.calls.length % 2 ? 'execute_query_plan' : 'query_quarterly_metrics',
        arguments: JSON.stringify(invoke.mock.calls.length % 2 ? { plan } : { scope: plan.scope, metric: 'rent', period: { year: 2026, quarter: 2 } }) }] } }));
    const runTool = vi.fn().mockResolvedValue({ result, content: '{"status":"ready"}' });
    const revalidate = vi.fn();
    const out = await runAgentLoop({ question: '核对季度资料', invoke, runTool, revalidate, signal: signal() });
    expect(runTool).toHaveBeenCalledOnce(); expect(invoke).toHaveBeenCalledTimes(4);
    expect(out.result).toBe(result); expect(out.unresolvedFailures).toContainEqual({ tool: 'execution', code: 'no_progress' });
    expect(revalidate.mock.calls.length).toBeGreaterThan(4);
  });
  it('reduces the concept wire context by over half without pretending bytes are reported tokens', () => {
    const question = '什么是净有效租金';
    const full = modelContextEnvelope('deepseek', [{ role: 'system', content: agentInstructions() }, { role: 'user', content: question }], AGENT_TOOLS.map(t => t.function));
    const lean = modelContextEnvelope('deepseek', [{ role: 'system', content: agentInstructions(question) }, { role: 'user', content: question }], modelToolCatalogue(question, 'deep', []));
    expect(lean.messageBytes + lean.toolBytes).toBeLessThan((full.messageBytes + full.toolBytes) / 2);
    expect(lean.basis).toBe('wire_utf8_hard_envelope');
  });
  it('counts zero-model requests and specific budget rejection reasons in current-sample diagnostics', () => {
    const stats = summarizeModelOperations([
      { content: { provider: 'server_policy', executionRoute: 'deterministic_query', taskType: 'query', status: 'completed', durationMs: 20, modelCalls: 0 } },
      { content: { provider: 'server_policy', executionRoute: 'bounded_agent', taskType: 'analysis', status: 'incomplete', durationMs: 100,
        operations: { budgetRejection: 'token_reservation' } } },
    ]);
    expect(stats.execution).toMatchObject({ requests: 2, completed: 1, fast: 1, averageMs: 60, p95Ms: 100,
      budgetReasons: [{ value: 'token_reservation', count: 1 }] });
    expect(stats.actualBilledUsd).toBeNull();
  });
  it('charges interpretation and main Agent against the same cumulative budget', async () => {
    vi.stubEnv('AI_AGENT_MAX_TOKENS', '6000');
    const adapter = vi.fn().mockResolvedValue({ ...completion(4300), outputTokens: 10 });
    const runtime = createModelRuntime({ actorId: randomUUID(), question: '你好', adapters: { deepseek: adapter }, revalidate: async () => {}, onAttempt: async () => {} });
    await runtime.interpret([{ role: 'user', content: 'hello' }], signal());
    await expect(runtime.invoke([{ role: 'user', content: 'hello' }], signal())).rejects.toMatchObject({ code: 'budget_exceeded', budgetReason: 'token_reservation' });
    expect(adapter).toHaveBeenCalledOnce(); expect(runtime.records[0].purpose).toBe('semantic_intent');
    expect(adapter.mock.calls[0][3]).toMatchObject({ tools: [], maxOutputTokens: 1200 });
    expect(runtime.summary().budgetRejection).toBe('token_reservation');
  });
  it('compacts old observations without deleting native call pairs or encrypted handles', () => {
    const messages: AgentMessage[] = Array.from({ length: 4 }, (_, i) => [
      { role: 'assistant' as const, content: null, continuation: 'opaque-' + i, continuationBudgetBytes: 300, calls: [{ id: String(i), name: 'list_buildings', arguments: '{}' }] },
      { role: 'tool' as const, callId: String(i), content: JSON.stringify({ status: 'ready', resultId: randomUUID(), rowCount: 500, preview: 'x'.repeat(3000), limitations: ['预览不是全集'] }) },
    ]).flat();
    const compacted = compactModelContext(messages);
    expect(compacted.map(m => [m.role, m.callId, m.continuation])).toEqual(messages.map(m => [m.role, m.callId, m.continuation]));
    expect(JSON.parse(compacted[1].content!).rowCount).toBe(500); expect(JSON.parse(compacted[1].content!).preview).toBeUndefined();
    expect(JSON.parse(compacted.at(-1)!.content!).preview).toHaveLength(3000);
    expect(modelContextEnvelope('deepseek', messages, []).opaqueBytes).toBe(0);
    expect(modelContextEnvelope('openai', messages, []).opaqueBytes).toBe(1200);
  });
  it('does not load database tools for a concept explanation even in Deep user mode', () => {
    const messages: AgentMessage[] = [{ role: 'system', content: agentInstructions() }];
    expect(modelToolCatalogue('什么是空置率', 'deep', messages)).toEqual([]);
  });
});
