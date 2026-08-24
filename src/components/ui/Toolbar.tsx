import type { HTMLAttributes } from "react";

export function Toolbar({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="toolbar"
      className={`flex min-h-10 flex-wrap items-center gap-2 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2 ${className}`}
      {...props}
    />
  );
}
