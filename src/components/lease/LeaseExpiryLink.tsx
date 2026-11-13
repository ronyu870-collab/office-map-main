import Link from 'next/link';
import { CalendarRange } from 'lucide-react';

/** Callers show this only to a real administrator; the destination also authorizes. */
export function LeaseExpiryLink() {
  return <Link href="/lease-submission/expiry" prefetch={false} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-sm text-[var(--cd-color-text-primary)] hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]">
    <CalendarRange size={16} aria-hidden="true" />租约到期
  </Link>;
}
