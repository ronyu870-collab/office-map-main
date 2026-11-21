import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      'query_verified_real_estate', 'query_lease_transactions', 'query_report_market', 'analyze_rent_vacancy', 'analyze_distribution', 'list_buildings', 'get_data_capabilities', 'search_buildings', 'get_building_profile',
      'query_quarterly_metrics', 'rank_buildings', 'compare_market_segments', 'analyze_market_trends',
      'generate_pdf_report', 'export_table', 'summarize_result', 'read_result_page', 'check_data_coverage', 'compare_result_sets',
      'get_source_evidence', 'prepare_chart', 'create_chart', 'modify_chart', 'export_chart', 'prepare_map_selection', 'prepare_research_output',
    ]);
    expect(sent.tools[0].function.name).toBe('query_verified_real_estate');
    expect(sent.thinking.type).toBe('disabled');
    expect(sent.stream).toBe(false);
    expect(sent.messages[0].role).toBe('user');
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

  it.each([[401, 'unauthorized'], [402, 'payment_required'], [404, 'model_not_found'], [429, 'rate_limited']])(
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
