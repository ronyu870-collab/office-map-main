import { authorizePlan } from './admission';
import { queryHttpDependencies } from './http';
import { QUESTION_GRAMMAR_VERSION, QUESTION_SUBMARKETS, resolveBusinessQuestion } from './question';
import { loadDataAuthority, verifyQueryIdentity } from './serverAuthority';

export type QueryCapabilities = { enabled: boolean; examples: string[]; grammarVersion?: string; permissionRevision?: string; internalExport?: boolean };
export async function handleQueryCapabilities(request: Request, dependencies: ReturnType<typeof queryHttpDependencies>): Promise<Response> {
  const json = (body: QueryCapabilities, status = 200) => Response.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', Vary: 'Authorization, X-Colliers-Impersonate-User', 'X-Content-Type-Options': 'nosniff',
  } });
  if (!dependencies.enabled) return json({ enabled: false, examples: [] });
  try {
    const identity = await verifyQueryIdentity(request, dependencies.client);
    const authority = await loadDataAuthority(dependencies.client, identity, AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    if (!authority.grants.includes('query:catalog')) return json({ enabled: false, examples: [] });
    const market = QUESTION_SUBMARKETS.find(name => authority.allSubmarkets || authority.submarkets.includes(name)) ?? '全部获权楼宇';
    // Examples describe syntax, not the existence, period coverage or value of data.
    const examples = [`${market}有哪些楼`, `${market}最高的楼是什么`, `2026年第三季度${market}净有效租金`, `2026年第三季度${market}空置率`, `${market}净有效租金2026Q1至2026Q3趋势各期样本`, '2026Q3全部获权楼宇净有效租金按子市场比较']
      .filter(question => {
        const result = resolveBusinessQuestion(question);
        if (result.kind !== 'plan') return false;
        try { authorizePlan(result.plan, authority); return true; } catch { return false; }
      });
    return json({ enabled: true, examples, internalExport: authority.grants.includes('export:internal'), grammarVersion: QUESTION_GRAMMAR_VERSION, permissionRevision: authority.permissionRevision });
  } catch (error) {
    const denied = error instanceof Error && ['QUERY_DENIED', 'QUERY_UNAUTHENTICATED'].includes(error.message);
    return json({ enabled: false, examples: [] }, denied ? 403 : 503);
  }
}
