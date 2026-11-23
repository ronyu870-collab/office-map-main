'use client';
import * as React from 'react';

export const WORKSPACE_MOTION = { feedback: 120, state: 180, spatial: 240, easing: 'cubic-bezier(.16,1,.3,1)' } as const;
export function animateWorkspace(element: HTMLElement | null, frames: Keyframe[], duration: number = WORKSPACE_MOTION.state, fill: FillMode = 'none') {
  if (!element?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  return element.animate(frames, { duration, easing: WORKSPACE_MOTION.easing, fill });
}
export function useSurfacePresence(open: boolean, children: React.ReactNode) {
  const retained = React.useRef(children);
  const [present, setPresent] = React.useState(open);
  if (open) retained.current = children;
  React.useLayoutEffect(() => {
    if (open) { setPresent(true); return; }
    if (!HTMLElement.prototype.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setPresent(false); return; }
    const timer = window.setTimeout(() => setPresent(false), WORKSPACE_MOTION.spatial);
    return () => window.clearTimeout(timer);
  }, [open]);
  return { present: open || present, children: open ? children : retained.current, exiting: !open && present };
}
function continuationClip(start: { frame: Keyframe; box: DOMRect }, box: DOMRect) {
  if (Math.abs(start.box.width - box.width) < .5 && Math.abs(start.box.height - box.height) < .5) return start.frame.clipPath;
  const inset = String(start.frame.clipPath ?? '').match(/^inset\(([^)]+)\)/)?.[1].split(/\s+/).map(value => parseFloat(value)) ?? [0];
  const [top, right = top, bottom = top, left = right] = inset;
  const width = Math.max(0, start.box.width - left - right), height = Math.max(0, start.box.height - top - bottom);
  // Insets belong to the old surface size. Reusing a fullscreen inset on a
  // smaller sheet can crop the entire sheet away during a fast reversal.
  return `inset(0 ${Math.max(0, box.width - width)}px ${Math.max(0, box.height - height)}px 0)`;
}
export function useSurfaceMotion(ref: React.RefObject<HTMLElement | null>, open: boolean, compact: boolean, signature: string, { disabled = false }: { disabled?: boolean } = {}) {
  const previous = React.useRef<{ box: DOMRect; open: boolean; signature: string } | null>(null);
  const interrupted = React.useRef<{ frame: Keyframe; box: DOMRect } | null>(null);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const before = previous.current;
    const box = element.getBoundingClientRect();
    previous.current = { box, open, signature };
    if (disabled) { interrupted.current = null; return; }
    if (!before || before.open === open && before.signature === signature) return;
    const offset = compact ? 'translateY(20px)' : element.classList.contains('map-workspace-left') ? 'translateX(-20px)' : 'translateX(20px)';
    let animation: Animation | undefined;
    const start = interrupted.current;
    interrupted.current = null;
    const startFrame = start ? { ...start.frame, clipPath: continuationClip(start, box), ...(Math.abs(before.box.left - box.left) > .5 || Math.abs(before.box.top - box.top) > .5
      ? { transform: `translate(${start.box.left - box.left}px,${start.box.top - box.top}px)` } : {}) } : null;
    if (!open) animation = animateWorkspace(element, [{ opacity: 1, transform: 'translate(0,0)', ...startFrame }, { opacity: 0, transform: offset, clipPath: 'inset(0)' }], WORKSPACE_MOTION.spatial, 'forwards');
    else if (!before.open) animation = animateWorkspace(element, [{ opacity: .5, transform: offset, ...startFrame }, { opacity: 1, transform: 'translate(0,0)', clipPath: 'inset(0)' }], WORKSPACE_MOTION.spatial);
    else {
      const visible = start?.box ?? before.box;
      const x = visible.left - box.left, y = visible.top - box.top;
      const width = Math.max(0, box.width - visible.width), height = Math.max(0, box.height - visible.height);
      // A content/mode change with identical geometry needs no whole-pane motion.
      if (!start && Math.abs(x) < .5 && Math.abs(y) < .5 && Math.abs(box.width - visible.width) < .5 && Math.abs(box.height - visible.height) < .5) return;
      animation = animateWorkspace(element, [{ opacity: 1, ...start?.frame, transform: `translate(${x}px,${y}px)`, clipPath: start ? continuationClip(start, box) : `inset(0 ${width}px ${height}px 0)` }, { opacity: 1, transform: 'translate(0,0)', clipPath: 'inset(0)' }], WORKSPACE_MOTION.spatial);
    }
    return () => {
      if (animation && (animation.playState === 'running' || animation.pending)) {
        const style = window.getComputedStyle(element);
        // Cleanup runs after the new layout has committed. Reconstruct the last
        // visible bounds from this animation's layout, not the newly sized DOM.
        const matrix = typeof DOMMatrixReadOnly === 'undefined' ? null : new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
        const visible = matrix ? new DOMRect(box.left + matrix.m41, box.top + matrix.m42, box.width, box.height) : element.getBoundingClientRect();
        interrupted.current = { frame: { opacity: style.opacity, transform: style.transform, clipPath: style.clipPath }, box: visible };
      }
      animation?.cancel();
    };
  }, [compact, open, ref, signature, disabled]);
}
