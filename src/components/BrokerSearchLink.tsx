import Link from 'next/link';
import { Search } from 'lucide-react';

export function BrokerSearchLink() {
  return <Link href="/search" prefetch={false} aria-label="统一搜索" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-[var(--cd-color-brand)] hover:bg-[var(--cd-color-surface-alt)]">
    <Search size={17} aria-hidden="true" /><span className="hidden sm:inline">统一搜索</span>
  </Link>;
}
