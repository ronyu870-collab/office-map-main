/**
 * ErrorBoundary 组件测试
 * 
 * 测试错误边界组件的核心功能：
 * 1. 捕获子组件的错误
 * 2. 显示友好的错误提示
 * 3. 提供重试功能
 * 4. 支持自定义降级 UI
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// 创建一个会抛出错误的测试组件
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('测试错误');
  }
  return <div>正常内容</div>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // 清除控制台错误，避免测试输出污染
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('应该正常渲染子组件（无错误时）', () => {
    render(
      <ErrorBoundary>
        <div>测试内容</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('测试内容')).toBeTruthy();
  });

  it('应该捕获子组件的错误并显示降级 UI', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // 验证显示了错误提示
    expect(screen.getByText('页面加载失败')).toBeTruthy();
    expect(screen.getByText('测试错误')).toBeTruthy();
    expect(screen.getByRole('button', { name: /刷新页面/i })).toBeTruthy();
  });

  it('应该记录错误到控制台', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // 验证 console.error 被调用
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('应该支持自定义降级 UI', () => {
    const customFallback = <div>自定义错误界面</div>;

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // 验证显示了自定义降级 UI
    expect(screen.getByText('自定义错误界面')).toBeTruthy();
    expect(screen.queryByText('页面加载失败')).toBeNull();
  });

  it('应该在点击重试按钮时刷新页面', () => {
    // Mock window.location.reload
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    const retryButton = screen.getByRole('button', { name: /刷新页面/i });
    retryButton.click();

    // 验证调用了 window.location.reload
    expect(reloadMock).toHaveBeenCalled();
  });

  it('应该在未知错误时显示默认错误消息', () => {
    // 创建一个抛出无消息错误的组件
    const ThrowUnknownError = () => {
      throw new Error();
    };

    render(
      <ErrorBoundary>
        <ThrowUnknownError />
      </ErrorBoundary>
    );

    // 验证显示了默认错误消息
    expect(screen.getByText('发生未知错误，请刷新页面重试')).toBeTruthy();
  });
});
