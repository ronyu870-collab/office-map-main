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
  presentation?: "dialog" | "fullscreen";
  layer?: "primary" | "child" | "map";
  inactive?: boolean;
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
  presentation = "dialog",
  layer = "primary",
  inactive = false,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => setMounted(true), []);
  useBodyScrollLock(open);
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (!open || presentation !== 'fullscreen') return;
    const update = () => setViewport(window.visualViewport ? { height: window.visualViewport.height, top: window.visualViewport.offsetTop } : null);
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open, presentation]);

  useEffect(() => {
    if (!open || inactive) return;

    const previousFocus = document.activeElement as HTMLElement | null;

    const frame = window.requestAnimationFrame(() => {
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
      (firstFocusable ?? panelRef.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, [open, inactive]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center bg-[var(--cd-color-overlay)] ${presentation === 'fullscreen' ? 'p-0' : 'p-4'}`}
      style={{ zIndex: layer === 'map' ? 1100 : layer === 'child' ? 62 : 'var(--cd-z-modal)', ...(presentation === 'fullscreen' && viewport ? { top: viewport.top, bottom: 'auto', height: viewport.height } : {}) }}
      inert={inactive || undefined}
      aria-hidden={inactive || undefined}
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
        className={`flex w-full flex-col overflow-hidden border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-overlay)] outline-none ${presentation === 'fullscreen' ? 'h-full max-h-full rounded-none' : `max-h-[min(88dvh,760px)] rounded-[var(--cd-radius-lg)] ${sizeClass[size]}`}`}
        onKeyDown={(event) => {
          if (event.defaultPrevented || inactive) return;
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
              className={presentation === "fullscreen" ? "min-h-11 min-w-11" : undefined}
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
