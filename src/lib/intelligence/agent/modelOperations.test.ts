import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAIAdapter } from './openaiAdapter';
import { createModelRuntime, chooseModelMode, modelAvailability, modelToolCatalogue } from './modelRuntime';
import { ModelProviderError } from './modelProvider';
import type { AgentCompletion, AgentMessage, ModelAdapter, ProviderId } from './modelProtocol';
import { nextAgentMemory } from './agentMemory';
import { summarizeModelOperations } from './modelOperationsView';
import { agentInstructions, runAgentLoop } from './agentOrchestrator';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const messages: AgentMessage[] = [{ role: 'user', content: '你好' }];
const signal = () => new AbortController().signal;
const options = { model: 'gpt-4.1-mini', maxOutputTokens: 1800, timeoutMs: 1000 };
const success = (provider: ProviderId): AgentCompletion => ({ provider, model: provider === 'openai' ? options.model : 'deepseek-flash',
  inputTokens: 100, outputTokens: 20, message: { role: 'assistant', content: '已完成回复' }, providerRequestId: 'synthetic_request' });
function setup() {
  // The adapter is server-only. Simulate the Node surface while retaining the
  // repository DOM setup for component suites; never enable SDK browser keys.
  vi.stubGlobal('window', undefined);
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-secret-never-log'); vi.stubEnv('OPENAI_AGENT_MODEL', options.model);
  vi.stubEnv('AI_OPENAI_ENABLED', 'true'); vi.stubEnv('AI_OPENAI_ACTOR_IDS', actorId);
  vi.stubEnv('OPENAI_AGENT_INPUT_USD_PER_MILLION', '.5'); vi.stubEnv('OPENAI_AGENT_OUTPUT_USD_PER_MILLION', '2');
  vi.stubEnv('AI_MODEL_FALLBACK_ENABLED', 'true'); vi.stubEnv('AI_PROVIDER_QUICK', 'deepseek');
  vi.stubEnv('AI_AGENT_MAX_TOKENS', '60000'); vi.stubEnv('AI_AGENT_MAX_ESTIMATED_USD', '.25');
  vi.stubEnv('AI_AGENT_PROVIDER_TIMEOUT_MS', '1000');
}
function runtime(adapters: Partial<Record<ProviderId, ModelAdapter>>, revalidate = vi.fn().mockResolvedValue(undefined)) {
  return createModelRuntime({ actorId, question: '你好', adapters, revalidate, onAttempt: vi.fn().mockResolvedValue(undefined) });
}
function response(output: unknown[] = [{ type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '中文回复', annotations: [] }] }]) {
  return { id: 'resp_synthetic', object: 'response', model: options.model, status: 'completed', output,
    usage: { input_tokens: 101, output_tokens: 21, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 3 } } };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('official OpenAI Responses SDK adapter (simulated supplier, no live keys)', () => {
  it('uses fixed official URL, store=false, no built-in tools, no automatic retries and neutral function/result protocol', async () => {
    setup(); vi.stubEnv('OPENAI_BASE_URL', 'https://evil.invalid'); vi.stubEnv('OPENAI_LOG', 'debug');
    const output = [{ type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-reasoning' },
      { type: 'function_call', id: 'fc_1', status: 'completed', call_id: 'c1', name: 'search_buildings', arguments: '{"scope":{"inventory":"tracked","submarkets":["CBD"]}}' }];
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(response(output))).mockResolvedValueOnce(Response.json(response())); vi.stubGlobal('fetch', fetch);
    const adapter = createOpenAIAdapter(), result = await adapter(messages, signal(), undefined, options);
    expect(result.message.calls).toEqual([{ id: 'c1', name: 'search_buildings', arguments: output[1].arguments }]);
    expect(result.message).not.toHaveProperty('tool_calls'); expect(result.cachedInputTokens).toBe(40); expect(result.reasoningTokens).toBe(3);
    await adapter([...messages, result.message, { role: 'tool', callId: 'c1', content: '{"status":"ready"}' }], signal(), undefined, options);
    const [url, init] = fetch.mock.calls[1] as [string, RequestInit], body = JSON.parse(String(init.body));
    expect(String(url)).toBe('https://api.openai.com/v1/responses'); expect(init.redirect).toBe('error');
    expect(body.store).toBe(false); expect(body.background).toBe(false); expect(body.max_output_tokens).toBe(1800);
    expect(body.tools.every((t: { type: string; strict: boolean }) => t.type === 'function' && t.strict === false)).toBe(true);
    expect(body.input).toContainEqual(output[0]); expect(body.input).toContainEqual({ type: 'function_call_output', call_id: 'c1', output: '{"status":"ready"}' });
  });
  it('consumes real SSE event shapes and requires response.completed before a completed reply', async () => {
    setup(); const events = [{ type: 'response.output_text.delta', delta: '中文回复', sequence_number: 1 },
      { type: 'response.completed', response: response(), sequence_number: 2 }];
    const wire = (values: unknown[]) => new Response(values.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(wire(events)).mockResolvedValueOnce(wire(events.slice(0, 1))));
    const deltas: string[] = [], adapter = createOpenAIAdapter();
    expect((await adapter(messages, signal(), async d => { deltas.push(d); }, options)).inputTokens).toBe(101); expect(deltas).toEqual(['中文回复']);
    await expect(adapter(messages, signal(), async () => {}, options)).rejects.toMatchObject({ code: 'stream_interrupted' });
  });
  it.each([[401, 'invalid_api_key', 'unauthorized'], [403, 'permission_denied', 'unauthorized'], [404, 'model_not_found', 'model_not_found'],
    [429, 'rate_limit_exceeded', 'rate_limited'], [429, 'insufficient_quota', 'payment_required'], [500, 'server_error', 'provider_unavailable']])(
    'classifies HTTP %i/%s without exposing supplier error text or retrying SDK calls', async (status, code, expected) => {
      setup(); const fetch = vi.fn().mockResolvedValue(Response.json({ error: { message: 'private-contract-and-secret', code } }, { status })); vi.stubGlobal('fetch', fetch);
      await expect(createOpenAIAdapter()(messages, signal(), undefined, options)).rejects.toMatchObject({ code: expected }); expect(fetch).toHaveBeenCalledOnce();
    });
  it('rejects missing configuration, malformed completion and cancellation', async () => {
    setup(); vi.stubEnv('OPENAI_API_KEY', ''); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(createOpenAIAdapter()(messages, signal(), undefined, options)).rejects.toMatchObject({ code: 'not_configured' }); expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv('OPENAI_API_KEY', 'synthetic'); fetch.mockResolvedValue(Response.json({ ...response(), status: 'incomplete' }));
    await expect(createOpenAIAdapter()(messages, signal(), undefined, options)).rejects.toMatchObject({ code: 'invalid_response' });
    const abort = new AbortController(); abort.abort(new Error('cancelled'));
    await expect(createOpenAIAdapter()(messages, abort.signal, undefined, options)).rejects.toThrow();
  });
  it.each([null, { type: 'function_call', call_id: 'c1', name: 'list_buildings', arguments: null },
    { type: 'message', status: 'completed', content: null }, { type: 'message', status: 'completed', content: [{ type: 'output_text', text: 17 }] }])(
    'rejects malformed output items without classifying them as a retryable outage', async item => {
      setup(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response([item]))));
      await expect(createOpenAIAdapter()(messages, signal(), undefined, options)).rejects.toMatchObject({ code: 'invalid_response' });
    });
  it('bounds a hung SDK fetch by its real deadline without retrying', async () => {
    setup(); const fetch = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })); vi.stubGlobal('fetch', fetch);
    await expect(createOpenAIAdapter()(messages, signal(), undefined, options)).rejects.toMatchObject({ code: 'timeout' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('bounded routing, fallback and model cost governance', () => {
  it.each(['not_configured', 'rate_limited', 'timeout', 'payment_required', 'model_not_found', 'provider_unavailable', 'stream_interrupted'] as const)(
    'falls back once for %s only when authorized and within budgets, recording both attempts', async code => {
      setup(); const deepseek = vi.fn().mockRejectedValue(new ModelProviderError(code)), openai = vi.fn().mockResolvedValue(success('openai'));
      const run = runtime({ deepseek, openai }); expect((await run.invoke(messages, signal())).provider).toBe('openai');
      await run.invoke(messages, signal()); expect(deepseek).toHaveBeenCalledOnce(); expect(openai).toHaveBeenCalledTimes(2);
      expect(run.records.map(a => [a.provider, a.state, a.fallback])).toEqual([['deepseek', 'failed', false], ['openai', 'completed', true], ['openai', 'completed', true]]);
      expect(run.records[0].usageStatus).toBe(code === 'not_configured' ? 'not_sent' : 'unknown_reserved');
      expect(run.summary().actualBilledUsd).toBeNull(); expect(JSON.stringify(run.records)).not.toMatch(/synthetic-secret|private-contract/);
    });
  it('never falls back on business denial, credentials failure, malformed output or cancellation; no alternate disclosure without actor opt-in', async () => {
    setup(); const openai = vi.fn().mockResolvedValue(success('openai'));
    for (const error of [new Error('QUERY_DENIED'), new ModelProviderError('unauthorized'), new ModelProviderError('invalid_response')]) {
      await expect(runtime({ deepseek: vi.fn().mockRejectedValue(error), openai }).invoke(messages, signal())).rejects.toBe(error);
    }
    vi.stubEnv('AI_OPENAI_ACTOR_IDS', 'another-user');
    await expect(runtime({ deepseek: vi.fn().mockRejectedValue(new ModelProviderError('rate_limited')), openai }).invoke(messages, signal())).rejects.toMatchObject({ code: 'rate_limited' });
    expect(openai).not.toHaveBeenCalled(); expect(modelAvailability(actorId).openai).toBe(false);
    const abort = new AbortController(); abort.abort(); const deepseek = vi.fn();
    await expect(runtime({ deepseek, openai }).invoke(messages, abort.signal)).rejects.toThrow(); expect(deepseek).not.toHaveBeenCalled();
  });
  it('rechecks revocation before fallback and before exposing a completed model delta', async () => {
    setup(); let revoked = false; const revalidate = vi.fn(async () => { if (revoked) throw new Error('QUERY_DENIED'); });
    const openai = vi.fn(); const deepseek = vi.fn(async () => { revoked = true; throw new ModelProviderError('timeout'); });
    await expect(runtime({ deepseek, openai }, revalidate).invoke(messages, signal())).rejects.toThrow('QUERY_DENIED'); expect(openai).not.toHaveBeenCalled();
    revoked = false; const delta = vi.fn();
    const paid = vi.fn(async (_messages, _signal, onDelta) => { await onDelta?.('不得交付'); revoked = true; return success('deepseek'); });
    await expect(runtime({ deepseek: paid, openai }, revalidate).invoke(messages, signal(), delta)).rejects.toThrow('QUERY_DENIED');
    expect(delta).not.toHaveBeenCalled(); expect(openai).not.toHaveBeenCalled();
  });
  it('records an unconfigured primary model as not sent and permits an explicit safe fallback', async () => {
    setup(); vi.stubEnv('AI_PROVIDER_QUICK', 'openai'); vi.stubEnv('OPENAI_AGENT_MODEL', '');
    const run = runtime({ openai: vi.fn(), deepseek: vi.fn().mockResolvedValue(success('deepseek')) });
    expect((await run.invoke(messages, signal())).provider).toBe('deepseek');
    expect(run.records[0]).toMatchObject({ provider: 'openai', state: 'failed', errorCode: 'not_configured', usageStatus: 'not_sent', estimateUsd: 0 });
  });
  it('discards a failed supplier partial stream before delivering the authorized fallback text', async () => {
    setup(); const delivered: string[] = [];
    const deepseek: ModelAdapter = async (_messages, _signal, onDelta) => {
      await onDelta?.('失败供应商残片'); throw new ModelProviderError('stream_interrupted');
    };
    const openai: ModelAdapter = async (_messages, _signal, onDelta) => { await onDelta?.('完整备用回复'); return success('openai'); };
    const run = runtime({ deepseek, openai }); await run.invoke(messages, signal(), async text => { delivered.push(text); });
    expect(delivered).toEqual(['完整备用回复']); expect(run.records[0].usageStatus).toBe('unknown_reserved');
  });
  it('checks token and estimated money caps before any paid call; unknown usage is reserved and cannot become free retries', async () => {
    setup(); const deepseek = vi.fn().mockResolvedValue(success('deepseek'));
    vi.stubEnv('AI_AGENT_MAX_TOKENS', '1000'); await expect(runtime({ deepseek }).invoke(messages, signal())).rejects.toMatchObject({ code: 'budget_exceeded' }); expect(deepseek).not.toHaveBeenCalled();
    vi.stubEnv('AI_AGENT_MAX_TOKENS', '60000'); vi.stubEnv('AI_AGENT_MAX_ESTIMATED_USD', '.000001');
    await expect(runtime({ deepseek }).invoke(messages, signal())).rejects.toMatchObject({ code: 'budget_exceeded' }); expect(deepseek).not.toHaveBeenCalled();
    const reservation = Buffer.byteLength(JSON.stringify(messages))
      + Buffer.byteLength(JSON.stringify(modelToolCatalogue('你好', 'quick', messages))) + 1024 + 1800;
    vi.stubEnv('AI_AGENT_MAX_ESTIMATED_USD', '.25'); vi.stubEnv('AI_AGENT_MAX_TOKENS', String(Math.floor(reservation * 1.5)));
    deepseek.mockResolvedValue({ ...success('deepseek'), inputTokens: null, outputTokens: null });
    const run = runtime({ deepseek }); await run.invoke(messages, signal());
    await expect(run.invoke(messages, signal())).rejects.toMatchObject({ code: 'budget_exceeded' });
    expect(run.records[0].chargedTokens).toBe(reservation); expect(deepseek).toHaveBeenCalledOnce();
  });
  it.each(['', ' ', 'NaN', '-1', 'Infinity'])('rejects invalid configured prices %j before sending or falling back', async price => {
    setup(); vi.stubEnv('AI_PROVIDER_QUICK', 'openai'); vi.stubEnv('OPENAI_AGENT_INPUT_USD_PER_MILLION', price);
    const openai = vi.fn().mockResolvedValue(success('openai')), deepseek = vi.fn().mockResolvedValue(success('deepseek'));
    const run = runtime({ openai, deepseek });
    await expect(run.invoke(messages, signal())).rejects.toMatchObject({ code: 'invalid_configuration' });
    expect(openai).not.toHaveBeenCalled(); expect(deepseek).not.toHaveBeenCalled();
    expect(run.records[0].usageStatus).toBe('not_sent'); expect(modelAvailability(actorId).openai).toBe(false);
  });
  it('routes server modes without forcing another user onto OpenAI and keeps the same authorized tool executor', async () => {
    setup(); expect(chooseModelMode('你好')).toBe('quick'); expect(chooseModelMode('生成CBD研究报告')).toBe('deep');
    vi.stubEnv('AI_PROVIDER_QUICK', 'openai'); const openai = vi.fn().mockResolvedValueOnce({ ...success('openai'), message: { role: 'assistant', content: null,
      calls: [{ id: 'tool1', name: 'get_data_capabilities', arguments: JSON.stringify({ question: '当前数据权限' }) }] } }).mockResolvedValue(success('openai'));
    const run = runtime({ openai }); const runTool = vi.fn().mockResolvedValue({ content: '{"status":"ready"}' });
    const result = await runAgentLoop({ question: '你好', invoke: run.invoke, limits: run.limits, signal: signal(), runTool });
    expect(result.toolCalls).toBe(0); expect(runTool).not.toHaveBeenCalled();
    expect(result.answer.length).toBeLessThanOrEqual(40);
    expect(modelToolCatalogue('你好', 'quick', messages)).toEqual([]);
    vi.stubEnv('AI_OPENAI_ACTOR_IDS', 'someone-else'); const deepseek = vi.fn().mockResolvedValue(success('deepseek'));
    expect((await runtime({ deepseek, openai }).invoke(messages, signal())).provider).toBe('deepseek');
    const names = modelToolCatalogue('CBD研究Word报告', 'deep', messages).map(t => t.name);
    expect(names).toContain('plan_research_task'); expect(names).not.toContain('export_chart');
  });
  it('keeps existing lease, dossier and chart-follow-up capabilities discoverable without exact domain keywords', () => {
    const names = (q: string, chart = false) => modelToolCatalogue(q, chooseModelMode(q), messages, chart).map(t => t.name);
    expect(names('最近一年 TMT 行业主要租在哪些楼？')).toContain('query_lease_transactions');
    expect(names('国贸的空调系统和绿色认证是什么？')).toContain('query_building_dossier');
    expect(names('按租金从高到低排列。', true)).toContain('modify_chart');
    expect(names('把 CBD 和金融街放到同一张图。')).toContain('compare_market_segments');
    expect(modelToolCatalogue('把刚才结果导出 Excel', 'professional', messages, false, ['lease']).map(t => t.name)).toContain('query_lease_transactions');
    expect(modelToolCatalogue('再看层数', 'professional', messages, false, ['business']).map(t => t.name)).toContain('query_building_dossier');
    expect(modelToolCatalogue('比较刚才两份', 'professional', messages, false, ['knowledge']).map(t => t.name)).toContain('search_internal_documents');
    expect(names('按租金从高到低排列。')).not.toContain('modify_chart');
  });
  it('packages an existing chart as PDF within the unchanged budget, while keeping explicit chart edits available', async () => {
    setup();
    const question = '把这些结果生成 PDF 研究报告。';
    const history: AgentMessage[] = [{ role: 'system', content: agentInstructions() },
      { role: 'system', content: '已重新鉴权的结果引用：' + 'x'.repeat(4000) }, { role: 'user', content: question }];
    const tools = modelToolCatalogue(question, 'deep', history, true);
    const deepseek = vi.fn().mockResolvedValue(success('deepseek'));
    const run = createModelRuntime({ actorId, question, hasChartContext: true, adapters: { deepseek },
      revalidate: vi.fn().mockResolvedValue(undefined), onAttempt: vi.fn().mockResolvedValue(undefined) });
    await expect(run.invoke(history, signal())).resolves.toMatchObject({ provider: 'deepseek' });
    expect(tools.map(t => t.name)).toContain('generate_pdf_report');
    expect(tools.map(t => t.name)).not.toContain('modify_chart');
    expect(modelToolCatalogue('把刚才的柱状图导出 PDF。', 'deep', history, true).map(t => t.name)).not.toContain('modify_chart');
    expect(modelToolCatalogue('调整散点图坐标并生成 PDF。', 'deep', history, true).map(t => t.name)).toContain('modify_chart');
  });
  it('admits the final Excel round after four production-sized completions without increasing the token budget', async () => {
    setup();
    const question = '把 CBD 在 2026Q2 净有效租金最高的 10 栋楼导出 Excel。';
    const history: AgentMessage[] = [{ role: 'system', content: agentInstructions() },
      { role: 'system', content: '正式结果引用与工作集：' + 'x'.repeat(4000) }, { role: 'user', content: question }];
    const deepseek = vi.fn().mockResolvedValue({ ...success('deepseek'), inputTokens: 8227, outputTokens: 105 });
    const run = createModelRuntime({ actorId, question, adapters: { deepseek },
      revalidate: vi.fn().mockResolvedValue(undefined), onAttempt: vi.fn().mockResolvedValue(undefined) });
    for (let i = 0; i < 5; i++) await run.invoke(history, signal());
    expect(deepseek).toHaveBeenCalledTimes(5); expect(run.summary().maxTokens).toBe(60000);
    const catalogue = modelToolCatalogue(question, 'professional', history);
    expect(Buffer.byteLength(JSON.stringify(catalogue))).toBeLessThan(12000);
    expect(catalogue.map(t => t.name)).toEqual(expect.arrayContaining(['rank_buildings', 'export_table', 'get_data_capabilities']));
    expect(catalogue.map(t => t.name)).not.toContain('analyze_distribution');
    const chartExport = modelToolCatalogue('生成租金排名 PNG 柱状图', 'professional', history).find(t => t.name === 'export_chart')!;
    expect(chartExport.parameters.properties).not.toHaveProperty('chart');
    expect(modelToolCatalogue('把刚才的结果生成 PDF', 'deep', history, true).find(t => t.name === 'generate_pdf_report')!.parameters.properties).not.toHaveProperty('charts');
    const followup = [...history, { role: 'assistant' as const, content: null,
      calls: [{ id: 'prior', name: 'query_lease_transactions', arguments: '{}' }] }];
    expect(modelToolCatalogue('按季度再比较', 'professional', followup).map(t => t.name)).toContain('query_lease_transactions');
  });
  it('compresses many turns without model costs or private facts, and separates unknown usage from actual invoice totals', () => {
    let memory; for (let i = 0; i < 24; i++) memory = nextAgentMemory(memory, '比较租金与空置率，生成Word；合成保密租户=987654，API_KEY=synthetic');
    expect(memory!.turns).toBe(24); expect(memory!.preferences.requestedFormats).toContain('docx'); expect(JSON.stringify(memory)).not.toMatch(/987654|保密租户|API_KEY/);
    const stats = summarizeModelOperations([{ content: { protocol: 'agent-model-attempt/1', provider: 'openai', mode: 'deep', state: 'failed', model: options.model,
      errorCode: 'timeout', fallback: true, durationMs: 1000, inputTokens: null, outputTokens: null, estimateUsd: .01, usageStatus: 'unknown_reserved' } }]);
    expect(stats.calls).toBe(1); expect(stats.groups[0].inputTokens).toBeNull(); expect(stats.actualBilledUsd).toBeNull(); expect(stats.errors).toEqual([{ code: 'timeout', count: 1 }]);
  });
});
