import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeepSeekAdapter } from './deepseekAdapter';
import { completeWithDeepSeek, deepseekAgentConfigured, ModelProviderError } from './modelProvider';

const fake = { DEEPSEEK_API_KEY: 'fake-for-protocol-test-only',
  DEEPSEEK_API_BASE_URL: 'https://api.deepseek.com', DEEPSEEK_MODEL: 'deepseek-flash' };
let previous: Record<string, string | undefined>;

beforeEach(() => {
  previous = Object.fromEntries(Object.keys(fake).map(key => [key, process.env[key]]));
  Object.assign(process.env, fake);
  delete process.env.DEEPSEEK_CHAT_MODEL;
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.keys(fake).forEach(key => previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key]);
});

describe('DeepSeek official native chat completion protocol', () => {
  it('enables Agent only for valid official DeepSeek provider configuration, not a local synthetic test server', () => {
    expect(deepseekAgentConfigured()).toBe(true);
    process.env.DEEPSEEK_API_BASE_URL = 'http://127.0.0.1:49222';
    expect(deepseekAgentConfigured()).toBe(false);
    process.env.DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com';
    process.env.DEEPSEEK_API_KEY = '';
    expect(deepseekAgentConfigured()).toBe(false);
  });

  it('sends a real tool schema and detects provider-reported tool calling', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      id: 'provider-req-123', model: 'deepseek-flash', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: {
          name: 'query_verified_real_estate', arguments: '{"question":"查询CBD最新净有效租金"}' } }] } }],
      usage: { prompt_tokens: 210, completion_tokens: 41 },
    }));
    vi.stubGlobal('fetch', fetch);
    const answer = await completeWithDeepSeek([{ role: 'user', content: '查询CBD最新净有效租金' }], new AbortController().signal);
    expect(answer.message.tool_calls).toHaveLength(1);
    expect(answer.inputTokens).toBe(210);
    expect(answer.providerRequestId).toBe('provider-req-123');
    expect(answer.outputTokens).toBe(41);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe('deepseek-flash');
    expect(sent.tools.map((item: { function: { name: string } }) => item.function.name)).toEqual([
      'query_verified_real_estate', 'execute_query_plan', 'list_knowledge_documents', 'search_internal_documents', 'search_public_building_information', 'query_building_dossier', 'query_submarket_profile', 'query_future_supply', 'query_stacking_plan', 'query_lease_transactions', 'query_report_market', 'analyze_rent_vacancy', 'analyze_distribution', 'list_buildings', 'get_data_capabilities', 'search_buildings', 'get_building_profile',
      'query_quarterly_metrics', 'rank_buildings', 'compare_market_segments', 'analyze_market_trends',
      'select_answer_results', 'plan_research_task', 'advance_research_task', 'review_research_task', 'generate_research_deliverable',
      'generate_pdf_report', 'export_table', 'summarize_result', 'read_result_page', 'apply_result_view', 'check_data_coverage', 'compare_result_sets',
      'get_source_evidence', 'prepare_chart', 'create_chart', 'modify_chart', 'export_chart', 'prepare_map_selection', 'prepare_research_output',
    ]);
    expect(sent.tools[0].function.name).toBe('query_verified_real_estate');
    expect(sent.thinking.type).toBe('disabled');
    expect(sent.stream).toBe(false);
    expect(sent.messages[0].role).toBe('user');
  });

  it.each([false, true])('preserves request-local tool reasoning in the next wire request (SSE: %s)', async streamed => {
    const toolCall = { id: 'call-1', type: 'function',
      function: { name: 'get_data_capabilities', arguments: '{}' } };
    const first = streamed ? new Response([
      { choices: [{ index: 0, delta: { reasoning_content: '内部' } }] },
      { choices: [{ index: 0, delta: { reasoning_content: '推理',
        tool_calls: [{ index: 0, ...toolCall }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 60, completion_tokens: 25,
        completion_tokens_details: { reasoning_tokens: 20 } } },
    ].map(frame => 'data: ' + JSON.stringify({ id: 'first', model: 'deepseek-v4-pro', ...frame }) + '\r\n\r\n')
      .join('') + 'data: [DONE]\r\n\r\n') : Response.json({
      model: 'deepseek-v4-pro',
      choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
        reasoning_content: '内部推理', tool_calls: [toolCall] } }],
    });
    const fetch = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(Response.json({
      model: 'deepseek-v4-pro', choices: [{ finish_reason: 'stop',
        message: { role: 'assistant', reasoning_content: '最终推理', content: '已查询' } }],
    }));
    vi.stubGlobal('fetch', fetch);
    const adapter = createDeepSeekAdapter();
    const options = { model: 'deepseek-v4-pro', maxOutputTokens: 256, timeoutMs: 1000,
      reasoningEffort: 'high' as const };
    const user = { role: 'user' as const, content: '查询可用数据' };
    const signal = new AbortController().signal;
    const delta = vi.fn();
    const completion = await adapter([user], signal, streamed ? delta : undefined, options);

    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toMatchObject({
      model: options.model, thinking: { type: 'enabled' }, reasoning_effort: 'high',
    });
    expect(completion.message.continuationBudgetBytes).toBe(Buffer.byteLength(JSON.stringify({ reasoning_content: '内部推理' })));
    expect(JSON.stringify(completion)).not.toContain('内部推理');
    expect(delta).not.toHaveBeenCalled();

    const tool = { role: 'tool' as const, content: '{}', callId: toolCall.id };
    const answer = await adapter([user, completion.message, tool], signal, undefined, options);
    expect(JSON.parse(String(fetch.mock.calls[1][1].body)).messages).toEqual([
      user, { role: 'assistant', content: null, tool_calls: [toolCall], reasoning_content: '内部推理' },
      { role: 'tool', content: '{}', tool_call_id: toolCall.id },
    ]);
    expect(answer.message).toEqual({ role: 'assistant', content: '已查询' });

    await expect(createDeepSeekAdapter()([user, completion.message, tool], signal, undefined, options))
      .rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses official SSE include_usage and forwards only real vendor increments', async () => {
    const chunks = [
      { id: 'real-id', model: 'deepseek-flash', choices: [{ index: 0,
        delta: { content: '你好' }, finish_reason: null }] },
      { id: 'real-id', model: 'deepseek-flash', choices: [{ index: 0,
        delta: {}, finish_reason: 'stop' }] },
      { id: 'real-id', model: 'deepseek-flash', choices: [],
        usage: { prompt_tokens: 99, completion_tokens: 2 } },
    ];
    const body = chunks.map(item => 'data: ' + JSON.stringify(item) + '\n\n').join('') + 'data: [DONE]\n\n';
    const fetch = vi.fn().mockResolvedValue(new Response(body,
      { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetch);
    const deltas: string[] = [];
    const result = await completeWithDeepSeek([{ role: 'user', content: '你好' }],
      new AbortController().signal, async delta => { deltas.push(delta); });
    expect(result.message.content).toBe('你好');
    expect(result.inputTokens).toBe(99);
    expect(result.outputTokens).toBe(2);
    expect(deltas).toEqual(['你好']);
    const sent = JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent.stream).toBe(true);
    expect(sent.stream_options).toEqual({ include_usage: true });
  });

  it.each([[401, 'unauthorized'], [403, 'unauthorized'], [402, 'payment_required'], [404, 'model_not_found'], [429, 'rate_limited']])(
    'reports provider HTTP %i accurately', async (status, code) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(completeWithDeepSeek([{ role: 'user', content: '你好' }], new AbortController().signal))
        .rejects.toMatchObject({ code });
    },
  );

  it('rejects discontinued legacy model IDs before any paid request', async () => {
    process.env.DEEPSEEK_MODEL = 'deepseek-chat';
    expect(deepseekAgentConfigured()).toBe(false);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(completeWithDeepSeek([{ role: 'user', content: '你好' }], new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid_configuration' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses unapproved API hosts rather than sending secrets to an arbitrary domain', async () => {
    process.env.DEEPSEEK_API_BASE_URL = 'https://attacker.example';
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(completeWithDeepSeek([{ role: 'user', content: '你好' }], new AbortController().signal))
      .rejects.toBeInstanceOf(ModelProviderError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
