import { z } from 'zod';
const endpoint = 'https://api.search.brave.com/res/v1/web/search';
export const publicSearchConfigured = () => process.env.AI_PUBLIC_SEARCH_PROVIDER === 'brave' && Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim());
const topics = { completion_year: '竣工 年份 官方', parking: '停车位 官方', hvac: '空调系统 官方', green_certification: '绿色建筑 认证 官方' };
const sensitive = /(?:-----BEGIN|\b(?:sk-|sb_secret_|eyJ)[A-Za-z0-9_-]{12,}|(?:api[_ -]?key|password|secret|access[_ -]?token)\s*[:=]|合同编号|身份证|租户名单)/i;
export function safePublicUrl(value: string): string | null {
    try {
        const u = new URL(value);
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || u.hash || u.href.length > 1800)
            return null;
        // Public search returns links only; there is deliberately no server-side URL fetcher.
        if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(u.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(u.hostname) || sensitive.test(decodeURIComponent(u.href)))
            return null;
        return u.href;
    }
    catch {
        return null;
    }
}
const clean = (text: string, max: number) => text.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
export async function publicBuildingSearch(subject: {
    name: string;
    city: string;
}, topic: keyof typeof topics, signal: AbortSignal, request: typeof fetch = fetch) {
    if (!publicSearchConfigured())
        throw new Error('KNOWLEDGE_PUBLIC_SEARCH_DISABLED');
    // No arbitrary query/question/document/company/contract is accepted at this boundary.
    if (!/^[一-龥A-Za-z0-9 ·（）()_-]{2,100}$/.test(subject.name) || !/^[一-龥A-Za-z ]{2,40}$/.test(subject.city) || !Object.hasOwn(topics, topic) || sensitive.test(subject.name))
        throw new Error('QUERY_DENIED');
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ q: subject.city + ' ' + subject.name + ' ' + topics[topic], count: '5', search_lang: 'zh-hans', safesearch: 'strict' }).toString();
    const res = await request(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY! }, signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), cache: 'no-store', redirect: 'error' });
    if (!res.ok)
        throw new Error('KNOWLEDGE_PUBLIC_SEARCH_UNAVAILABLE');
    const reader = res.body?.getReader();
    if (!reader)
        throw new Error('KNOWLEDGE_PUBLIC_SEARCH_UNAVAILABLE');
    let size = 0;
    const buffers: Uint8Array[] = [];
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.length;
            if (size > 512000)
                throw new Error('KNOWLEDGE_PUBLIC_SEARCH_UNAVAILABLE');
            buffers.push(value);
        }
    }
    finally {
        await reader.cancel();
    }
    const data = z.object({ web: z.object({ results: z.array(z.object({ title: z.string(), url: z.string(), description: z.string().nullish(), page_age: z.string().nullish() })).max(30) }).nullish() }).parse(JSON.parse(Buffer.concat(buffers).toString('utf8')));
    const retrievedAt = new Date().toISOString();
    return (data.web?.results ?? []).slice(0, 5).flatMap(r => {
        const url = safePublicUrl(r.url);
        const title = clean(r.title, 200), snippet = clean(r.description ?? '', 700);
        if (!url || sensitive.test(title + ' ' + snippet))
            return [];
        const stamp = r.page_age ? new Date(r.page_age) : null;
        return [{ title, url, snippet, retrievedAt, publishedAt: stamp && Number.isFinite(stamp.getTime()) ? stamp.toISOString() : null }];
    });
}
