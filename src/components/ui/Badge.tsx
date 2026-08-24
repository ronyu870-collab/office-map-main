import type { HTMLAttributes } from "react";

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

const toneClass: Record<BadgeTone, string> = {
  neutral: "bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-secondary)] border-[var(--cd-color-border)]",
  brand: "bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)] border-[color:rgb(0_62_126_/_0.15)]",
  success: "bg-[var(--cd-color-success-soft)] text-[var(--cd-color-success)] border-[color:rgb(22_133_91_/_0.15)]",
  warning: "bg-[var(--cd-color-warning-soft)] text-[var(--cd-color-warning)] border-[color:rgb(194_120_3_/_0.15)]",
  danger: "bg-[var(--cd-color-danger-soft)] text-[var(--cd-color-danger)] border-[color:rgb(201_54_43_/_0.15)]",
};

export function Badge({ className = "", tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-[var(--cd-radius-sm)] border px-2 text-[var(--cd-font-size-xs)] font-medium ${toneClass[tone]} ${className}`}
      {...props}
    />
  );
}
