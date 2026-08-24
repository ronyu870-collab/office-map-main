import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export function Input({ className = "", invalid = false, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`h-9 w-full rounded-[var(--cd-radius-md)] border bg-[var(--cd-color-surface)] px-3 text-[var(--cd-font-size-md)] text-[var(--cd-color-text-primary)] outline-none transition-colors duration-[var(--cd-motion-fast)] placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[color:rgb(0_62_126_/_0.12)] disabled:cursor-not-allowed disabled:bg-[var(--cd-color-surface-alt)] disabled:text-[var(--cd-color-text-muted)] ${invalid ? "border-[var(--cd-color-danger)]" : "border-[var(--cd-color-border)]"} ${className}`}
      {...props}
    />
  );
}
