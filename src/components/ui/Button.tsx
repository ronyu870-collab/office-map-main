import type { ComponentPropsWithRef } from "react";
import styles from "./Button.module.css";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
};

export function Button({
  className = "", variant = "primary", size = "md", type = "button",
  loading = false, loadingLabel, disabled, children, ...props
}: ButtonProps) {
  const hasProgress = loading || loadingLabel !== undefined;
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]} ${styles[size]} ${hasProgress ? styles.withProgress : ""} ${loading ? styles.busy : ""} ${className}`}
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || props["aria-busy"] || undefined}
    >
      {hasProgress ? <>
        <span className={styles.content} aria-hidden={loading || undefined}>{children}</span>
        <span className={styles.progress} aria-hidden={!loading || undefined}><span className={styles.spinner} aria-hidden="true" />{loadingLabel ?? <span className="sr-only">正在处理</span>}</span>
      </> : children}
    </button>
  );
}
