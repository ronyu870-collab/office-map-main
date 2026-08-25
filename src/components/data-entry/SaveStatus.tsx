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
  idle: { label: 'Ready', tone: 'text-zinc-500' },
  unsaved: { label: 'Unsaved changes', tone: 'text-amber-700' },
  saving: { label: 'Saving…', tone: 'text-[#003e7e]' },
  saved: { label: 'Saved', tone: 'text-emerald-700' },
  error: { label: 'Save failed', tone: 'text-rose-700' },
  submitting: { label: 'Submitting…', tone: 'text-[#003e7e]' },
  submitted: { label: 'Submitted', tone: 'text-emerald-700' },
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
      className={`inline-flex min-h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] ${meta.tone} ${className}`}
      role={state === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-save-state={state}
    >
      <Icon size={13} aria-hidden="true" className={state === 'saving' || state === 'submitting' ? 'animate-spin' : ''} />
      <span className="font-semibold">{meta.label}</span>
      {message && <span className="hidden max-w-64 truncate text-zinc-500 sm:inline">{message}</span>}
      {time && (state === 'saved' || state === 'submitted') && (
        <span className="text-zinc-400">{time}</span>
      )}
      {state === 'error' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
        >
          Retry
        </button>
      )}
    </div>
  );
}
