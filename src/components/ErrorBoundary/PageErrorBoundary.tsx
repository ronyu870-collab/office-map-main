'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { logErrorToService } from '@/src/utils/errorLogger';

interface Props {
  children: ReactNode;
  pageName?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

/**
 * PageErrorBoundary - 页面级错误边界
 * 
 * 用于捕获单个页面的错误,不影响整个应用
 * 提供页面级的错误恢复选项
 */
export class PageErrorBoundary extends Component<Props, State> {
  private resetTimeout: NodeJS.Timeout | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { pageName = 'Unknown Page' } = this.props;
    
    console.error(`🟡 [PageErrorBoundary] Error in ${pageName}:`, error);
    console.error('Error info:', errorInfo);

    // 更新错误计数
    this.setState(prev => ({
      errorCount: prev.errorCount + 1,
    }));

    // 发送错误到监控服务
    logErrorToService(error, errorInfo, `PageErrorBoundary: ${pageName}`);
  }

  componentWillUnmount(): void {
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });

    // 调用自定义重置回调
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleGoBack = (): void => {
    window.history.back();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { pageName = '此页面' } = this.props;
      const { errorCount } = this.state;

      // 如果错误次数过多,建议刷新整个页面
      const tooManyErrors = errorCount >= 3;

      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="max-w-lg w-full bg-white rounded-xl shadow-lg border border-zinc-200 overflow-hidden">
            {/* 错误标题 */}
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-6 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-3">
                <AlertCircle className="text-white" size={32} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-1">
                {pageName}加载失败
              </h2>
              <p className="text-amber-100">
                页面遇到了一个错误
              </p>
            </div>

            {/* 错误内容 */}
            <div className="p-6">
              <div className="mb-6">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-sm text-amber-900 mb-2">
                    <strong>错误详情:</strong>
                  </p>
                  <p className="text-sm font-mono text-amber-800 break-words">
                    {this.state.error?.message || '未知错误'}
                  </p>
                </div>
              </div>

              {/* 错误次数警告 */}
              {tooManyErrors && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">
                    <strong>⚠️ 警告:</strong> 此页面已多次出错,建议刷新整个页面或返回上一页。
                  </p>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-3">
                {!tooManyErrors ? (
                  <>
                    <button
                      onClick={this.handleReset}
                      className="flex-1 flex items-center justify-center gap-2 bg-[#003e7e] text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-[#002b5e] transition"
                    >
                      <RefreshCw size={16} />
                      重试
                    </button>
                    <button
                      onClick={this.handleGoBack}
                      className="flex-1 flex items-center justify-center gap-2 bg-white text-zinc-700 px-4 py-2.5 rounded-lg font-semibold border border-zinc-300 hover:bg-zinc-50 transition"
                    >
                      <ArrowLeft size={16} />
                      返回
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => window.location.reload()}
                      className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-red-700 transition"
                    >
                      <RefreshCw size={16} />
                      刷新页面
                    </button>
                    <button
                      onClick={this.handleGoBack}
                      className="flex-1 flex items-center justify-center gap-2 bg-white text-zinc-700 px-4 py-2.5 rounded-lg font-semibold border border-zinc-300 hover:bg-zinc-50 transition"
                    >
                      <ArrowLeft size={16} />
                      返回
                    </button>
                  </>
                )}
              </div>

              {/* 开发环境信息 */}
              {process.env.NODE_ENV === 'development' && (
                <div className="mt-4 p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                  <p className="text-xs text-zinc-600">
                    <strong>开发模式:</strong> 错误次数 {errorCount}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
