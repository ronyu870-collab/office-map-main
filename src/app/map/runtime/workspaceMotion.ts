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
    const timer = window.setTimeout(() => setPresent(false), WORKSPACE_MOTION.state);
    return () => window.clearTimeout(timer);
  }, [open]);
  return { present: open || present, children: open ? children : retained.current, exiting: !open && present };
}
export function useSurfaceMotion(ref: React.RefObject<HTMLElement | null>, open: boolean, compact: boolean, signature: string) {
  const previous = React.useRef<{ box: DOMRect; open: boolean; signature: string } | null>(null);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const before = previous.current;
    const box = element.getBoundingClientRect();
    previous.current = { box, open, signature };
    if (!before || before.open === open && before.signature === signature) return;
    const offset = compact ? 'translateY(20px)' : element.classList.contains('map-workspace-left') ? 'translateX(-20px)' : 'translateX(20px)';
    let animation: Animation | undefined;
    if (!open) animation = animateWorkspace(element, [{ opacity: 1, transform: 'translate(0,0)' }, { opacity: 0, transform: offset }], WORKSPACE_MOTION.state, 'forwards');
    else if (!before.open) animation = animateWorkspace(element, [{ opacity: .5, transform: offset }, { opacity: 1, transform: 'translate(0,0)' }]);
    else {
      const shift = compact ? before.box.top - box.top : before.box.left - box.left;
      animation = animateWorkspace(element, [{ transform: compact ? `translateY(${shift}px)` : `translateX(${shift}px)`, clipPath: `inset(0 0 ${Math.max(0, box.height - before.box.height)}px 0)` }, { transform: 'translate(0,0)', clipPath: 'inset(0)' }]);
    }
    return () => animation?.cancel();
  }, [compact, open, ref, signature]);
}
