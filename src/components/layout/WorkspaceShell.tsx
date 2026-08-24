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
    <div className={`flex min-h-dvh flex-col bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)] ${className}`}>
      {header ? (
        <header className="sticky top-0 z-[var(--cd-z-sticky)] shrink-0 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
          {header}
        </header>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {sidebar ? (
          <aside className="hidden w-60 shrink-0 overflow-hidden border-r border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] lg:block">
            {sidebar}
          </aside>
        ) : null}
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        {aside ? (
          <aside className="hidden w-80 shrink-0 overflow-hidden border-l border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] xl:block">
            {aside}
          </aside>
        ) : null}
      </div>
      {footer ? (
        <footer className="shrink-0 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
