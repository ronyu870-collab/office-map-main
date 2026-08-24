import type { ReactNode } from "react";

type WorkspaceShellProps = {
  header?: ReactNode;
  sidebar?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function WorkspaceShell({
  header,
  sidebar,
  aside,
  footer,
  children,
  className = "",
}: WorkspaceShellProps) {
  return (
    <div className={`min-h-dvh bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)] ${className}`}>
      {header ? (
        <div className="sticky top-0 z-[var(--cd-z-sticky)] border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
          {header}
        </div>
      ) : null}
      <div className="flex min-h-0">
        {sidebar ? (
          <aside className="hidden w-60 shrink-0 border-r border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] lg:block">
            {sidebar}
          </aside>
        ) : null}
        <main className="min-w-0 flex-1">{children}</main>
        {aside ? (
          <aside className="hidden w-80 shrink-0 border-l border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] xl:block">
            {aside}
          </aside>
        ) : null}
      </div>
      {footer ? (
        <footer className="border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
