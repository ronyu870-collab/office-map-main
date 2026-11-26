'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { WORKSPACE_MOTION, animateWorkspace, useSurfacePresence } from '../runtime/workspaceMotion';

/** Nonmodal, viewport-bounded disclosure shared by map statistics, legends and list options. */
export function MapDisclosure({ label, children, className = '', active = true, width: preferredWidth = 264, actionMenu = false, heading, dismissLabel = '关闭' }: { label: React.ReactNode; children: React.ReactNode; className?: string; active?: boolean; width?: number; actionMenu?: boolean; heading?: string; dismissLabel?: string }) {
  const root = React.useRef<HTMLDetailsElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const lastFocused = React.useRef<HTMLElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const presence = useSurfacePresence(open, children);
  React.useLayoutEffect(() => {
    if (!open) { lastFocused.current = null; return; }
    const previous = lastFocused.current;
    if (previous && !previous.isConnected && document.activeElement === document.body) {
      content.current?.querySelector<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])')?.focus({ preventScroll: true });
    }
  }, [open, children]);
  const interrupted = React.useRef<Keyframe | null>(null);
  React.useLayoutEffect(() => {
    const element = content.current;
    const start = interrupted.current; interrupted.current = null;
    const animation = animateWorkspace(element, open ? [{ opacity: 0, transform: 'translateY(-4px)', ...start }, { opacity: 1, transform: 'translateY(0)' }] : [{ opacity: 1, transform: 'translateY(0)', ...start }, { opacity: 0, transform: 'translateY(-4px)' }], open ? WORKSPACE_MOTION.state : WORKSPACE_MOTION.feedback, open ? 'none' : 'forwards');
    return () => {
      if (element && animation && (animation.playState === 'running' || animation.pending)) {
        const style = getComputedStyle(element);
        interrupted.current = { opacity: style.opacity, transform: style.transform };
      }
      animation?.cancel();
    };
  }, [open]);
  const id = React.useId();
  const closeActionMenu = () => {
    if (root.current) root.current.open = false;
    setOpen(false); root.current?.querySelector('summary')?.focus({ preventScroll: true });
  };
  React.useEffect(() => {
    if (open && actionMenu) content.current?.querySelector<HTMLElement>('button:not([disabled]), a[href]')?.focus({ preventScroll: true });
  }, [open, actionMenu]);
  React.useEffect(() => { if (!active) { root.current?.removeAttribute('open'); setOpen(false); } }, [active]);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = root.current?.querySelector('summary')?.getBoundingClientRect();
      const panel = content.current;
      if (!box || !panel) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0; const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth; const height = viewport?.height ?? window.innerHeight;
      const panelWidth = Math.min(preferredWidth, width - 24);
      panel.style.width = `${panelWidth}px`;
      panel.style.left = `${Math.max(left + 12, Math.min(box.left, left + width - panelWidth - 12))}px`;
      panel.style.maxHeight = `${Math.max(80, height - 24)}px`;
      const panelHeight = Math.min(panel.scrollHeight, height - 24);
      panel.style.top = `${Math.max(top + 12, Math.min(box.bottom + 8, top + height - panelHeight - 12))}px`;
    };
    const close = () => { const focused = content.current?.contains(document.activeElement); root.current?.removeAttribute('open'); setOpen(false); if (focused) root.current?.querySelector('summary')?.focus({ preventScroll: true }); };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !content.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (!root.current?.open || event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open], [aria-modal="true"], [data-building-metrics-edit], #__colliers_contact_modal_overlay')) return;
      event.preventDefault(); event.stopPropagation(); close(); root.current?.querySelector('summary')?.focus({ preventScroll: true });
    };
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    document.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place);
      document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true);
    };
  }, [open, children, preferredWidth]);
  return <details ref={root} className={`map-disclosure ${className}`} onToggle={event => {
    const next = event.currentTarget.open; setOpen(next);
    if (next) document.querySelectorAll<HTMLDetailsElement>('.map-disclosure[open]').forEach(el => { if (el !== root.current) el.open = false; });
  }}>
    <summary aria-controls={id} aria-expanded={open} onClick={event => {
      // Native toggle events are deferred/coalesced. Commit the active menu in
      // the click event so an immediate Escape cannot dismiss an older menu.
      event.preventDefault();
      const next = !root.current?.open;
      if (root.current) root.current.open = next;
      if (next) document.querySelectorAll<HTMLDetailsElement>('.map-disclosure[open]').forEach(el => { if (el !== root.current) el.open = false; });
      setOpen(next);
    }}>{label}<ChevronDown size={14} aria-hidden="true" /></summary>
    {presence.present ? createPortal(<div ref={content} id={id} className="map-disclosure-content" onFocusCapture={event => { if (event.target instanceof HTMLElement) lastFocused.current = event.target; }} onClick={actionMenu ? event => {
      if ((event.target as HTMLElement).closest('button:not([disabled]), a[href]')) closeActionMenu();
    } : undefined} inert={!open || undefined} aria-hidden={!open || undefined}>{heading ? <div className="map-disclosure-heading"><h2>{heading}</h2><button type="button" className="workspace-icon" aria-label={dismissLabel} title={dismissLabel} onClick={closeActionMenu}><X size={16} aria-hidden="true" /></button></div> : null}{presence.children}</div>, document.body) : null}
  </details>;
}
