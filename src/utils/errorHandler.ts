/**
 * 错误处理工具函数
 * 
 * 用于统一处理数据获取过程中的各种错误类型，
 * 提供友好的用户提示和明确的操作指引。
 */

export interface ErrorInfo {
  type: 'NETWORK_ERROR' | 'AUTH_ERROR' | 'DATA_ERROR' | 'SERVER_ERROR' | 'UNKNOWN_ERROR';
  message: string;
  userAction: string;
  retryable: boolean;
  redirect?: string;
  retryDelay?: number;
}

/**
 * 统一错误处理函数
 * 
 * 根据错误类型返回格式化的错误信息，包含用户友好的提示和操作指引。
 * 
 * @param error - 原始错误对象（可能来自 fetch、Supabase 或其他来源）
 * @returns 格式化的错误信息对象
 * 
 * @example
 * ```typescript
 * try {
 *   const data = await getBuildings();
 * } catch (error) {
 *   const errorInfo = handleDataFetchError(error);
 *   console.error(errorInfo.message);
 *   if (errorInfo.retryable) {
 *     // 显示重试按钮
 *   }
 * }
 * ```
 */
export function handleDataFetchError(error: any): ErrorInfo {
  // 网络错误
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return {
      type: 'NETWORK_ERROR',
      message: '网络连接失败，请检查您的网络设置',
      userAction: '重试',
      retryable: true,
    };
  }

  // 权限错误
  if (error?.status === 401 || error?.code === 'PGRST301') {
    return {
      type: 'AUTH_ERROR',
      message: '登录已过期，请重新登录',
      userAction: '前往登录',
      retryable: false,
      redirect: '/login',
    };
  }

  // 数据错误
  if (error?.code === 'PGRST116' || error?.code === 'PGRST204') {
    return {
      type: 'DATA_ERROR',
      message: '数据格式异常，请联系技术支持',
      userAction: '刷新页面',
      retryable: true,
    };
  }

  // 服务器错误
  if (error?.status >= 500) {
    return {
      type: 'SERVER_ERROR',
      message: '服务暂时不可用，请稍后再试',
      userAction: '重试',
      retryable: true,
      retryDelay: 5000,
    };
  }

  // 未知错误
  return {
    type: 'UNKNOWN_ERROR',
    message: '发生未知错误，请刷新页面重试',
    userAction: '刷新页面',
    retryable: true,
  };
}
