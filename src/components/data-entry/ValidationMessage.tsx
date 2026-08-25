'use client';

import * as React from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type ValidationSeverity = 'error' | 'warning' | 'info';

interface ValidationMessageProps {
  severity: ValidationSeverity;
  children: React.ReactNode;
  className?: string;
}

const meta: Record<ValidationSeverity, { className: string; Icon: typeof AlertCircle }> = {
  error: { className: 'border-rose-200 bg-rose-50 text-rose-700', Icon: AlertCircle },
  warning: { className: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertTriangle },
  info: { className: 'border-sky-200 bg-sky-50 text-sky-700', Icon: Info },
};

export function ValidationMessage({ severity, children, className = '' }: ValidationMessageProps) {
  const { className: tone, Icon } = meta[severity];
  return (
    <div className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] leading-4 ${tone} ${className}`} role={severity === 'error' ? 'alert' : 'status'}>
      <Icon size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
