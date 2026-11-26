'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Cloud, Loader2 } from 'lucide-react';

export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error' | 'submitting' | 'submitted';

interface SaveStatusProps {
  state: SaveState;
  message?: string;
  savedAt?: Date | string | null;
  onRetry?: () => void;
  className?: string;
}

const stateMeta: Record<SaveState, { label: string; tone: string }> = {
  idle: { label: '就绪', tone: 'text-[var(--cd-color-text-secondary)]' },
  unsaved: { label: '有未保存修改', tone: 'text-amber-700' },
  saving: { label: '正在保存…', tone: 'text-[var(--cd-color-brand)]' },
  saved: { label: '已保存', tone: 'text-[var(--cd-color-success)]' },
  error: { label: '保存失败', tone: 'text-[var(--cd-color-danger)]' },
  submitting: { label: '正在提交…', tone: 'text-[var(--cd-color-brand)]' },
  submitted: { label: '已提交', tone: 'text-[var(--cd-color-success)]' },
};

function formatSavedAt(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function SaveStatus({ state, message, savedAt, onRetry, className = '' }: SaveStatusProps) {
  const meta = stateMeta[state];
  const time = formatSavedAt(savedAt);
  const Icon = state === 'error'
    ? AlertCircle
    : state === 'saved' || state === 'submitted'
      ? CheckCircle2
      : state === 'saving' || state === 'submitting'
        ? Loader2
        : Cloud;

  return (
    <div
      className={`inline-flex min-h-8 items-center gap-2 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2.5 py-1.5 text-[var(--cd-font-size-sm)] ${meta.tone} ${className}`}
      role={state === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-save-state={state}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" className={state === 'saving' || state === 'submitting' ? 'animate-spin motion-reduce:animate-none' : ''} />
      <span className="font-medium">{meta.label}</span>
      {message && <span className="hidden max-w-64 truncate text-zinc-500 sm:inline">{message}</span>}
      {time && (state === 'saved' || state === 'submitted') && (
        <span className="tabular-nums text-[var(--cd-color-text-secondary)]">{time}</span>
      )}
      {state === 'error' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 font-medium text-rose-700 underline underline-offset-2 hover:text-rose-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
        >
          重试
        </button>
      )}
    </div>
  );
}
