'use client';

import type { ComponentProps } from "react";

import { Tooltip } from "./Tooltip";
import styles from "./Button.module.css";

import { Button } from "./Button";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "size" | "aria-label"> & {
  label: string;
  size?: "sm" | "md";
};

export function IconButton({ label, size = "md", title, className = "", ref, ...props }: IconButtonProps) {
  return (
    <Tooltip content={title ?? label} forwardedRef={ref}><Button
      aria-label={label}
      size="icon"
      className={`${size === "sm" ? styles.iconSmall : ""} ${className}`}
      {...props}
    /></Tooltip>
  );
}
