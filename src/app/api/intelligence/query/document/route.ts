import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';
import { handleResultRecovery } from '@/src/lib/intelligence/query/recoveryHttp';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
    try {
        return await handleResultRecovery(request, queryHttpDependencies(), 'document');
    }
    catch {
        return Response.json({ status: 'unavailable', error: '原件服务暂不可用。' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    }
}
