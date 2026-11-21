import { describe, it, expect, vi, afterEach } from 'vitest';
import { publicBuildingSearch, safePublicUrl } from './publicSearch';
import { KNOWLEDGE_TOOL_SCHEMAS } from './protocol';
afterEach(() => vi.unstubAllEnvs());
describe('public search disclosure boundary', () => {
    it('fails honestly with no configured provider, before any network call', async () => { vi.stubEnv('AI_PUBLIC_SEARCH_PROVIDER', ''); const fetcher = vi.fn(); await expect(publicBuildingSearch({ name: '合成楼宇', city: '北京' }, 'completion_year', new AbortController().signal, fetcher)).rejects.toThrow('KNOWLEDGE_PUBLIC_SEARCH_DISABLED'); expect(fetcher).not.toHaveBeenCalled(); });
    it('sends only approved public name, city and fixed topic, labels evidence and sanitizes URLs', async () => { vi.stubEnv('AI_PUBLIC_SEARCH_PROVIDER', 'brave'); vi.stubEnv('BRAVE_SEARCH_API_KEY', 'synthetic-server-only-key'); const fetcher = vi.fn(async () => Response.json({ web: { results: [{ title: '合成公开来源', url: 'https://www.gov.cn/building', description: '竣工年份2016', page_age: '2026-01-01T00:00:00Z' }, { title: 'bad', url: 'http://127.0.0.1/credentials', description: 'private' }, { title: 'key', url: 'https://site.cn/source', description: 'api_key=secret' }] } })); const results = await publicBuildingSearch({ name: '合成楼宇', city: '北京' }, 'completion_year', new AbortController().signal, fetcher); expect(results).toHaveLength(1); const [url, init] = fetcher.mock.calls[0] as unknown as [
        URL,
        RequestInit
    ]; expect(url.origin + url.pathname).toBe('https://api.search.brave.com/res/v1/web/search'); expect(url.searchParams.get('q')).toBe('北京 合成楼宇 竣工 年份 官方'); expect(init.redirect).toBe('error'); expect(results[0].retrievedAt).toMatch(/^20/); expect(results[0].publishedAt).toBe('2026-01-01T00:00:00.000Z'); expect(JSON.stringify(results)).not.toContain('synthetic-server-only-key'); });
    it('forbids arbitrary query, source URLs, credentials and private file fields in structured tools', () => { expect(() => KNOWLEDGE_TOOL_SCHEMAS.search_public_building_information.parse({ buildingId: crypto.randomUUID(), topic: 'completion_year', query: '租户_私有合同', url: 'https://evil.invalid' })).toThrow(); for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://localhost/a', 'https://127.0.0.1/a', 'https://u:p@a.cn', 'https://a.cn/x?access_token=secret'])
        expect(safePublicUrl(url)).toBeNull(); });
});
