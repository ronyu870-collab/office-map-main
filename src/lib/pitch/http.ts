import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { pitchCommandSchema, pitchReadSchema } from './contracts/api';
import { authorizePitch, digest, pitchRpc, type PitchDependencies } from './data/store';
import { createProject, createSample, downloadExport, exportProject, upgradeProjectTheme } from './data/workflow';
import { isQuerySameOrigin } from '@/src/lib/intelligence/query/sameOrigin';
import { readQueryBody } from '@/src/lib/intelligence/query/httpBody';
import { PPTX_MIME } from './render/pptx';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, x-colliers-impersonate-user', 'X-Content-Type-Options': 'nosniff' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
export async function handlePitchRequest(request: Request, dependencies: PitchDependencies): Promise<Response> {
  try {
    const ctx = await authorizePitch(request, dependencies);
    if (!isQuerySameOrigin(request)) return reply({ error: '请求来源不受信任。' }, 403);
    if (request.method === 'GET') {
      const parsed = pitchReadSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return reply({ error: '读取参数不合法。' }, 400);
      if (parsed.data.action === 'download') {
        const bytes = await downloadExport(ctx, parsed.data);
        return new Response(Buffer.from(bytes), { headers: { ...headers, 'Content-Type': PPTX_MIME, 'Content-Disposition': 'attachment; filename="pitch.pptx"' } });
      }
      const data = await pitchRpc(ctx, parsed.data);
      if (parsed.data.action === 'list_assets' || parsed.data.action === 'list_projects') {
        const items = z.array(z.object({ id: z.uuid() }).passthrough()).parse(data);
        return reply({ items: items.slice(0, 50), next: items.length > 50 ? items[49].id : null });
      }
      return reply(data);
    }
    if (request.method !== 'POST') return reply({ error: '不支持此方法。' }, 405);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reply({ error: '需要 JSON 请求。' }, 415);
    const body = await readQueryBody(request, randomBytes(32));
    if (body.rejection) return reply({ error: '请求过大或未完整接收。' }, body.rejection === 'body_too_large' ? 413 : 400);
    let raw: unknown; try { raw = JSON.parse(body.text ?? ''); } catch { return reply({ error: 'JSON 格式不合法。' }, 400); }
    const parsed = pitchCommandSchema.safeParse(raw);
    if (!parsed.success) return reply({ error: '参数不合法，请检查输入。' }, 400);
    const command = parsed.data;
    let result: unknown;
    if (command.action === 'sample_create') result = await createSample(ctx, command.requestId, command.scope);
    else if (command.action === 'project_create') result = await createProject(ctx, command);
    else if (command.action === 'project_theme_upgrade') result = await upgradeProjectTheme(ctx, command);
    else if (command.action === 'export') result = await exportProject(ctx, command.projectId, command.audience);
    else result = await pitchRpc(ctx, { ...command, ...(command.action === 'asset_save' ? { sha256: digest(new TextEncoder().encode(JSON.stringify(command.asset.content))) } : {}) });
    return reply(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'QUERY_UNAUTHENTICATED') return reply({ error: '登录状态无效；模拟身份暂不支持 Pitch Studio。' }, 401);
    if (message === 'PITCH_DENIED') return reply({ error: '试点未开放，或当前身份、范围、素材权限已失效。' }, 403);
    if (message === 'PITCH_CONFLICT') return reply({ error: '记录已变化或重试内容不同，请重新读取。' }, 409);
    if (['PITCH_INVALID', 'PITCH_LAYOUT_CAPACITY', 'PITCH_LANGUAGE_UNAVAILABLE', 'PITCH_IMAGE_REQUIRED'].includes(message)) return reply({ error: '内容超出模板容量、缺少数据或语言不匹配，请检查素材。' }, 422);
    return reply({ error: 'Pitch Studio 暂时无法完成操作，请稍后重试。' }, 503);
  }
}
