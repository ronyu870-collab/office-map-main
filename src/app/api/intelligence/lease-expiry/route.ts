import { NextResponse } from 'next/server';
import { chinaToday, saveReviewSchema } from '@/src/lib/leaseExpiry/contracts';
import { requireLeaseReviewAdmin, reviewJson, reviewRpcError, writeAuditLeaseExpiryReview } from '@/src/lib/leaseExpiry/server';

export async function GET(request: Request) {
  try {
    const context = await requireLeaseReviewAdmin(request);
    if (context instanceof NextResponse) return context;
    const params = new URL(request.url).searchParams;
    const page = Number(params.get('page') ?? 1);
    const query = params.get('query')?.trim() ?? '';
    const scope = params.get('scope') ?? 'window';
    if (!Number.isInteger(page) || page < 1 || page > 10000 || query.length > 100 || !['window', 'saved'].includes(scope)) return reviewJson({ error: '筛选条件不正确' }, 400);
    const { data, error } = await context.client.rpc('lease_expiry_review_list', {
      p_actor: context.actorId, p_as_of: chinaToday(), p_page: page, p_query: query, p_scope: scope,
    });
    if (error) return reviewRpcError(error);
    return reviewJson(data);
  } catch { return reviewJson({ error: '读取未完成，请重试' }, 503); }
}
export async function POST(request: Request) {
  try {
    const context = await requireLeaseReviewAdmin(request);
    if (context instanceof NextResponse) return context;
    const raw = await request.text();
    if (raw.length > 20000) return reviewJson({ error: '核实备注过长' }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return reviewJson({ error: '请求格式不正确' }, 400); }
    const input = saveReviewSchema.safeParse(body);
    if (!input.success) return reviewJson({ error: '请检查状态、备注和来源依据；资料不足或来源差异必须说明原因' }, 400);
    const { data, error } = await writeAuditLeaseExpiryReview(context.client, context.actorId, input.data);
    if (error) return reviewRpcError(error);
    return reviewJson(data);
  } catch { return reviewJson({ error: '保存结果未确认。保留当前输入，可重试同一请求。' }, 503); }
}
