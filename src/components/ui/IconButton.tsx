import type { ComponentProps } from "react";

import { Button } from "./Button";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "size" | "aria-label"> & {
  label: string;
  size?: "sm" | "md";
};

export function IconButton({ label, size = "md", title, className = "", ...props }: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={title ?? label}
      size="icon"
      className={`${size === "sm" ? "!h-[var(--cd-control-height-sm)] !w-[var(--cd-control-height-sm)]" : ""} ${className}`}
      {...props}
    />
  );
}
