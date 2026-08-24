import type { ReactNode } from "react";

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="space-y-3" aria-live="polite" aria-busy="true">
      <div className="h-8 w-44 animate-pulse rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)]" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
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
