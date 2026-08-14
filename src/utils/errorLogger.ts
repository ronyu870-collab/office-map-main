import type { ErrorInfo } from 'react';

/**
 * 错误日志服务
 * 
 * 用于将错误发送到监控服务(如 Sentry, LogRocket 等)
 * 目前实现为控制台日志,可以根据需要集成第三方服务
 */

interface ErrorLogData {
  error: Error;
  errorInfo?: ErrorInfo;
  context?: string;
  userId?: string;
  timestamp: string;
  userAgent: string;
  url: string;
}

/**
 * 记录错误到监控服务
 */
export function logErrorToService(
  error: Error,
  errorInfo?: ErrorInfo,
  context?: string
): void {
  const errorData: ErrorLogData = {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } as Error,
    errorInfo,
    context,
    timestamp: new Date().toISOString(),
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'unknown',
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
  };

  // 开发环境：输出到控制台
  if (process.env.NODE_ENV === 'development') {
    console.group(`🔴 Error Log: ${context || 'Unknown Context'}`);
    console.error('Error:', error);
    console.error('Error Info:', errorInfo);
    console.error('Full Data:', errorData);
    console.groupEnd();
  }

  // 生产环境：发送到监控服务
  if (process.env.NODE_ENV === 'production') {
    // TODO: 集成第三方监控服务
    // 示例：Sentry
    // Sentry.captureException(error, {
    //   contexts: {
    //     react: {
    //       componentStack: errorInfo?.componentStack,
    //     },
    //   },
    //   tags: {
    //     context,
    //   },
    // });

    // 示例：自定义 API 端点
    // fetch('/api/log-error', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(errorData),
    // }).catch(err => {
    //   console.error('Failed to log error:', err);
    // });

    // 当前统一输出到控制台，便于前端定位问题
    console.error('[Error Logger]', errorData);
  }
}

/**
 * 记录错误到 Supabase audit_logs 表
 * 
 * 注意：这是一个可选的实现,用于将错误记录到数据库
 * 需要确保不会因为日志记录失败而影响用户体验
 */
export async function logErrorToDatabase(
  error: Error,
  context?: string,
  userId?: string
): Promise<void> {
  try {
    // TODO: 实现数据库日志记录
    // const { error: dbError } = await supabase
    //   .from('error_logs')
    //   .insert({
    //     error_message: error.message,
    //     error_stack: error.stack,
    //     context,
    //     user_id: userId,
    //     created_at: new Date().toISOString(),
    //   });
    // 
    // if (dbError) {
    //   console.error('Failed to log error to database:', dbError);
    // }
  } catch (err) {
    // 静默失败,不影响用户体验
    console.error('Error logging to database:', err);
  }
}
