import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-[var(--cd-color-brand)] text-white hover:bg-[var(--cd-color-brand-hover)] focus-visible:outline-[var(--cd-color-brand)]",
  secondary:
    "border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] text-[var(--cd-color-text-primary)] hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline-[var(--cd-color-brand)]",
  ghost:
    "border-transparent bg-transparent text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-[var(--cd-color-brand)]",
  danger:
    "border-transparent bg-[var(--cd-color-danger)] text-white hover:brightness-95 focus-visible:outline-[var(--cd-color-danger)]",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[var(--cd-font-size-sm)]",
  md: "h-9 px-3.5 text-[var(--cd-font-size-md)]",
};

export function Button({
  className = "",
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--cd-radius-md)] border font-medium transition-colors duration-[var(--cd-motion-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...props}
    />
  );
}
