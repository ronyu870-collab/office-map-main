import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export function Input({ className = "", invalid = false, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`h-[var(--cd-control-height-md)] w-full rounded-[var(--cd-radius-md)] border bg-[var(--cd-color-surface)] px-3 text-[var(--cd-font-size-md)] text-[var(--cd-color-text-primary)] outline-none transition-colors duration-[var(--cd-motion-fast)] placeholder:text-[var(--cd-color-text-muted)] disabled:cursor-not-allowed disabled:bg-[var(--cd-color-surface-alt)] disabled:text-[var(--cd-color-text-muted)] ${invalid ? "border-[var(--cd-color-danger)] focus:border-[var(--cd-color-danger)] focus:ring-2 focus:ring-[color:rgb(201_54_43_/_0.12)]" : "border-[var(--cd-color-border)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"} ${className}`}
      {...props}
    />
  );
}
