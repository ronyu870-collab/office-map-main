import { assistantCopyOutputSchema } from '@/src/lib/intelligence/query/assistantCopyProtocol';
import { receiveTrustedQueryValue, trustedQueryRequest, type QueryClientScope } from './trustedQueryClient';

/** Share the existing authenticated transport, identity-race guards and signed
 * delivery receipts. This is not a second browser data client. */
export async function copyAssistantResponse(scope: QueryClientScope,
  input: { requestId: string; conversationId: string }, signal: AbortSignal) {
  const raw = await trustedQueryRequest('/copy', scope, signal, { ...input, action: 'copy' });
  const parsed = assistantCopyOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const denied = raw && typeof raw === 'object' && 'status' in raw && raw.status === 'denied';
    throw new Error(denied ? '当前没有复制此回答的权限，请重新打开对话。' : '回答暂时无法复制，请稍后重试。');
  }
  const value = parsed.data;
  if (value.requestId !== input.requestId || value.conversationId !== input.conversationId)
    throw new Error('复制内容与当前回答不一致，请重新打开对话。');
  signal.throwIfAborted();
  return receiveTrustedQueryValue(scope, raw, value);
}

