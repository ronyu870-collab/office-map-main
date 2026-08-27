'use client';

import { useEffect, useState } from 'react';

interface StatusIndicatorProps {
  isSaving: boolean;
  lastSaved: Date | null;
  error: Error | null;
  isOffline?: boolean;
}

export function StatusIndicator({
  isSaving,
  lastSaved,
  error,
  isOffline = false,
}: StatusIndicatorProps) {
  const [showSaved, setShowSaved] = useState(false);

  // 保存成功后显示 2 秒提示
  useEffect(() => {
    if (lastSaved) {
      setShowSaved(true);
      const timer = setTimeout(() => setShowSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [lastSaved]);

  if (isOffline) {
    return (
      <div className="flex items-center gap-1.5 text-[var(--cd-font-size-sm)] text-[var(--cd-color-warning)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--cd-color-warning)]" />
        <span>离线模式，无法保存</span>
      </div>
    );
  }

  if (error) {
    // 检测权限错误，给出专门提示
    const isPermissionError =
      (error as Error & { code?: string }).code === 'PERMISSION_DENIED' ||
      error.message.includes('权限不足') ||
      error.message.includes('permission') ||
      error.message.includes('unauthorized') ||
      error.message.includes('forbidden');

    return (
      <div className="flex items-center gap-1.5 text-[var(--cd-font-size-sm)] text-[var(--cd-color-danger)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--cd-color-danger)]" />
        <span>
          {isPermissionError
            ? '权限不足，请检查登录状态'
            : `保存失败：${error.message}`}
        </span>
      </div>
    );
  }

  if (isSaving) {
    return (
      <div className="flex items-center gap-1.5 text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-secondary)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--cd-color-text-muted)]" />
        <span>保存中…</span>
      </div>
    );
  }

  if (showSaved && lastSaved) {
    return (
      <div className="flex items-center gap-1.5 text-[var(--cd-font-size-sm)] text-[var(--cd-color-success)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--cd-color-success)]" />
        <span>已自动保存</span>
      </div>
    );
  }

  if (lastSaved) {
    return (
      <div className="flex items-center gap-1.5 text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-muted)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--cd-color-border-strong)]" />
        <span>
          {lastSaved.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          已保存
        </span>
      </div>
    );
  }

  return null;
}
