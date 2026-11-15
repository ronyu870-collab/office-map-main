export type QueryFailureKind = 'network' | 'timeout' | 'identity' | 'service';

export class QueryClientError extends Error {
  constructor(readonly kind: QueryFailureKind, message: string) {
    super(message); this.name = 'QueryClientError';
  }
}

/** Only recognized states get specific guidance. Never surface raw transport payloads. */
export function queryFailureMessage(error: unknown): string {
  if ((error instanceof QueryClientError && error.kind === 'timeout')
    || (!!error && typeof error === 'object' && 'name' in error && error.name === 'TimeoutError')) {
    return '等待响应超时，服务端可能仍在处理。请检查状态或重试本次请求，继续使用原请求编号，不会另发一笔查询。';
  }
  if ((error instanceof QueryClientError && error.kind === 'network') || error instanceof TypeError) {
    return '网络连接中断，尚未确认本次请求的处理结果。连接恢复后可重试本次请求，核对原请求而不重复执行。';
  }
  if (error instanceof QueryClientError && error.kind === 'identity') return '登录身份已变化，旧对话已收起。请重新进入 Colliers AI。';
  if (error instanceof QueryClientError && error.kind === 'service') return '查询服务暂时不可用，不能据此判断没有数据。可稍后检查状态或重试本次请求。';
  return '未能取得查询响应。可用“重试本次请求”核对原请求，避免重复执行。';
}
