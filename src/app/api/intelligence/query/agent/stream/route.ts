import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';
import { handleAgentStream } from '@/src/lib/intelligence/agent/agentStreamHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function POST(request: Request): Response {
  try { return handleAgentStream(request, queryHttpDependencies()); }
  catch {
    return Response.json({ status: 'unavailable',
      error: 'AI 流式服务配置暂不可用，本次没有生成模型回答。' },
    { status: 503, headers: { 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff' } });
  }
}
