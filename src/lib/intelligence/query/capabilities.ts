import { authorizePlan } from './admission';
import { queryHttpDependencies } from './http';
import { QUESTION_GRAMMAR_VERSION, QUESTION_SUBMARKETS, resolveBusinessQuestion } from './question';
import { verifyQueryIdentity } from './serverAuthority';
import { loadEntryAuthority } from './entryAuthority';
import { loadFutureAuthority } from './future/reader';

export type QueryCapabilities = { enabled: boolean; examples: string[]; grammarVersion?: string; permissionRevision?: string; internalExport?: boolean };
export async function handleQueryCapabilities(request: Request, dependencies: ReturnType<typeof queryHttpDependencies>): Promise<Response> {
  const json = (body: QueryCapabilities, status = 200) => Response.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', Vary: 'Authorization, X-Colliers-Impersonate-User', 'X-Content-Type-Options': 'nosniff',
  } });
  if (!dependencies.enabled) return json({ enabled: false, examples: [] });
  try {
    const identity = await verifyQueryIdentity(request, dependencies.client);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
    const authority = await loadEntryAuthority(dependencies.client, identity, signal);
    const market = QUESTION_SUBMARKETS.find(name => authority.allSubmarkets || authority.submarkets.includes(name)) ?? '全部获权楼宇';
    // Examples describe syntax, not the existence, period coverage or value of data.
    const examples = [`${market}有哪些楼`, `${market}最高的楼是什么`, `2026年第三季度${market}净有效租金`, `2026年第三季度${market}空置率`, `${market}净有效租金2026Q1至2026Q3趋势各期样本`, '2026Q3全部获权楼宇净有效租金按子市场比较', '2026Q3全部获权楼宇空置率按子市场和等级交叉统计', '2026Q3全部获权楼宇净有效租金与空置率关系', '2026Q3全部获权楼宇净有效租金分布', `上季度${market}净有效租金`, `${market}空置率最近4个已结束季度趋势各期样本`, `当前填报季度${market}填报进度`, `当前填报季度${market}哪些楼还没填`, `当前填报季度${market}人员填报进度`, `当前填报季度${market}填报数据质量`]
      .filter(question => {
        const result = resolveBusinessQuestion(question, new Date());
        if (result.kind !== 'plan' || !authority.allBuildings && !authority.buildingIds.length) return false;
        try { authorizePlan(result.plan, authority); return true; } catch { return false; }
      });
    if (authority.grants.includes('query:future-catalog')) {
      try {
        const future = await loadFutureAuthority(dependencies.client, identity, signal);
        if (future.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_AUTHORITY_CHANGED');
        const market = QUESTION_SUBMARKETS.find(name => future.allSubmarkets || future.submarkets.includes(name)) ?? '全部获权';
        for (const question of [`${market}未来供应有哪些`, `${market}未来供应预计时间精度`, `当前填报季度${market}未来供应填报进度`, `当前填报季度${market}未来供应填报数据质量`]) {
          const resolved = resolveBusinessQuestion(question, new Date());
          if (resolved.kind !== 'plan') continue;
          try { authorizePlan(resolved.plan, future); examples.push(question); } catch { /* No unsupported capability is advertised. */ }
        }
      } catch (error) {
        // A missing future scope may coexist with valid stock access. A failed
        // authority lookup must never be mistaken for a denied optional scope.
        if (!(error instanceof Error) || error.message !== 'QUERY_DENIED') throw error;
      }
    }
    const current = await loadEntryAuthority(dependencies.client, identity, signal);
    if (current.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
    return json({ enabled: true, examples, internalExport: authority.grants.includes('export:internal'), grammarVersion: QUESTION_GRAMMAR_VERSION, permissionRevision: authority.permissionRevision });
  } catch (error) {
    const denied = error instanceof Error && ['QUERY_DENIED', 'QUERY_UNAUTHENTICATED'].includes(error.message);
    return json({ enabled: false, examples: [] }, denied ? 403 : 503);
  }
}
