'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { logErrorToService } from '@/src/utils/errorLogger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * RootErrorBoundary - 根级错误边界
 * 
 * 用于捕获整个应用的灾难性错误
 * 提供友好的错误UI和恢复选项
 */
export class RootErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 记录错误到控制台
    console.error('🔴 [RootErrorBoundary] Catastrophic error caught:', error);
    console.error('Error info:', errorInfo);

    // 更新状态
    this.setState({
      error,
      errorInfo,
    });

    // 发送错误到监控服务
    logErrorToService(error, errorInfo, 'RootErrorBoundary');
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 p-4">
          <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl border border-zinc-200 overflow-hidden">
            {/* 错误图标区域 */}
            <div className="bg-gradient-to-r from-red-500 to-red-600 p-8 text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 rounded-full mb-4">
                <AlertTriangle className="text-white" size={40} />
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">
                应用遇到了意外错误
              </h1>
              <p className="text-red-100 text-lg">
                我们已记录此问题,正在努力修复
              </p>
            </div>

            {/* 错误详情 */}
            <div className="p-8">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-zinc-900 mb-3">
                  错误信息
                </h2>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-mono text-red-800 break-words">
                    {this.state.error?.message || '未知错误'}
                  </p>
                </div>
              </div>

              {/* 开发环境显示堆栈信息 */}
              {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-zinc-900 mb-3">
                    堆栈跟踪 (仅开发环境)
                  </h2>
                  <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 max-h-64 overflow-auto">
                    <pre className="text-xs font-mono text-zinc-700 whitespace-pre-wrap">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-3">
                <button
                  onClick={this.handleReload}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#003e7e] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#002b5e] transition"
                >
                  <RefreshCw size={18} />
                  重新加载页面
                </button>
                <button
                  onClick={this.handleGoHome}
                  className="flex-1 flex items-center justify-center gap-2 bg-white text-zinc-700 px-6 py-3 rounded-lg font-semibold border border-zinc-300 hover:bg-zinc-50 transition"
                >
                  <Home size={18} />
                  返回首页
                </button>
              </div>

              {/* 帮助信息 */}
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>💡 提示:</strong> 如果问题持续存在,请尝试清除浏览器缓存或联系技术支持。
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
