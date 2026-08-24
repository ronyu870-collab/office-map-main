import type { ReactNode } from "react";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  meta,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`flex min-w-0 flex-col gap-3 border-b border-[var(--cd-color-border)] pb-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1 text-[var(--cd-font-size-xs)] font-semibold uppercase tracking-[0.08em] text-[var(--cd-color-brand)]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="truncate text-[var(--cd-font-size-2xl)] font-semibold leading-[var(--cd-line-height-tight)] text-[var(--cd-color-text-primary)]">
          {title}
        </h1>
        {description ? (
          <div className="mt-1 max-w-3xl text-[var(--cd-font-size-md)] text-[var(--cd-color-text-secondary)]">
            {description}
          </div>
        ) : null}
        {meta ? (
          <div className="mt-2 text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-muted)]">
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
