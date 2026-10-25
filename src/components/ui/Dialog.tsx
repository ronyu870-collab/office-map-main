'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useBodyScrollLock } from "@/src/hooks/useBodyScrollLock";

import { IconButton } from "./IconButton";

type DialogSize = "sm" | "md" | "lg" | "xl";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  closeLabel?: string;
  dismissible?: boolean;
};

const sizeClass: Record<DialogSize, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-6xl",
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  closeLabel = "关闭",
  dismissible = true,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => setMounted(true), []);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement as HTMLElement | null;

    const frame = window.requestAnimationFrame(() => {
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
      (firstFocusable ?? panelRef.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--cd-z-modal)] flex items-center justify-center bg-[var(--cd-color-overlay)] p-4"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`flex max-h-[min(88dvh,760px)] w-full flex-col overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-overlay)] outline-none ${sizeClass[size]}`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && dismissible) {
            event.preventDefault();
            onOpenChange(false);
            return;
          }
          if (event.key !== "Tab") return;

          const focusable = Array.from(
            panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
          ).filter((element) => !element.hasAttribute("disabled"));
          if (focusable.length === 0) {
            event.preventDefault();
            panelRef.current?.focus();
            return;
          }

          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="flex shrink-0 items-start gap-4 border-b border-[var(--cd-color-border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[var(--cd-font-size-lg)] font-semibold text-[var(--cd-color-text-primary)]">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-secondary)]">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <IconButton
              label={closeLabel}
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
