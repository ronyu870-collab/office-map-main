import type { ReactNode } from "react";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";

type AppHeaderProps = {
  title: ReactNode;
  leading?: ReactNode;
  homeHref?: string;
  homeLabel?: string;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function AppHeader({
  title,
  leading,
  homeHref,
  homeLabel = "主页",
  status,
  actions,
  className = "",
}: AppHeaderProps) {
  return (
    <div
      className={`flex h-[var(--cd-header-height)] min-w-0 items-center gap-3 px-4 sm:px-5 ${className}`}
    >
      {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[var(--cd-font-size-lg)] font-semibold text-[var(--cd-color-text-primary)]">
          {title}
        </h1>
      </div>
      {status ? <div className="hidden shrink-0 sm:block">{status}</div> : null}
      {homeHref ? (
        <Link
          href={homeHref}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[var(--cd-radius-md)] px-2 text-[var(--cd-font-size-sm)] font-medium text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">{homeLabel}</span>
        </Link>
      ) : null}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
