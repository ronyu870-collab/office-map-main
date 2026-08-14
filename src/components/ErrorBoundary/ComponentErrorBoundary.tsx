'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { logErrorToService } from '@/src/utils/errorLogger';

interface Props {
  children: ReactNode;
  componentName?: string;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ComponentErrorBoundary - 组件级错误边界
 * 
 * 用于捕获单个组件的错误(如图表、表格等重型组件)
 * 提供轻量级的错误UI,不影响页面其他部分
 */
export class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { componentName = 'Unknown Component', onError } = this.props;
    
    console.error(`🟢 [ComponentErrorBoundary] Error in ${componentName}:`, error);
    console.error('Error info:', errorInfo);

    // 调用自定义错误处理回调
    if (onError) {
      onError(error, errorInfo);
    }

    // 发送错误到监控服务
    logErrorToService(error, errorInfo, `ComponentErrorBoundary: ${componentName}`);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { componentName = '此组件', fallback } = this.props;

      // 如果提供了自定义 fallback,使用它
      if (fallback) {
        return fallback;
      }

      // 默认错误UI - 轻量级,不占用太多空间
      return (
        <div className="flex items-center justify-center p-6 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="text-center max-w-md">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-100 rounded-full mb-3">
              <AlertCircle className="text-amber-600" size={24} />
            </div>
            <h3 className="text-base font-semibold text-zinc-900 mb-2">
              {componentName}加载失败
            </h3>
            <p className="text-sm text-zinc-600 mb-4">
              {this.state.error?.message || '组件遇到了一个错误'}
            </p>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 bg-[#003e7e] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#002b5e] transition"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
