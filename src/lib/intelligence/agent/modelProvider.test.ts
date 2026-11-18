import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeWithDeepSeek, ModelProviderError } from './modelProvider';

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
  it('sends a real tool schema and detects provider-reported tool calling', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      model: 'deepseek-flash', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: {
          name: 'query_verified_real_estate', arguments: '{"question":"查询CBD最新净有效租金"}' } }] } }],
      usage: { prompt_tokens: 210, completion_tokens: 41 },
    }));
    vi.stubGlobal('fetch', fetch);
    const answer = await completeWithDeepSeek([{ role: 'user', content: '查询CBD最新净有效租金' }], new AbortController().signal);
    expect(answer.message.tool_calls).toHaveLength(1);
    expect(answer.inputTokens).toBe(210);
    expect(answer.outputTokens).toBe(41);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe('deepseek-flash');
    expect(sent.tools[0].function.name).toBe('query_verified_real_estate');
    expect(sent.thinking.type).toBe('disabled');
    expect(sent.stream).toBe(false);
    expect(sent.messages[0].role).toBe('user');
  });

  it.each([[401, 'unauthorized'], [402, 'payment_required'], [404, 'model_not_found'], [429, 'rate_limited']])(
    'reports provider HTTP %i accurately', async (status, code) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(completeWithDeepSeek([{ role: 'user', content: '你好' }], new AbortController().signal))
        .rejects.toMatchObject({ code });
    },
  );

  it('refuses unapproved API hosts rather than sending secrets to an arbitrary domain', async () => {
    process.env.DEEPSEEK_API_BASE_URL = 'https://attacker.example';
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(completeWithDeepSeek([{ role: 'user', content: '你好' }], new AbortController().signal))
      .rejects.toBeInstanceOf(ModelProviderError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

