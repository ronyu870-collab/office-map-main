import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export function Input({ className = "", invalid = false, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`h-[var(--cd-control-height-md)] max-sm:min-h-11 max-sm:text-base pointer-coarse:min-h-11 pointer-coarse:text-base w-full rounded-[var(--cd-radius-md)] border bg-[var(--cd-color-surface)] px-3 text-[var(--cd-font-size-md)] text-[var(--cd-color-text-primary)] outline-none transition-colors duration-[var(--cd-motion-fast)] motion-reduce:transition-none placeholder:text-[var(--cd-color-text-secondary)] disabled:cursor-not-allowed disabled:bg-[var(--cd-color-surface-alt)] disabled:text-[var(--cd-color-text-secondary)] ${invalid ? "border-[var(--cd-color-danger)] focus:border-[var(--cd-color-danger)] focus:ring-2 focus:ring-[color:rgb(201_54_43_/_0.12)]" : "border-[var(--cd-color-border)] enabled:hover:border-[var(--cd-color-border-strong)] focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"} ${className}`}
      {...props}
    />
  );
}
