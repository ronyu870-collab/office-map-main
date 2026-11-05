'use client';

import * as React from 'react';

import { Button, Input } from '@/src/components/ui';

export interface SearchBarProps {
  /** 输入框占位符 */
  placeholder?: string;
  /** Optional accessible name; existing callers keep their current behavior. */
  inputLabel?: string;
  /** Invalidate a retained input's pending search when its workspace changes. */
  searchContextKey?: string | number;
  /**
   * 搜索回调：把用户输入的“当前值”抛给父组件
   * - 组件内部不做任何请求逻辑
   */
  onSearch: (value: string) => void;
  /**
   * 防抖时间（毫秒）
   * - 默认 250ms：输入流畅且不会过于频繁触发
   * - 设为 0：禁用防抖（每次输入都立即触发）
   */
  debounceMs?: number;
  /** 可选：受控值（不传则组件内部自维护） */
  value?: string;
  /** 可选：受控模式下的 onChange */
  onChange?: (value: string) => void;
}

function useDebouncedCallback<T extends (...args: any[]) => void>(cb: T, delayMs: number) {
  const cbRef = React.useRef(cb);
  React.useEffect(() => {
    cbRef.current = cb;
  }, [cb]);

  const timerRef = React.useRef<number | null>(null);

  const cancel = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = React.useCallback(
    (...args: Parameters<T>) => {
      cancel();
      cbRef.current(...args);
    },
    [cancel],
  );

  const debounced = React.useCallback(
    (...args: Parameters<T>) => {
      cancel();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        cbRef.current(...args);
      }, Math.max(0, delayMs));
    },
    [cancel, delayMs],
  );

  React.useEffect(() => cancel, [cancel]);

  return { debounced, flush, cancel };
}

export function SearchBar({
  placeholder = '搜索…',
  inputLabel,
  searchContextKey,
  onSearch,
  debounceMs = 250,
  value,
  onChange,
}: SearchBarProps) {
  const isControlled = typeof value === 'string';
  const [inner, setInner] = React.useState('');
  const currentValue = isControlled ? value : inner;
  const composing = React.useRef(false);

  const { debounced, flush, cancel } = useDebouncedCallback((v: string, requestedContext: string | number | undefined) => {
    if (searchContextKey !== undefined && (
      requestedContext !== searchContextKey || (isControlled && v.trim() !== currentValue.trim())
    )) return;
    onSearch(v);
  }, debounceMs);

  function setValue(next: string) {
    if (!isControlled) setInner(next);
    onChange?.(next);
  }

  function scheduleSearch(next: string) {
    if (debounceMs > 0) debounced(next, searchContextKey);
    else onSearch(next);
  }

  return (
    <div className="flex w-full items-center gap-2">
      <div className="relative flex w-full items-center">
        <span className="pointer-events-none absolute left-3 inline-flex h-5 w-5 items-center justify-center text-zinc-400">
          {/* 无依赖放大镜 SVG */}
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
            <path
              d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M16.5 16.5 21 21"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>

        <Input
          aria-label={inputLabel}
          value={currentValue}
          onChange={e => {
            const v = e.target.value;
            setValue(v);
            if (!composing.current) scheduleSearch(v);
          }}
          onCompositionStart={() => {
            composing.current = true;
            cancel();
          }}
          onCompositionEnd={e => {
            composing.current = false;
            const v = e.currentTarget.value;
            if (v !== currentValue) setValue(v);
            scheduleSearch(v);
          }}
          onKeyDown={e => {
            // Some browsers report keyCode 229 when Enter confirms an IME candidate.
            if (e.key === 'Enter' && !composing.current && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
              flush(currentValue.trim(), searchContextKey);
            }
          }}
          placeholder={placeholder}
          className="pl-10"
          type="search"
          inputMode="search"
          autoComplete="off"
        />
      </div>

      <Button
        type="button"
        onClick={() => flush(currentValue.trim(), searchContextKey)}
        variant="secondary"
      >
        搜索
      </Button>
    </div>
  );
}
