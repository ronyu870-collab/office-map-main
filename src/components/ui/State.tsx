import type { ReactNode } from "react";

export function LoadingState({
  label = "正在加载",
  rows = 4,
  className = "",
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  if (rows === 0) {
    return (
      <div
        className={`flex items-center justify-center gap-2 text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-secondary)] ${className}`}
        aria-live="polite"
        aria-busy="true"
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--cd-color-brand)] border-t-transparent" aria-hidden="true" />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`} aria-live="polite" aria-busy="true">
      <div className="h-8 w-44 animate-pulse rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)]" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="h-10 animate-pulse rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]"
          />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

type StateMessageProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: StateMessageProps) {
  return <StateMessage title={title} description={description} action={action} />;
}

export function ErrorState({ title, description, action }: StateMessageProps) {
  return <StateMessage title={title} description={description} action={action} tone="danger" />;
}

function StateMessage({
  title,
  description,
  action,
  tone = "neutral",
}: StateMessageProps & { tone?: "neutral" | "danger" }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-[var(--cd-radius-lg)] border border-dashed border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-6 py-8 text-center">
      <div className={`text-[var(--cd-font-size-lg)] font-semibold ${tone === "danger" ? "text-[var(--cd-color-danger)]" : "text-[var(--cd-color-text-primary)]"}`}>
        {title}
      </div>
      {description ? (
        <p className="mt-1 max-w-lg text-[var(--cd-font-size-md)] text-[var(--cd-color-text-secondary)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
