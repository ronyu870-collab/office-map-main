import type { HTMLAttributes } from "react";

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  padding?: "none" | "sm" | "md";
};

const paddingClass = {
  none: "p-0",
  sm: "p-4",
  md: "p-5",
};

export function Panel({ className = "", padding = "md", ...props }: PanelProps) {
  return (
    <div
      className={`rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] ${paddingClass[padding]} ${className}`}
      {...props}
    />
  );
}
