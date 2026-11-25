import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_INTENT_LIMITS, understandWithModel } from '../modelIntent';

const intent = { version: 'colliers-semantic-intent/1', operation: 'aggregate', submarkets: ['CBD'], metric: 'rent',
  time: { kind: 'explicit', periods: [{ year: 2026, quarter: 3 }] }, unresolvedConditions: [] };
const payload = (content: unknown = intent) => ({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 80, completion_tokens: 30 } });
const signal = () => new AbortController().signal;

describe('P1 bounded real-provider adapter', () => {
  beforeEach(() => { vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-test-key'); vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash'); vi.stubEnv('DEEPSEEK_API_BASE_URL', 'https://api.deepseek.com'); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('makes one bounded extraction call with slots only and preserves reported token usage', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload())); vi.stubGlobal('fetch', fetcher);
    const result = await understandWithModel('2026Q3 CBD净有效租金，帮我解释下', undefined, ['CBD'], signal());
    expect(result.intent).toEqual(intent); expect(result.usage).toEqual({ model: 'deepseek-flash', inputTokens: 80, outputTokens: 30, calls: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]; expect(url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(options.body); expect(body.max_tokens).toBe(MODEL_INTENT_LIMITS.maxOutputTokens);
    expect(body.messages).toHaveLength(2); expect(body.stream).toBe(false); expect(options.cache).toBe('no-store'); expect(options.redirect).toBe('error');
    expect(JSON.parse(body.messages[1].content)).toEqual({ question: '2026Q3 CBD净有效租金，帮我解释下', context: null, allowedSubmarkets: ['CBD'] });
    expect(body).not.toHaveProperty('tools');
  });
  it('redacts explicit credentials before outbound transmission', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload())); vi.stubGlobal('fetch', fetcher);
    await understandWithModel('CBD密码="do not transmit synthetic secret"2026Q3净有效租金', undefined, ['CBD'], signal());
    expect(fetcher.mock.calls[0][1].body).not.toContain('do not transmit synthetic secret');
  });
  it.each([
    { ...intent, sql: 'select * from auth.users' },
    { ...intent, metric: 'password' },
    { ...intent, submarkets: ['金融街'] },
    { ...intent, result: 123 },
    { ...intent, operation: 'delete' },
  ])('rejects illegal model output without executing anything', async candidate => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload(candidate))); vi.stubGlobal('fetch', fetcher);
    await expect(understandWithModel('2026Q3CBD净有效租金', undefined, ['CBD'], signal())).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never retries provider failures or falls back to invented results', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('provider failure', { status: 429 })); vi.stubGlobal('fetch', fetcher);
    await expect(understandWithModel('2026Q3CBD净有效租金', undefined, ['CBD'], signal())).rejects.toThrow('AGENT_MODEL_RATE_LIMITED');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects incomplete output, oversized response and overlong input', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...payload(), choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '{}' } }] }))
      .mockResolvedValueOnce(new Response(' '.repeat(MODEL_INTENT_LIMITS.maxResponseBytes + 1))); vi.stubGlobal('fetch', fetcher);
    await expect(understandWithModel('CBD', undefined, ['CBD'], signal())).rejects.toThrow();
    await expect(understandWithModel('CBD', undefined, ['CBD'], signal())).rejects.toThrow('AGENT_MODEL_INVALID_RESPONSE');
    await expect(understandWithModel('a'.repeat(3001), undefined, ['CBD'], signal())).rejects.toThrow('MODEL_INPUT_LIMIT');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not call a provider without credentials', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', ''); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(understandWithModel('CBD', undefined, ['CBD'], signal())).rejects.toThrow('AGENT_MODEL_NOT_CONFIGURED'); expect(fetcher).not.toHaveBeenCalled();
  });
});
