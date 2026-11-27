"use client";

import { useRef } from "react";
import styles from "./workspace.module.css";

type Props = {
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
};

export function PanelSeparator({ side, width, min, max, onResize }: Props) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const direction = side === "left" ? 1 : -1;
  const resize = (next: number) => onResize(Math.round(Math.max(min, Math.min(max, next))));

  return (
    <div
      className={styles.resizePanel}
      data-side={side}
      role="separator"
      aria-label={side === "left" ? "调整左栏宽度" : "调整右栏宽度"}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointerId === event.pointerId) {
          resize(start.width + (event.clientX - start.x) * direction);
        }
      }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const steps: Record<string, number> = {
          ArrowLeft: width - 12 * direction,
          ArrowRight: width + 12 * direction,
          Home: min,
          End: max,
        };
        const next = steps[event.key];
        if (typeof next !== "number") return;
        event.preventDefault();
        resize(next);
      }}
    />
  );
}
