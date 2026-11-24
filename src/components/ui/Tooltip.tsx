'use client';

import { cloneElement, useImperativeHandle, useEffect, useLayoutEffect, useId, useRef, useState, type ComponentPropsWithRef, type ReactElement, type Ref } from 'react';
import styles from './Tooltip.module.css';

// A short shared grace period makes scanning adjacent toolbar actions immediate.
let lastDismissed = -Infinity;
function markDismissed() { lastDismissed = Date.now(); }
function inGracePeriod() { return Date.now() - lastDismissed < 600; }
export function Tooltip({ content, children, forwardedRef }: { content: string; children: ReactElement<ComponentPropsWithRef<'button'>>; forwardedRef?: Ref<HTMLButtonElement> }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  useImperativeHandle(forwardedRef, () => anchor.current!);
  const panel = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [instant, setInstant] = useState(false);
  const visible = useRef(false);
  const id = useId();
  function clear() { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } }
  function close() {
    clear();
    if (visible.current) markDismissed();
    visible.current = false;
    setOpen(false);
  }
  function show(immediate = false) {
    clear();
    const skip = immediate || inGracePeriod();
    setInstant(skip);
    const reveal = () => { timer.current = null; visible.current = true; setOpen(true); };
    if (skip) reveal();
    else timer.current = setTimeout(reveal, 450);
  }
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    const node = panel.current;
    const trigger = anchor.current;
    if (!open || !node || !trigger) return;
    if (node.showPopover) { node.popover = 'manual'; node.showPopover(); }
    const place = () => {
      const box = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      const bounds = node.getBoundingClientRect();
      const above = box.top - bounds.height - 8 >= top + 8;
      node.style.left = `${Math.max(left + 8, Math.min(box.left + (box.width - bounds.width) / 2, left + width - bounds.width - 8))}px`;
      node.style.top = `${Math.max(top + 8, Math.min(above ? box.top - bounds.height - 8 : box.bottom + 8, top + height - bounds.height - 8))}px`;
    };
    place();
    const dismiss = () => { markDismissed(); visible.current = false; setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); dismiss(); }
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.visualViewport?.addEventListener('resize', dismiss);
    return () => {
      if (node.hidePopover && node.matches(':popover-open')) node.hidePopover();
      node.removeAttribute('popover');
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.visualViewport?.removeEventListener('resize', dismiss);
    };
  }, [open]);
  return <>
    {cloneElement(children, {
      ref: anchor,
      'aria-describedby': open ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby'],
      onPointerEnter: event => { children.props.onPointerEnter?.(event); if (event.pointerType === 'mouse' && !event.currentTarget.disabled) show(); },
      onPointerLeave: event => { children.props.onPointerLeave?.(event); close(); },
      onPointerDown: event => { children.props.onPointerDown?.(event); close(); },
      onClick: event => { children.props.onClick?.(event); close(); },
      onFocusCapture: event => { children.props.onFocusCapture?.(event); if (event.target.matches(':focus-visible')) show(true); },
      onBlurCapture: event => { children.props.onBlurCapture?.(event); close(); },
    })}
    <span ref={panel} id={id} role="tooltip" className={styles.tip} data-instant={instant || undefined} hidden={!open}>{open ? content : null}</span>
  </>;
}
