/**
 * ErrorBoundary 组件
 * 
 * React 错误边界组件，用于捕获组件树中的 JavaScript 错误，
 * 记录错误日志，并显示友好的降级 UI。
 * 
 * 功能：
 * 1. 捕获子组件树中的渲染错误
 * 2. 显示友好的错误提示界面
 * 3. 提供重试按钮允许用户刷新页面
 * 4. 记录错误信息到控制台
 * 
 * 使用方法：
 * ```tsx
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 * 
 * 或使用自定义降级 UI：
 * ```tsx
 * <ErrorBoundary fallback={<CustomErrorUI />}>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 * 
 * Requirements: 7.1, 7.5
 */

'use client';

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // 更新 state 使下一次渲染能够显示降级 UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 记录错误信息到控制台
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    // 可以在这里添加错误上报服务
    // 例如：logErrorToService(error, errorInfo);
  }

  handleReset = () => {
    // 重置错误状态并刷新页面
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // 如果提供了自定义降级 UI，则使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 默认降级 UI
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md rounded-lg border border-red-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <svg
                className="text-red-500"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h2 className="text-lg font-semibold text-gray-900">页面加载失败</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {this.state.error?.message || '发生未知错误，请刷新页面重试'}
            </p>
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
