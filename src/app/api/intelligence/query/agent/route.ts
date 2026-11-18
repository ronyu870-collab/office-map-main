import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';
import { handleAgentSubmission } from '@/src/lib/intelligence/agent/agentHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try { return await handleAgentSubmission(request, queryHttpDependencies()); }
  catch { return Response.json({ status: 'unavailable', error: 'AI 服务配置或审计组件暂不可用，本次没有生成模型回答。' },
    { status: 503, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }); }
}

