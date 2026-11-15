import { NextResponse } from 'next/server';
import { chinaToday } from '@/src/lib/leaseExpiry/contracts';
import { requireLeaseReviewAdmin, reviewJson, reviewRpcError } from '@/src/lib/leaseExpiry/server';

export async function GET(request: Request) {
  try {
    const context = await requireLeaseReviewAdmin(request);
    if (context instanceof NextResponse) return context;
    const params = new URL(request.url).searchParams;
    const page = Number(params.get('page') ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000 || (params.get('scope') ?? 'window') !== 'window') return reviewJson({ error: '筛选条件不正确' }, 400);
    const { data, error } = await context.client.rpc('lease_expiry_context_list', { p_actor: context.actorId, p_as_of: chinaToday(), p_page: page });
    if (error) return reviewRpcError(error);
    return reviewJson(data);
  } catch { return reviewJson({ error: '读取未完成，请重试' }, 503); }
}
