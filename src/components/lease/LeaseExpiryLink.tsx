'use client';

import Link from 'next/link';
import { CalendarRange } from 'lucide-react';
import { useLeaseExpiryAccess } from './useLeaseExpiryAccess';

export function LeaseExpiryLink({ variant = 'standard' }: { variant?: 'standard' | 'compact' }) {
  const { permitted } = useLeaseExpiryAccess();
  if (!permitted) return null;
  const compact = variant === 'compact';
  return <Link href="/lease-submission/expiry" prefetch={false} aria-label="租约到期" title="租约到期" className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--cd-radius-md)] hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${compact
    ? 'h-8 px-2 text-[var(--cd-font-size-sm)] font-medium text-[var(--cd-color-text-secondary)] hover:text-[var(--cd-color-brand)] max-sm:min-h-11 max-sm:min-w-11'
    : 'min-h-11 border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-sm text-[var(--cd-color-text-primary)]'}`}>
    <CalendarRange size={16} aria-hidden="true" /><span className={compact ? 'hidden sm:inline' : undefined}>租约到期</span>
  </Link>;
}
